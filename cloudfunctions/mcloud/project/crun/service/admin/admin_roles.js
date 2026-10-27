'use strict';

/**
 * 后台角色定义
 * super=超级管理员  admin=管理员  service=客服  空=无后台权限
 * 角色保存在用户记录 USER_ROLE 上，登录后台时由微信身份换取管理员会话。
 */
const ROLES = { super: '超级管理员', admin: '管理员', service: '客服' };
const ORDER = ['super', 'admin', 'service'];

function normalize(value) {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ROLES, value) ? value : '';
}

function label(value) {
  return ROLES[normalize(value)] || '普通用户';
}

/** 兼容旧的账号密码管理员：没有 ADMIN_ROLE 时按 ADMIN_TYPE 推断。 */
function ofAdmin(admin) {
  if (!admin) return '';
  const role = normalize(admin.ADMIN_ROLE);
  if (role) return role;
  return admin.ADMIN_TYPE === 1 ? 'super' : 'admin';
}

/** 是否后台工作人员（任意角色）。 */
function isStaff(role) {
  return !!normalize(role);
}

/** 操作人是否可以为目标账号设置该角色。返回空串表示允许。 */
function grantError(operatorRole, role) {
  const operator = normalize(operatorRole);
  if (operator === 'service' || !operator) return '客服账号没有授权权限';
  if (['super', 'admin'].includes(normalize(role)) && operator !== 'super') return '只有超级管理员可以授予或取消管理员权限';
  return '';
}

/** 当前操作人可以授予的角色列表，用于界面按钮。 */
function assignable(operatorRole) {
  const operator = normalize(operatorRole);
  if (operator === 'super') return ORDER.slice();
  if (operator === 'admin') return ['service'];
  return [];
}

module.exports = { ROLES, ORDER, normalize, label, ofAdmin, isStaff, grantError, assignable };
