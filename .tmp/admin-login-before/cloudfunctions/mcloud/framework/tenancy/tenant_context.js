'use strict';
const { AsyncLocalStorage } = require('async_hooks');
const AppError = require('../core/app_error.js');
const storage = new AsyncLocalStorage();
const ID = /^[a-z][a-z0-9_-]{1,47}$/;
function current() { return storage.getStore(); }
function requireScope() {
  const value = current();
  if (!value || value.mode !== 'campus' || !ID.test(value.schoolId) || !ID.test(value.campusId)) {
    throw new AppError('请先选择有效的学校和校区');
  }
  return value;
}
function run(scope, work) {
  if (!scope || !ID.test(scope.schoolId || '') || !ID.test(scope.campusId || '')) throw new AppError('学校或校区标识无效');
  return storage.run(Object.freeze({ ...scope, mode: 'campus' }), work);
}
// Only server-owned initialization, migration and scheduled jobs may use this.
function system(work) { return storage.run(Object.freeze({ mode: 'system' }), work); }
function fields(level = 'campus') {
  const scope = requireScope();
  return { _pid: 'crun', schoolId: scope.schoolId, ...(level === 'school' ? {} : { campusId: scope.campusId }) };
}
function suffix(level = 'campus') {
  const scope = current();
  return scope && scope.mode === 'campus' ? [scope.schoolId, ...(level === 'school' ? [] : [scope.campusId])] : [];
}
function canAdmin(admin, scope = requireScope()) {
  if (!admin || admin.ADMIN_STATUS !== 1) return false;
  if (admin.ADMIN_PLATFORM === true && admin.ADMIN_TYPE === 1) return true;
  return Array.isArray(admin.ADMIN_SCOPES) && admin.ADMIN_SCOPES.some(grant => grant && grant.schoolId === scope.schoolId &&
    (grant.campusId === '*' || grant.campusId === scope.campusId));
}
function assertAdmin(admin) { if (!canAdmin(admin)) throw new AppError('没有当前学校或校区的管理权限'); }
function canSchoolAdmin(admin, scope = requireScope()) {
  return !!admin && admin.ADMIN_STATUS===1 && (admin.ADMIN_PLATFORM===true && admin.ADMIN_TYPE===1 || Array.isArray(admin.ADMIN_SCOPES) && admin.ADMIN_SCOPES.some(grant=>grant && grant.schoolId===scope.schoolId && grant.campusId==='*'));
}
function assertSchoolAdmin(admin) { if (!canSchoolAdmin(admin)) throw new AppError('学校账号与注册审核需要学校管理员授权'); }
module.exports = { ID, current, requireScope, run, system, fields, suffix, canAdmin, assertAdmin, canSchoolAdmin, assertSchoolAdmin };
