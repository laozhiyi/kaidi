'use strict';
const Base = require('./base_project_service.js');
const store = require('./operation_store.js');
const UserModel = require('../model/user_model.js');
const Operations = require('./operations_service.js');
const timeUtil = require('../../../framework/utils/time_util.js');
const crypto = require('crypto');

// 积分规则（整数分）。只在订单真实完成（发单人确认收货 / 送达满 8 小时自动确认）时发放。
const RULES = Object.freeze({
 post_complete: 100,
 invite_first_order: 300
});
const REASON_TEXT = {
 post_complete: '订单完成收货',
 invite_first_order: '邀请好友首单',
 redeem: '兑换商品',
 admin_grant: '平台赠送',
 admin_deduct: '平台扣减'
};
// 商品目录只存在云端：价格由服务端决定，客户端只能展示，不能改价。
const CATALOG = Object.freeze([
 Object.freeze({ id: 'print_free', name: '免费打印券', cost: 100, icon: 'print', hint: '到打印店出示后点「确认核销」' }),
 Object.freeze({ id: 'sto_minus3', name: '立减3元券', cost: 500, icon: 'sto', hint: '寄申通快递时出示后点「确认核销」' }),
 Object.freeze({ id: 'free_order', name: '免单特权', cost: 1000, icon: 'official', hint: '联系云速取客服使用，使用时点「确认核销」' })
]);
const DEFAULT_HINT = '出示后点「确认核销」';
const REQUEST_ID_RE = /^[a-zA-Z0-9_-]{16,100}$/;
const VOUCHER_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const REDEEM_LIMIT = { max: 5, windowMs: 60000 };
const USE_LIMIT = { max: 10, windowMs: 60000 };
// 后台调整积分：单次 ±1000 以内，每个管理员每小时最多 30 次（防误操作和账号被盗后批量刷分）。
const GRANT_MAX = 1000;
const GRANT_LIMIT = { max: 30, windowMs: 3600000 };
function newVoucherCode() { return Array.from({ length: 8 }, () => VOUCHER_CHARS[crypto.randomInt(VOUCHER_CHARS.length)]).join(''); }

class PointService extends Base {
 // 幂等键：reason + orderId + userId（学校内），同一单同一人只可能有一条日志。
 _logId(reason, orderId, userId) {
  return store.schoolKey(this.getProjectId(), 'point', reason, orderId, userId);
 }
 // 事务里只允许按 _id 读写文档，因此先用普通查询定位用户，再回事务内重读校验。
 async _userByOpenId(userId) {
  const rows = await store.database().collection(store.collection('user'))
   .where({ USER_MINI_OPENID: userId }).limit(1).get();
  return rows && rows.data && rows.data[0] || null;
 }
 /**
  * 记一笔积分：日志与用户余额在调用方的事务里一起落库。
  * 同键日志已存在时直接返回 false，调用方可以安全重试。
  */
 async _award(tx, { userId, change, reason, orderId = '', relatedUserId = '', key = '', role = '' }) {
  if (!userId || !Number.isInteger(change) || change <= 0) return false;
  // key 用来定制幂等粒度（例如「每个被邀请人一辈子只拿一次」），默认按订单。
  const id = this._logId(reason, key || orderId, userId);
  if (await store.get(tx, 'point_log', id)) return false;
  // 事务外只用来拿 _id；真正的余额写入以事务内重读的文档为准。
  const found = await this._userByOpenId(userId);
  if (!found) return false;
  const user = await store.get(tx, 'user', found._id);
  if (!user || user.USER_MINI_OPENID !== userId) return false;
  const at = Date.now();
  await store.set(tx, 'point_log', id, {
   _pid: this.getProjectId(), userId, change, reason, orderId, relatedUserId, ...(role ? { role } : {}), at
  });
  await store.set(tx, 'user', user._id, { ...user, USER_POINTS: (Number(user.USER_POINTS) || 0) + change, USER_POINTS_TIME: at });
  return true;
 }
 // 被邀请人是否已经有过其它已完成订单：有则不再算首单。
 // 只读判断，放在事务外；并发首单靠事务内写同一条 invite 文档的冲突兜底。
 async _hasEarlierCompleted(userId,orderId){
  const db = store.database();
  const rows = await db.collection(store.collection('mail'))
   .where({ MAIL_USER_ID:userId, MAIL_STATUS:9 }).field({ _id:true }).limit(2).get();
  if ((rows && rows.data || []).some(row => row._id !== orderId)) return true;
  // mail 按校区隔离，只能看到本校区；point_log 按学校隔离，用它补上「在别的校区已经完成过订单」。
  const logs = await db.collection(store.collection('point_log'))
   .where({ userId, reason:'post_complete' }).field({ orderId:true }).limit(2).get();
  return (logs && logs.data || []).some(row => row.orderId !== orderId);
 }
 /**
  * 订单进入状态 9 时调用（必须在订单自己的事务里）。
  * 发单人 +100；若这是被邀请人的第一笔已完成订单，双方各 +300。
  */
 async awardOrderCompleted(tx, mail, now = Date.now()) {
  if (!mail || Number(mail.MAIL_STATUS) !== 9) return { poster: false, invite: false };
  const poster = mail.MAIL_USER_ID;
  const awarded = await this._award(tx, { userId: poster, change: RULES.post_complete, reason: 'post_complete', orderId: mail._id });
  return { poster: awarded, invite: await this._awardInviteFirstOrder(tx, mail, now) };
 }
 async _awardInviteFirstOrder(tx, mail, now) {
  const poster = mail.MAIL_USER_ID;
  // 邀请关系按学校内的受邀记录判定；没有受邀记录或已发过奖励就不再发。
  const id = store.scopeKey(this.getProjectId(), 'invite-accept', poster);
  const invite = await store.get(tx, 'invite', id);
  if (!invite || invite.INV_ACCEPT_USER_ID !== poster || !invite.INV_USER_ID) return false;
  // 只有审核通过的好友才结算邀请奖励；待审核 / 未通过不发。
  if (Number(invite.INV_STATUS) !== 1) return false;
  if (Number(invite.INV_REWARD_STATUS) === 1) return false;
  // 防刷：这一单的接单骑手就是邀请人本人时，不给邀请奖励。
  if (invite.INV_USER_ID === mail.MAIL_ACCEPT_USER_ID) return false;
  // 邀请关系按校区存，同一个人在别的校区还能再绑一次；被邀请人的奖励日志用学校内固定键，
  // 整个学校只能拿一次。两个校区同时首单时会写同一个文档，事务冲突后重试的一方在这里被拦下。
  const inviteeKey = 'invitee';
  if (await store.get(tx, 'point_log', this._logId('invite_first_order', inviteeKey, poster))) return false;
  if (await this._hasEarlierCompleted(poster, mail._id)) return false;
  const { _id, ...rest } = invite;
  await store.set(tx, 'invite', id, { ...rest, INV_REWARD_STATUS: 1, INV_REWARD_DESC: '好友完成首单', INV_REWARD_TIME: now, INV_EDIT_TIME: now });
  await this._award(tx, { userId: invite.INV_USER_ID, change: RULES.invite_first_order, reason: 'invite_first_order', orderId: mail._id, relatedUserId: poster, key: 'inviter:' + poster, role: 'inviter' });
  await this._award(tx, { userId: poster, change: RULES.invite_first_order, reason: 'invite_first_order', orderId: mail._id, relatedUserId: invite.INV_USER_ID, key: inviteeKey, role: 'invitee' });
  return true;
 }
 // 我的积分：余额 + 最近明细（分页）。只查本人，不接受外部传入的 userId。
 async my(userId, { page = 1, size = 20 } = {}) {
  const user = userId && await UserModel.getOne({ USER_MINI_OPENID: userId });
  if (!user) this.AppError('请先完成注册并登录');
  const result = await new Operations().list('point_log', { userId }, Number(page), 'at', Number(size), { direction: 'desc' });
  return {
   points: Number(user.USER_POINTS) || 0,
   list: result.list.map(row => ({
    id: row._id,
    change: Number(row.change) || 0,
    reason: row.reason || '',
    reasonText: row.reason === 'redeem' && row.itemName ? '兑换' + row.itemName : row.reason === 'admin_grant' && row.change < 0 ? REASON_TEXT.admin_deduct : REASON_TEXT[row.reason] || '积分变动',
    orderId: row.orderId || '',
    at: timeUtil.timestamp2Time(row.at, 'Y-M-D h:m')
   })),
   page: result.page, size: result.size, total: result.total, hasMore: result.hasMore
  };
 }
 // 商品目录 + 当前余额。
 async items(userId) {
  const user = userId && await UserModel.getOne({ USER_MINI_OPENID: userId });
  if (!user) this.AppError('请先完成注册并登录');
  return { points: Number(user.USER_POINTS) || 0, items: CATALOG.map(item => ({ ...item })) };
 }
 _voucherView(row) {
  const item = CATALOG.find(entry => entry.id === row.itemId);
  const usedAt = Number(row.usedAt) || 0;
  return {
   id: row._id, itemId: row.itemId || '', itemName: row.itemName || '', code: row.code || '',
   icon: row.icon || (item && item.icon) || '',
   cost: Math.abs(Number(row.change) || 0), at: timeUtil.timestamp2Time(row.at, 'Y-M-D h:m'),
   status: usedAt > 0 ? 'used' : 'unused', statusText: usedAt > 0 ? '已使用' : '未使用',
   usedAt: usedAt > 0 ? timeUtil.timestamp2Time(usedAt, 'Y-M-D h:m') : '',
   hint: row.hint || (item && item.hint) || DEFAULT_HINT
  };
 }
 /**
  * 兑换：扣分与 point_log 在同一个事务里落库，事务内只按 _id 读写。
  * 幂等：日志 _id 由 requestId + userId 决定，同一请求重复提交直接返回第一次的券码。
  * 并发：每次兑换都要写同一个 user 文档，云开发事务冲突保证同时只有一个提交成功，
  * 失败的一方由 store.transaction 重试并重新读取最新余额，余额不够就被拒绝。
  */
 async redeem(userId, { itemId, requestId } = {}) {
  if (typeof requestId !== 'string' || !REQUEST_ID_RE.test(requestId)) this.AppError('请求标识无效，请刷新后重试');
  const item = CATALOG.find(entry => entry.id === itemId);
  if (!item) this.AppError('商品不存在或已下架');
  const found = userId && await UserModel.getOne({ USER_MINI_OPENID: userId });
  if (!found || found.USER_STATUS !== 1) this.AppError('请先完成注册并登录');
  const pid = this.getProjectId();
  const id = store.schoolKey(pid, 'point', 'redeem', requestId, userId);
  const replay = (row, points) => {
   if (row.userId !== userId || row.itemId !== item.id) this.AppError('相同请求标识不能兑换不同商品');
   return { ...this._voucherView(row), points, alreadyRedeemed: true };
  };
  const seen = await store.get(store.database(), 'point_log', id);
  if (seen) return replay(seen, Number((await UserModel.getOne({ USER_MINI_OPENID: userId })).USER_POINTS) || 0);
  // 已保存的请求走上面的幂等返回，不占用限流额度；新请求才限流防连点。
  await store.limit(pid, userId, 'point_redeem', REDEEM_LIMIT.max, REDEEM_LIMIT.windowMs);
  return store.transaction(async tx => {
   const user = await store.get(tx, 'user', found._id);
   if (!user || user._pid !== pid || user.USER_MINI_OPENID !== userId || user.USER_STATUS !== 1) this.AppError('账号不可用');
   const balance = Number(user.USER_POINTS) || 0;
   const old = await store.get(tx, 'point_log', id);
   if (old) return replay(old, balance);
   if (balance < item.cost) this.AppError('积分不足，还差 ' + (item.cost - balance) + ' 积分');
   const at = Date.now(), row = {
    _pid: pid, userId, change: -item.cost, reason: 'redeem', orderId: '', relatedUserId: '',
    itemId: item.id, itemName: item.name, icon: item.icon, hint: item.hint, code: newVoucherCode(), usedAt: 0, at
   };
   await store.set(tx, 'point_log', id, row);
   await store.set(tx, 'user', user._id, { ...user, USER_POINTS: balance - item.cost, USER_POINTS_TIME: at });
   return { ...this._voucherView({ ...row, _id: id }), points: balance - item.cost };
  });
 }
 // 已兑换的券：只查本人（userId 来自登录态，不接受客户端传入）。
 async vouchers(userId, { page = 1, size = 20 } = {}) {
  const user = userId && await UserModel.getOne({ USER_MINI_OPENID: userId });
  if (!user) this.AppError('请先完成注册并登录');
  const result = await new Operations().list('point_log', { userId, reason: 'redeem' }, Number(page), 'at', Number(size), { direction: 'desc' });
  return { list: result.list.map(row => this._voucherView(row)), page: result.page, size: result.size, total: result.total, hasMore: result.hasMore };
 }
 /**
  * 核销：用户本人当面点「确认核销」，券标记为已使用，不改积分。
  * 别人的券、不存在的 id、非兑换记录统一报「券不存在」，不暴露券归属。
  * 重复核销返回 alreadyUsed，保留第一次的核销时间。事务内只按 _id 读写。
  */
 async useVoucher(userId, { id } = {}) {
  if (typeof id !== 'string' || id.length < 1 || id.length > 200) this.AppError('券不存在');
  const found = userId && await UserModel.getOne({ USER_MINI_OPENID: userId });
  if (!found || found.USER_STATUS !== 1) this.AppError('请先完成注册并登录');
  const pid = this.getProjectId();
  await store.limit(pid, userId, 'point_use', USE_LIMIT.max, USE_LIMIT.windowMs);
  return store.transaction(async tx => {
   const row = await store.get(tx, 'point_log', id);
   if (!row || row._pid !== pid || row.userId !== userId || row.reason !== 'redeem') this.AppError('券不存在');
   if (Number(row.usedAt) > 0) return { ...this._voucherView({ ...row, _id: id }), alreadyUsed: true };
   const next = { ...row, usedAt: Date.now() };
   delete next._id;
   await store.set(tx, 'point_log', id, next);
   return { ...this._voucherView({ ...next, _id: id }), alreadyUsed: false };
  });
 }
 /**
  * 后台调整积分（仅初始管理员 / 超级管理员，权限在控制器校验）。
  * 用于内测给自己加分验证兑换、事后扣回，以及上线后的人工补偿。
  * - amount 为非零整数，单次绝对值不超过 1000；扣减后余额不能为负。
  * - requestId 幂等：同一请求重复提交只记一次；日志写明操作的管理员和说明，可审计。
  */
 async adminGrant(admin, { userId, amount, note = '', requestId } = {}) {
  if (!admin || !admin._id) this.AppError('请重新登录管理员');
  if (typeof requestId !== 'string' || !REQUEST_ID_RE.test(requestId)) this.AppError('请求标识无效，请刷新后重试');
  const change = Number(amount);
  if (!Number.isInteger(change) || change === 0 || Math.abs(change) > GRANT_MAX) this.AppError('调整积分须为非零整数，单次不超过 ' + GRANT_MAX);
  const text = String(note || '').trim();
  if (!text) this.AppError('请填写调整原因');
  if (text.length > 100) this.AppError('调整原因不能超过100字');
  // 后台列表传的是文档 _id；兼容旧链接里的 OpenID。
  const target = String(userId || '').trim();
  let found = null;
  for (const field of ['_id', 'USER_MINI_OPENID']) if (!found && target) found = await UserModel.getOne({ [field]: target });
  if (!found || !found.USER_MINI_OPENID) this.AppError('用户不存在');
  const openId = found.USER_MINI_OPENID, pid = this.getProjectId();
  const id = store.schoolKey(pid, 'point', 'admin_grant', requestId, openId);
  const view = (row, points) => ({ id, change: row.change, points, alreadyApplied: true });
  const seen = await store.get(store.database(), 'point_log', id);
  if (seen) {
   if (seen.userId !== openId || seen.change !== change) this.AppError('相同请求标识不能用于不同的调整');
   return view(seen, Number(found.USER_POINTS) || 0);
  }
  await store.limit(pid, 'admin:' + admin._id, 'point_grant', GRANT_LIMIT.max, GRANT_LIMIT.windowMs);
  return store.transaction(async tx => {
   const user = await store.get(tx, 'user', found._id);
   if (!user || user.USER_MINI_OPENID !== openId) this.AppError('用户不存在');
   const balance = Number(user.USER_POINTS) || 0;
   const old = await store.get(tx, 'point_log', id);
   if (old) return view(old, balance);
   if (balance + change < 0) this.AppError('扣减后余额不能为负，当前余额 ' + balance);
   const at = Date.now();
   await store.set(tx, 'point_log', id, {
    _pid: pid, userId: openId, change, reason: 'admin_grant', orderId: '', relatedUserId: '',
    adminId: admin._id, adminName: admin.ADMIN_NAME || '', note: text, at
   });
   await store.set(tx, 'user', user._id, { ...user, USER_POINTS: balance + change, USER_POINTS_TIME: at });
   return { id, change, points: balance + change, alreadyApplied: false };
  });
 }
}
PointService.RULES = RULES;
PointService.CATALOG = CATALOG;
module.exports = PointService;
