'use strict';
const store = require('./operation_store.js');
const AppError = require('../../../framework/core/app_error.js');
function canonical(value) {
  if (value instanceof Date) return {$date:value.toISOString()};
  if (Array.isArray(value)) return value.map(item=>item === undefined ? null : canonical(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,canonical(value[key])]));
  return value;
}
const hash = value => store.key(canonical(value));
function shared(old, target) {
  if (!old || target.value.tenantRetired) return false;
  if (['request_scope','identity_unique'].includes(target.collection)) {
    const keys = target.collection === 'request_scope' ? ['_pid','schoolId','campusId'] : ['_pid','schoolId','userId'];
    if (!keys.every(key=>old[key]===target.value[key]) || target.value.code && old.code && old.code!==target.value.code) throw new AppError('迁移唯一键或请求归属冲突，请人工核对');
    return true;
  }
  return false;
}
function check(old, target, sourceId) {
  if (shared(old,target)) return;
  if (old && target.id !== sourceId && target.collection !== 'news_manifest') throw new AppError('目标记录已存在，拒绝覆盖');
}
async function commit(tx, planHash, target, sourceId) {
  const value = {...target.value,_id:target.id};
  const old = await store.get(tx,target.collection,target.id);
  // Several source records can point to the same request/uniqueness guard.
  // One journal entry per target makes rollback independent of source order.
  if (hash(old)===hash(value) || shared(old,target)) return false;
  check(old,target,sourceId);
  if (target.beforeHash !== hash(old)) throw new AppError('迁移目标发生变化，请重新预检');
  const id = store.key(planHash,'record',target.collection,target.id);
  const existing = await store.get(tx,'tenant_migration',id);
  if (existing && existing.status === 'applied') throw new AppError('迁移记录已变化，拒绝覆盖备份');
  await store.set(tx,target.collection,target.id,value);
  await store.set(tx,'tenant_migration',id,{
    _pid:'crun',planHash,kind:'record',status:'applied',collection:target.collection,targetId:target.id,
    before:old,afterHash:hash(value),appliedAt:Date.now()
  });
  return true;
}
module.exports = {canonical,hash,check,commit};
