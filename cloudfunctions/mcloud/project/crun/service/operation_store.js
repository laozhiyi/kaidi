'use strict';
const cloudBase = require('../../../framework/cloud/cloud_base.js');
const config = require('../../../config/config.js');
const crypto = require('crypto');
const AppError = require('../../../framework/core/app_error.js');
const tenant = require('../../../framework/tenancy/tenant_context.js');
const key = (...parts) => crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0,32);
const collection = name => config.COLLECTION_PRFIX + name;
function database() { return cloudBase.getCloud().database({throwOnNotFound:false}); }
// Never treat network/permission errors as missing records.
async function get(tx, name, id) {
 try { const res = await tx.collection(collection(name)).doc(id).get(); return Array.isArray(res.data) ? (res.data[0] || null) : (res.data || null); }
 catch (e) { if (e.errCode === -1 && /not exist|not found/i.test(e.errMsg || e.message || '') || /DOCUMENT_NOT_FOUND|document does not exist/i.test(e.code || e.message || '')) return null; throw e; }
}
async function set(tx, name, id, row) { const data = { ...row }; delete data._id; if (['mail','notification'].includes(name)) data.workerShard = parseInt(key(id).slice(0,8),16) % 16; await tx.collection(collection(name)).doc(id).set({ data }); }
async function transaction(fn) {
 // The installed wx-server-sdk forwards the second argument as retry count.
 // Disable its immediate retries so competing clients do not retry in lockstep.
 for (let attempt = 0; ; attempt++) {
  try { return await database().runTransaction(async tx => {
   await require('./account_service.js').guardTransaction(tx);
   return fn(tx);
  }, 0); }
  catch (error) {
   const conflict = error && (error.code === 'DATABASE_TRANSACTION_CONFLICT' || /DATABASE_TRANSACTION_CONFLICT/.test(error.errMsg || ''));
   if (!conflict) throw error; // An unknown commit/network outcome is not safe to replay here.
   if (attempt >= 4) throw Object.assign(new Error('订单正在更新，请稍后重试'), { code: 'DATABASE_TRANSACTION_CONFLICT', retryable: true });
   await new Promise(resolve => setTimeout(resolve, Math.min(400, 30 * Math.pow(2, attempt)) + Math.floor(Math.random() * 70)));
  }
 }
}
async function limitInTransaction(tx, pid, identity, action, max, windowMs) {
 const now = Date.now(), bucket = Math.floor(now / windowMs), id = scopeKey(pid, identity, action, bucket);
 const row = await get(tx, 'operation_limit', id);
 if (row && row.count >= max) throw new AppError('操作过于频繁，请稍后再试');
 await set(tx, 'operation_limit', id, { _pid: pid, count: (row && row.count || 0) + 1, expiresAt: (bucket + 2) * windowMs });
}
async function limit(pid, identity, action, max, windowMs) {
 return transaction(tx => limitInTransaction(tx, pid, identity, action, max, windowMs));
}
async function limitAdmin(pid,identity,action,max,windowMs) {
 return transaction(async tx=>{
  const now=Date.now(),bucket=Math.floor(now/windowMs),id=key(pid,identity,action,bucket);
  const old=await get(tx,'admin_limit',id);
  if(old && old.count>=max)throw new AppError('登录尝试过于频繁，请稍后重试');
  await set(tx,'admin_limit',id,{_pid:pid,count:(old&&old.count||0)+1,expiresAt:(bucket+2)*windowMs});
 });
}
async function assertRequestOpen(tx, pid, identity, route, requestId) {
 await assertRequestScope(tx,pid,identity,route,requestId);
 if (await get(tx, 'order_request', key(pid, 'cancelled', identity, route, requestId))) {
  throw new AppError('上次未保存的提交已停止，请重新提交');
 }
}
async function assertRequestScope(tx,pid,identity,route,requestId) {
 const scope=tenant.current();if(!scope||scope.mode!=='campus')return;
 const id=key(pid,identity,requestId),cancelled=key(pid,'cancelled',identity,route,requestId);
 let registered=false;
 for(const candidate of [id,cancelled]){
  const old=await get(tx,'request_scope',candidate);
  if(old&&(old.schoolId!==scope.schoolId||old.campusId!==scope.campusId))throw new AppError('请切回原提交校区核对该请求');
  if(candidate===id&&old)registered=true;
 }
 if(!registered)await set(tx,'request_scope',id,{_pid:pid,schoolId:scope.schoolId,campusId:scope.campusId});
}
const scope = () => { const value = tenant.current(); return value && value.mode === 'campus' ? value : null; };
const scopeKey = (...parts) => key(...parts, ...tenant.suffix());
const schoolKey = (...parts) => key(...parts, ...tenant.suffix('school'));
module.exports = { key, scope, scopeKey, schoolKey, collection, database, get, set, transaction, limit, limitAdmin, limitInTransaction, assertRequestOpen, assertRequestScope };
