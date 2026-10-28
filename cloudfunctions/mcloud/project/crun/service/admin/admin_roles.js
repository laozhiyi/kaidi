'use strict';

/**
 * 后台角色定义
 * root=初始管理员  super=超级管理员  admin=管理员  service=客服  空=无后台权限
 *
 * 角色保存在用户记录 USER_ROLE 上；初始管理员是安装时创建的账号密码账号
 * （ADMIN_ROOT=true，不出现在用户角色里），是整套权限的根。
 *
 * 层级 root(4) > super(3) > admin(2) > service(1) > 普通用户(0)，授权只能向下：
 * - 初始管理员：唯一能调整超管、授予超管的人，可管理全部账号
 * - 超级管理员：只能管管理员与客服，同级超管互不可改，也不能授予超管
 * - 管理员：只能管客服
 * - 客服：没有授权权限
 * 任何角色都不能改自己；超管交接/退出由初始管理员操作（或本人主动退出），
 * 且任何时候都要至少保留一位超管。
 */
const ROLES = { super: '超级管理员', admin: '管理员', service: '客服' };
const ORDER = ['super', 'admin', 'service'];
const LEVEL = { root: 4, super: 3, admin: 2, service: 1 };
const ROOT_LABEL = '初始管理员';

function normalize(value) {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ROLES, value) ? value : '';
}

function label(value) {
  return ROLES[normalize(value)] || '普通用户';
}

/** 角色层级：初始管理员 4 > 超管 3 > 管理员 2 > 客服 1 > 普通用户 0 */
function level(value) {
  // root 不在 ROLES 里（不可授予），但层级计算要认它。
  if (value === 'root') return LEVEL.root;
  return LEVEL[normalize(value)] || 0;
}

/**
 * 是否初始管理员（唯一能调整超管的人）。
 * 安装时创建的账号密码账号带 ADMIN_ROOT 标记；老数据没有该字段时，按
 * 「账号密码 + 平台管理员 + 超管类型」识别，避免升级后失去最高权限入口。
 */
function isRoot(admin) {
  if (!admin) return false;
  if (admin.ADMIN_ROOT === true) return true;
  if (admin.ADMIN_ROOT === false) return false;
  return admin.ADMIN_WECHAT !== true && admin.ADMIN_TYPE === 1 && admin.ADMIN_PLATFORM === true;
}

/** 兼容旧的账号密码管理员：没有 ADMIN_ROLE 时按 ADMIN_TYPE 推断。 */
function ofAdmin(admin) {
  if (!admin) return '';
  const role = normalize(admin.ADMIN_ROLE);
  if (role) return role;
  return admin.ADMIN_TYPE === 1 ? 'super' : 'admin';
}

/** 操作人的有效角色：root / super / admin / service / '' */
function operatorRole(admin) {
  if (isRoot(admin)) return 'root';
  return ofAdmin(admin);
}

/** 是否后台工作人员（任意角色，含初始管理员）。 */
function isStaff(role) {
  return !!normalize(role);
}

/**
 * 操作人能否调整「当前角色为 targetRole」的账号。
 * - 初始管理员：可管理所有账号，含超管
 * - 超管：只能管管理员、客服与普通用户，同级超管不能动
 * - 管理员：只能管客服与普通用户
 * - 客服 / 非工作人员：不能管理任何账号
 */
function canManage(admin, targetRole) {
  const operator = operatorRole(admin);
  if (!operator) return false;
  if (operator === 'root') return true;
  return level(operator) > level(targetRole);
}

/**
 * 操作人是否可以为目标账号设置该角色（不含目标账号的现状）。
 * 授予的角色必须严格低于自己：超管不能授超管，管理员只能授客服。
 * 初始管理员可授予全部角色。
 */
function canAssign(admin, role) {
  const operator = operatorRole(admin);
  if (!operator) return false;
  const next = normalize(role);
  if (!next) return true; // 取消授权不需要额外层级
  if (operator === 'root') return true;
  return level(operator) > level(next);
}

/**
 * 综合校验：操作人调整某个账号的后台角色是否合法。
 * 现状与目标角色都必须落在操作人的管辖范围内，避免用「降成客服」绕过同级限制。
 * 返回空串表示允许，否则返回可直接展示给用户的拒绝原因。
 */
function grantError(admin, currentRole, nextRole) {
  const operator = operatorRole(admin);
  if (!operator || operator === 'service') return '客服账号没有授权权限';

  const current = normalize(currentRole);
  if (!canManage(admin, current)) {
    if (current === 'super') return '超级管理员账号只有初始管理员可以调整，超管之间不能互相改权限';
    if (current === 'admin') return '不能调整同级管理员的权限，请由超级管理员处理';
    return '没有调整该账号的权限';
  }

  const next = normalize(nextRole);
  if (next && !canAssign(admin, next)) {
    if (next === 'super') return '只有初始管理员可以授予或调整超级管理员';
    return '不能授予与自己同级或更高的后台角色';
  }
  return '';
}

/** 停用 / 删除账号同样受层级限制，文案与授权分开，便于提示。 */
function manageError(admin, targetRole, action) {
  if (!admin || !isStaff(targetRole)) return '';
  if (canManage(admin, targetRole)) return '';
  const target = normalize(targetRole);
  if (target === 'super') return '超级管理员账号只有初始管理员可以' + action;
  return '不能' + action + '同级或更高权限的后台账号';
}

/** 当前操作人可以授予的角色列表，用于界面按钮。 */
function assignable(admin) {
  return ORDER.filter(role => canAssign(admin, role));
}

module.exports = {
  ROLES, ORDER, LEVEL, ROOT_LABEL,
  normalize, label, level, isRoot, ofAdmin, operatorRole, isStaff,
  canManage, canAssign, grantError, manageError, assignable
};
