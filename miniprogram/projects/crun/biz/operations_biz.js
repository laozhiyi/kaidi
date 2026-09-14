const cloud = require('../../../helper/cloud_helper.js');
const Passport = require('../../../comm/biz/passport_biz.js');
const Admin = require('../../../comm/biz/admin_biz.js');
const md5 = require('../../../lib/tools/md5_lib.js').md5;
const uploadCache = new Map();
const commands = new Map(), changeListeners = new Set();
const requestId = () => 'req_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
async function get(route, params = {}) { const result = await cloud.callCloudSumbit(route, params, {hint:false}); if (!result || result.data === undefined) throw new Error('未收到有效响应，请重试'); return result.data; }
function pendingKey(route, params = {}) {
 const admin = route.startsWith('admin/') && Admin.getAdminToken();
 const identity = admin ? 'admin:'+admin.name+':'+md5(admin.token) : Passport.getUserId();
 return identity ? 'crun-pending:' + identity + ':' + route + ':' + (params.id || 'new') : '';
}
function pendingCommand(route, params = {}) {
 const key = pendingKey(route, params);
 return key ? wx.getStorageSync(key) || null : null;
}
function recoverCommand(route, params = {}) {
 const key = pendingKey(route, params);
 if (!key) return Promise.reject(new Error('请先登录'));
 if (commands.has(key)) return Promise.reject(new Error('上一项操作仍在处理中，请稍后核对'));
 const pending = pendingCommand(route, params);
 if (!pending) return Promise.reject(new Error('没有需要核对的提交'));
 const task = { signature: 'recover' };
 task.promise = Promise.resolve().then(async () => {
  if (pendingKey(route, params) !== key) throw new Error('登录账号已变化，请返回重试');
  const result = await get(route.startsWith('admin/') ? 'admin/operations_recover' : 'operations/recover', {
   route, requestId: pending.requestId, id: pending.resourceId || params.id || params.orderId || ''
  });
  if (!result || !['committed', 'cancelled'].includes(result.state)) throw new Error('上次提交结果尚未确认，请稍后重试');
  const current = wx.getStorageSync(key);
  if (current && current.requestId === pending.requestId) wx.removeStorageSync(key);
  if (result.state === 'committed') orderChanged(route, result.result || {});
  return result;
 }).finally(() => { if (commands.get(key) === task) commands.delete(key); });
 commands.set(key, task);
 return task.promise;
}
function command(route, params = {}, options = {}) {
 // Freeze the payload before signing or yielding. A form can keep changing
 // while the request is in flight, and retries must send the identical body.
 params = JSON.parse(JSON.stringify(params));
 const key = pendingKey(route, params); if (!key) return Promise.reject(new Error('请先登录'));
 const signature = md5(JSON.stringify(params));
 const active = commands.get(key);
 if (active) {
  if (active.signature === signature) return active.promise;
  return Promise.reject(new Error('上一项操作仍在处理中，请稍后再提交修改'));
 }
 const task = { signature };
 // Install the lock before any asynchronous login, upload or cloud response.
 task.promise = Promise.resolve().then(() => sendCommand(route, params, options, key, signature)).finally(() => {
  if (commands.get(key) === task) commands.delete(key);
 });
 commands.set(key, task);
 return task.promise;
}
function withRecovery(error, route, params, key) {
 error.recover = () => {
  if (pendingKey(route, params) !== key) return Promise.reject(new Error('登录账号已变化，请返回重试'));
  return recoverCommand(route, params);
 };
 return error;
}
async function sendCommand(route, params, options, key, signature) {
 if (pendingKey(route, params) !== key) throw new Error('登录账号已变化，请返回重试');
 let pending = wx.getStorageSync(key);
 if (pending && pending.signature !== signature) {
  const error = new Error('上次提交结果尚未确认。核对后，已保存的记录会保留；未保存的提交会停止，随后可提交当前修改。');
  throw withRecovery(error, route, params, key);
 }
 // Persist identifiers only. Contact details, evidence and form contents stay
 // out of local storage; the server can reconcile an unknown outcome safely.
 if (!pending) { pending = {signature,requestId:requestId(),resourceId:params.id || params.orderId || '',createdAt:Date.now()}; wx.setStorageSync(key,pending); }
 const retries = options.retries === undefined ? 2 : Math.min(2, Math.max(0, Number(options.retries) || 0));
 let result;
 for (let attempt = 0; ; attempt++) {
  if (pendingKey(route, params) !== key) throw new Error('登录账号已变化，请返回重试');
  try {
   result = await get(route,{...params,requestId:pending.requestId}); break;
  }
  catch (error) {
   const businessError = error && error.code && error.code !== 500;
   if (!businessError) { pending = {...pending,uncertain:true}; wx.setStorageSync(key,pending); }
   if (attempt >= retries || !error || error.retryable !== true || error.code && error.code !== 500) {
    if (businessError && !pending.uncertain) {
     const current = wx.getStorageSync(key);
     if (current && current.requestId === pending.requestId) wx.removeStorageSync(key);
    }
    if (businessError && pending.uncertain) {
     const unresolved = new Error((error.msg || error.message || '本次重试未完成') + '；此前提交结果尚未确认，请先核对上次结果。');
     throw withRecovery(unresolved, route, params, key);
    }
    throw error;
   }
   if (typeof options.onRetry === 'function') options.onRetry(attempt + 1);
   await new Promise(resolve => setTimeout(resolve, 400 * Math.pow(2, attempt) + Math.floor(Math.random() * 200)));
  }
 }
 const current=wx.getStorageSync(key);if(current && current.requestId===pending.requestId)wx.removeStorageSync(key);
 orderChanged(route, {...result,id:params.id || result._id || result.id});
 return result;
}
function orderChanged(route, result) {
 if (route.startsWith('mail/') || ['admin/operations_hold', 'admin/operations_resolve'].includes(route)) {
  for (const name of ['order-mail-take', 'order-mail-mine', 'order-mail-posted', 'order-mail-done', 'mail-list', 'admin-mail-list']) wx.removeStorageSync(name.toUpperCase() + '_LIST');
  for (const listener of changeListeners) { try { listener({ route, id: result._id || result.id }); } catch (_) {} }
 }
}
async function upload(paths) {
 if(!Array.isArray(paths)||paths.length>6)throw new Error('最多上传6张图片');
 if (!paths.length) return [];
 const config=await get('operations/config'),result=[];
 for(const original of paths){
  if(original.startsWith('cloud://')){result.push(original);continue;}
  if(uploadCache.has(config.uploadPrefix+original)){result.push(uploadCache.get(config.uploadPrefix+original));continue;}
  let filePath=original;
  const info=await new Promise((resolve,reject)=>wx.getFileInfo({filePath,success:resolve,fail:reject}));
  if(info.size>1024*1024){const compressed=await new Promise((resolve,reject)=>wx.compressImage({src:filePath,quality:60,success:resolve,fail:reject}));filePath=compressed.tempFilePath;}
  const finalInfo=await new Promise((resolve,reject)=>wx.getFileInfo({filePath,success:resolve,fail:reject}));if(finalInfo.size>1024*1024)throw new Error('图片压缩后仍超过1MB，请选择较小图片');
  const file=await wx.cloud.uploadFile({cloudPath:config.uploadPrefix+requestId()+'.jpg',filePath});if(uploadCache.size>100)uploadCache.clear();uploadCache.set(config.uploadPrefix+original,file.fileID);result.push(file.fileID);
 }
 return result;
}
async function subscribe(config) {
 if(!config.templateId || !wx.requestSubscribeMessage)return 'unavailable';
 try {
  const result=await new Promise((resolve,reject)=>wx.requestSubscribeMessage({tmplIds:[config.templateId],success:resolve,fail:reject}));
  if(result[config.templateId]!=='accept')return 'declined';
  await get('operations/subscribe',{enabled:true});
  return 'subscribed';
 } catch(_){return 'failed';}
}
function error(e){
 const recover = e && e.recover;
 wx.showModal({title:'操作未完成',content:e && (e.msg || e.message) || '网络异常，请重试',showCancel:!!recover,confirmText:recover?'核对上次':'确定',cancelText:'稍后',success:async res=>{
  if (!recover || !res.confirm) return;
  wx.showLoading({title:'核对上次提交',mask:true});
  try { const result=await recover(); wx.hideLoading(); wx.showModal({title:'上次提交已核对',content:result.state==='committed'?'上次提交已保存，请查看最新记录后再继续。当前修改仍保留。':'上次提交未保存且已停止，可以继续提交当前内容。',showCancel:false}); }
  catch (next) { wx.hideLoading(); error(next); }
 }});
}
module.exports={get,command,pendingCommand,recoverCommand,upload,subscribe,requestId,error,clearUploadCache:()=>uploadCache.clear(),onOrderChanged(listener){changeListeners.add(listener);return()=>changeListeners.delete(listener);}};
