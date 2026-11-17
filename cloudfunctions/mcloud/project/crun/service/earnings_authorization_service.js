'use strict';
const store = require('./operation_store.js');
const cfg = require('../config/pay_config.js');
const api = require('./wechat_pay_api.js');
const cloud = require('../../../framework/cloud/cloud_base.js');
const tenant = require('../../../framework/tenancy/tenant_context.js');
const AppError = require('../../../framework/core/app_error.js');

const endpoint = '/v3/fund-app/mch-transfer/user-confirm-authorization';
const scene = '1005';
const lifetime = 24 * 3600000;
const states = ['CREATED', 'WAIT_USER_CONFIRM', 'TAKING_EFFECT', 'CLOSED'];
const closeReasons = ['USER_CLOSE', 'USER_OVERDUE_UNCONFIRMED', 'CLOSE_VIA_MCH_API'];
const number = value => typeof value === 'string' && /^[A-Za-z0-9]{32}$/.test(value);
const authorizationId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(value);
const openidOf = userId => typeof userId === 'string' ? userId.split('^^^').pop() : '';
const key = openid => store.key('crun', 'earnings-authorization', cfg.mchid, cfg.appid, openid);

function assertAccount(record, openid) {
 if (!record || record._pid !== 'crun' || record.kind !== 'earnings_authorization' ||
     record.merchant !== cfg.mchid || record.appid !== cfg.appid || record.openid !== openid ||
     record.transferSceneId !== scene || !number(record.outAuthorizationNo) || !states.includes(record.status) ||
     !Number.isSafeInteger(record.attempt) || record.attempt < 1 || !Number.isFinite(record.createdAt) ||
     !Array.isArray(record.retiredAuthorizationNos) || !record.retiredAuthorizationNos.every(number) ||
     record.status === 'TAKING_EFFECT' && !authorizationId(record.authorizationId)) {
  throw new Error('WECHAT_AUTHORIZATION_ACCOUNT_MISMATCH');
 }
}

async function read(id) {
 // Only these identity-keyed authorization documents are global; order payments stay campus scoped.
 return tenant.system(() => store.get(store.database(), 'payment', id));
}

function assertResponse(record, response, queried) {
 if (!response || response.out_authorization_no !== record.outAuthorizationNo ||
     !states.slice(1).includes(response.state) ||
     queried && (response.appid !== record.appid || response.openid !== record.openid ||
      response.transfer_scene_id !== record.transferSceneId || response.user_display_name !== record.userDisplayName) ||
     response.state === 'TAKING_EFFECT' && !authorizationId(response.authorization_id) ||
     record.authorizationId && response.authorization_id && response.authorization_id !== record.authorizationId ||
     response.state === 'CLOSED' && (!response.close_info || !closeReasons.includes(response.close_info.close_reason) ||
      !Number.isFinite(Date.parse(response.close_info.close_time))) ||
     response.create_time !== undefined && !Number.isFinite(Date.parse(response.create_time))) {
  throw new Error('WECHAT_AUTHORIZATION_MISMATCH');
 }
}

async function apply(id, record, response, queried) {
 assertResponse(record, response, queried);
 return tenant.system(() => store.transaction(async tx => {
  const current = await store.get(tx, 'payment', id);
  assertAccount(current, record.openid);
  if (current.outAuthorizationNo !== record.outAuthorizationNo) return current;
  // A late creation response or confirmation notification cannot revive a closed authorization.
  if (current.status === 'CLOSED' || current.status === 'TAKING_EFFECT' && response.state === 'WAIT_USER_CONFIRM') return current;
  if (current.authorizationId && response.authorization_id && current.authorizationId !== response.authorization_id) {
   throw new Error('WECHAT_AUTHORIZATION_MISMATCH');
  }
  const updated = { ...current, status: response.state, updatedAt: Date.now() };
  if (response.create_time !== undefined) updated.createdAt = Date.parse(response.create_time);
  if (response.authorization_id !== undefined) updated.authorizationId = response.authorization_id;
  if (response.state === 'WAIT_USER_CONFIRM' && response.package_info !== undefined) updated.package = response.package_info;
  if (response.state !== 'WAIT_USER_CONFIRM') updated.package = '';
  if (response.state === 'CLOSED') updated.closeReason = response.close_info.close_reason;
  await store.set(tx, 'payment', id, updated);
  return updated;
 }));
}

async function refresh(id, record) {
 let response;
 try { response = await api.request('GET', endpoint + '/out-authorization-no/' + record.outAuthorizationNo); }
 catch (error) {
  // NOT_FOUND is signed by the shared API client. Network failures must propagate and preserve the number.
  if (error.code === 'NOT_FOUND') return { record, exists: false };
  throw error;
 }
 return { record: await apply(id, record, response, true), exists: true };
}

async function currentIdentity(userId) {
 if (!cfg.ready()) throw new AppError('报酬自动结算暂不可用，请联系在线客服');
 const wx = cloud.getCloud().getWXContext();
 const openid = openidOf(userId);
 if (!openid || wx.APPID !== cfg.appid || !wx.OPENID || wx.OPENID !== openid) {
  throw new AppError('结算账号与当前微信账号不匹配，请重新登录');
 }
 return openid;
}

function replaceable(record, missing) {
 return record.status === 'CLOSED' && ['USER_CLOSE', 'USER_OVERDUE_UNCONFIRMED'].includes(record.closeReason) ||
  missing && ['CREATED', 'WAIT_USER_CONFIRM'].includes(record.status) && !record.authorizationId && Date.now() - record.createdAt >= lifetime;
}

async function reserve(id, openid, previous, missing) {
 return tenant.system(() => store.transaction(async tx => {
  const old = await store.get(tx, 'payment', id);
  if (old) {
   assertAccount(old, openid);
   if (!previous || old.outAuthorizationNo !== previous.outAuthorizationNo || !replaceable(old, missing)) return old;
  }
  const attempt = old ? old.attempt + 1 : 1;
  const record = { _pid: 'crun', kind: 'earnings_authorization', state: 'authorization',
   merchant: cfg.mchid, appid: cfg.appid, openid, transferSceneId: scene,
   userDisplayName: '云速取骑手' + store.key('account', openid).slice(0, 12),
   outAuthorizationNo: store.key('crun', 'earnings-authorization-request', id, attempt),
   authorizationId: '', attempt, status: 'CREATED', package: '', closeReason: '',
   createdAt: Date.now(), updatedAt: Date.now(),
   retiredAuthorizationNos: old ? old.retiredAuthorizationNos.concat(old.outAuthorizationNo) : [] };
  await store.set(tx, 'payment', id, record);
  return record;
 }));
}

class EarningsAuthorizationService {
 async prepare(userId, orderId) {
  await new (require('./mail_service.js'))()._user(userId);
  const mode = await store.transaction(async tx => {
   const order = await store.get(tx, 'mail', orderId);
   if (!order || order._pid !== 'crun' || order.MAIL_STATUS !== 0 || order.MAIL_ACCEPT_USER_ID ||
       order.MAIL_USER_ID === userId || order.MAIL_ADMIN_DELETED === true || order.MAIL_END_TIME <= Date.now() ||
       (order.MAIL_RELEASED_RIDERS || []).includes(userId)) throw new AppError('该订单暂不可接取，请查看其他订单');
   if (order.MAIL_PAYMENT_MODE === 'offline') return 'offline';
   if (order.MAIL_PAYMENT_MODE !== 'wechat' || order.MAIL_PAY_STATUS !== 1 || order.MAIL_REFUND_STATUS ||
       !order.MAIL_TRANSACTION_ID || !order.MAIL_PAY_NO) throw new AppError('订单尚未确认付款，不能接单');
   const payment = await store.get(tx, 'payment', order.MAIL_PAY_NO);
   if (!payment || payment.orderId !== orderId || payment.state !== 'paid' || payment.merchant !== cfg.mchid ||
       payment.appid !== cfg.appid || payment.transactionId !== order.MAIL_TRANSACTION_ID ||
       payment.amount !== order.MAIL_TOTAL_FEE || !Number.isSafeInteger(payment.amount) || payment.amount < 1) {
    throw new AppError('订单收款需核对，请联系在线客服');
   }
   return 'wechat';
  });
  if (mode === 'offline') return { authorized: true };
  const openid = await currentIdentity(userId), id = key(openid);
  let record = await read(id), missing = false;
  if (record) {
   assertAccount(record, openid);
   const queried = await refresh(id, record);
   record = queried.record;
   missing = !queried.exists;
   if (record.status === 'TAKING_EFFECT') {
    if (missing) throw new Error('WECHAT_AUTHORIZATION_NOT_FOUND');
    return { authorized: true };
   }
   if (missing && record.status !== 'CREATED' && !replaceable(record, true)) throw new Error('WECHAT_AUTHORIZATION_NOT_FOUND');
  }
  record = await reserve(id, openid, record, missing);
  if (record.status === 'CLOSED') throw new AppError('结算授权已关闭，请联系在线客服');
  if (record.status === 'TAKING_EFFECT') return { authorized: true };
  if (record.status === 'CREATED') {
   const response = await api.request('POST', endpoint, {
    out_authorization_no: record.outAuthorizationNo, appid: record.appid, openid: record.openid,
    transfer_scene_id: record.transferSceneId, user_display_name: record.userDisplayName,
    user_recv_perception: '劳务报酬', authorization_notify_url: cfg.notifyUrl
   });
   if (!response || response.state !== 'WAIT_USER_CONFIRM' || typeof response.package_info !== 'string' || !response.package_info) {
    throw new Error('WECHAT_AUTHORIZATION_PREPARE_FAILED');
   }
   record = await apply(id, record, response, false);
  }
  if (record.status === 'TAKING_EFFECT') return { authorized: true };
  if (record.status !== 'WAIT_USER_CONFIRM' || typeof record.package !== 'string' || !record.package) {
   throw new AppError('结算授权状态已变化，请重新接单');
  }
  return { authorized: false, confirm: { appId: record.appid, mchId: record.merchant, package: record.package } };
 }

 async confirm(userId) {
  await new (require('./mail_service.js'))()._user(userId);
  const openid = await currentIdentity(userId), id = key(openid), record = await read(id);
  if (!record) return { authorized: false };
  assertAccount(record, openid);
  const result = await refresh(id, record);
  return { authorized: result.exists && result.record.status === 'TAKING_EFFECT' };
 }

 async require(userId) {
  await new (require('./mail_service.js'))()._user(userId);
  const openid = await currentIdentity(userId), id = key(openid), record = await read(id);
  if (record) {
   assertAccount(record, openid);
   const result = await refresh(id, record);
   if (result.exists && result.record.status === 'TAKING_EFFECT') return result.record;
  }
  throw new AppError('请先开通微信报酬自动到账，再接取此订单');
 }

 async stored(tx, userId) {
  const openid = openidOf(userId);
  if (!openid) throw new AppError('结算账号无效');
  const record = await tenant.system(() => store.get(tx, 'payment', key(openid)));
  if (!record) return null;
  assertAccount(record, openid);
  return record.status === 'TAKING_EFFECT' ? record : null;
 }

 // Only PaymentService.callback may pass an already verified and decrypted authorization event here.
 async notification(data) {
  if (!cfg.ready() || !data || data.appid !== cfg.appid || typeof data.openid !== 'string' || !data.openid ||
      !number(data.out_authorization_no) || !['TAKING_EFFECT', 'CLOSED'].includes(data.state) ||
      !authorizationId(data.authorization_id) || !Number.isFinite(Date.parse(data.authorize_time))) {
   throw new Error('WECHAT_AUTHORIZATION_NOTIFICATION_MISMATCH');
  }
  const id = key(data.openid), record = await read(id);
  assertAccount(record, data.openid);
  if (data.user_display_name !== record.userDisplayName) throw new Error('WECHAT_AUTHORIZATION_NOTIFICATION_MISMATCH');
  if (data.out_authorization_no !== record.outAuthorizationNo) {
   if (record.retiredAuthorizationNos.includes(data.out_authorization_no)) return null;
   throw new Error('WECHAT_AUTHORIZATION_NOTIFICATION_MISMATCH');
  }
  return apply(id, record, data, false);
 }
}

module.exports = EarningsAuthorizationService;
