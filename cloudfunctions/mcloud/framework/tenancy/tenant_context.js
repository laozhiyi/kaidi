'use strict';
const { AsyncLocalStorage } = require('async_hooks');
const AppError = require('../core/app_error.js');
const config = require('../../config/config.js');
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
function isAdminEnabled(admin) {
  return !!admin && (config.ADMIN_LOGIN_CREDENTIALS_ONLY === true || admin.ADMIN_STATUS === 1);
}
module.exports = { ID, current, requireScope, run, system, fields, suffix, isAdminEnabled };
