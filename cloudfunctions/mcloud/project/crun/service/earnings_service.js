'use strict';
const store = require('./operation_store.js');
const config = require('../config/pay_config.js');
const wxpay = require('./wechat_pay_api.js');
const AppError = require('../../../framework/core/app_error.js');

const endpoint = '/v3/fund-app/mch-transfer/transfer-bills';
const terminal = ['SUCCESS', 'FAIL', 'CANCELLED'];

async function read(id) {
 return store.get(store.database(), 'payment', id);
}

async function update(id, record, response) {
 if (!response || response.out_bill_no !== record.billNo || !response.state ||
     response.appid !== record.appid || response.mch_id !== record.merchant ||
     response.transfer_amount !== record.amount ||
     (record.mode !== 'authorized' ? response.openid !== record.openid :
      response.openid !== undefined && response.openid !== record.openid)) {
  throw new Error('WECHAT_TRANSFER_MISMATCH');
 }
 return store.transaction(async tx => {
  const current = await store.get(tx, 'payment', id);
  if (!current || current.billNo !== record.billNo || terminal.includes(current.status)) return current;
  const done = terminal.includes(response.state);
  const updated = { ...current, status: response.state, wechatBillNo: response.transfer_bill_no || current.wechatBillNo || '',
   state: done ? 'transfer_done' : 'transfer_pending', nextCheckAt: done ? 0 : Date.now() + 60000 };
  if (done) {
   const order = await store.get(tx, 'mail', current.orderId);
   if (!order || order.MAIL_ACCEPT_USER_ID !== current.rider || order.MAIL_STATUS !== 9 ||
       order.MAIL_PAYMENT_MODE !== 'wechat' || order.MAIL_PAY_STATUS !== 1 || order.MAIL_REFUND_STATUS ||
       Math.floor(order.MAIL_TOTAL_FEE * 9 / 10) !== current.amount) throw new Error('WECHAT_EARNINGS_ORDER_MISMATCH');
   await store.set(tx, 'mail', current.orderId, { ...order,
    MAIL_EARNINGS_STATUS: response.state === 'SUCCESS' ? 'paid' : 'failed' });
  }
  await store.set(tx, 'payment', id, updated);
  return updated;
 });
}

async function refresh(id, record) {
 try {
  const response = await wxpay.request('GET', endpoint + '/out-bill-no/' + record.billNo);
  return update(id, record, response);
 } catch (error) {
  if (error.code === 'NOT_FOUND' || error.code === 'RESOURCE_NOT_EXISTS') return null;
  throw error;
 }
}

class EarningsService {
 async queue(orderId) {
  if (!config.ready()) throw new AppError('报酬结算暂不可用，请联系在线客服');
  const id = store.scopeKey('transfer', orderId);
  const scope = store.scope();
  return store.transaction(async tx => {
   const order = await store.get(tx, 'mail', orderId);
   if (!order || !order.MAIL_ACCEPT_USER_ID || order.MAIL_USER_ID === order.MAIL_ACCEPT_USER_ID ||
       order.MAIL_STATUS !== 9 || order.MAIL_PAYMENT_MODE !== 'wechat' || order.MAIL_PAY_STATUS !== 1 ||
       order.MAIL_ADMIN_DELETED === true || order.MAIL_REFUND_STATUS || !order.MAIL_TRANSACTION_ID || !order.MAIL_PAY_NO) throw new AppError('此订单暂不可结算报酬');
   const payment = await store.get(tx, 'payment', order.MAIL_PAY_NO);
   if (!payment || payment.orderId !== orderId || !['paid', 'complete'].includes(payment.state) ||
       payment.merchant !== config.mchid || payment.appid !== config.appid || payment.transactionId !== order.MAIL_TRANSACTION_ID ||
       payment.amount !== order.MAIL_TOTAL_FEE || !Number.isSafeInteger(payment.amount) || payment.amount < 1) {
    throw new AppError('订单收款需核对，请联系在线客服');
   }
   const amount = Math.floor(payment.amount * 9 / 10);
   if (amount < 1) throw new AppError('报酬金额需核对，请联系在线客服');
   const userId = order.MAIL_ACCEPT_USER_ID;
   const old = await store.get(tx, 'payment', id);
   if (old) {
    if (old.orderId !== orderId || old.rider !== userId || old.merchant !== payment.merchant ||
        old.appid !== payment.appid || old.openid !== userId.split('^^^').pop() || old.amount !== amount) {
     throw new Error('WECHAT_EARNINGS_RECORD_MISMATCH');
    }
    return id;
   }
   const authorization = await new (require('./earnings_authorization_service.js'))().stored(tx, userId);
   if (!authorization) throw new AppError('骑手尚未授权自动收款，报酬保持待结算');
   const record = { _pid: 'crun', orderId, rider: userId, merchant: payment.merchant, appid: payment.appid,
    openid: userId.split('^^^').pop(), amount, billNo: store.key('earnings', id, 1), attempt: 1,
    mode: 'authorized', outAuthorizationNo: authorization.outAuthorizationNo,
    status: 'CREATED', state: 'transfer_pending', nextCheckAt: Date.now() + 60000,
    ...(scope ? { schoolId: scope.schoolId, campusId: scope.campusId } : {}) };
   await store.set(tx, 'payment', id, record);
   await store.set(tx, 'mail', orderId, { ...order, MAIL_EARNINGS_STATUS: 'pending' });
   return id;
  });
 }

 async reconcile(id) {
  if (!config.ready()) return;
  let record = await read(id);
  if (!record || record.state !== 'transfer_pending' || record.merchant !== config.mchid || record.appid !== config.appid) return;
  // An unknown request outcome must be queried under the same bill before sending again.
  if (record.attemptedAt || record.status !== 'CREATED' || record.mode !== 'authorized') {
   const queried = await refresh(id, record);
   if (queried) return;
   if (record.mode !== 'authorized' || record.status !== 'CREATED') throw new Error('WECHAT_TRANSFER_NOT_FOUND');
  }
  record = await store.transaction(async tx => {
   const current = await store.get(tx, 'payment', id);
   if (!current || current.state !== 'transfer_pending' || current.status !== 'CREATED') return null;
   const order = await store.get(tx, 'mail', current.orderId);
   if (!order || order.MAIL_STATUS !== 9 || order.MAIL_ACCEPT_USER_ID !== current.rider ||
       order.MAIL_PAYMENT_MODE !== 'wechat' || order.MAIL_PAY_STATUS !== 1 || order.MAIL_REFUND_STATUS ||
       Math.floor(order.MAIL_TOTAL_FEE * 9 / 10) !== current.amount) throw new Error('WECHAT_EARNINGS_ORDER_MISMATCH');
   const updated = { ...current, attemptedAt: Date.now() };
   await store.set(tx, 'payment', id, updated);
   return updated;
  });
  if (record) {
   const response = await wxpay.request('POST', endpoint + '/transfer', {
    appid: record.appid, out_bill_no: record.billNo, transfer_scene_id: '1005',
    transfer_amount: record.amount, transfer_remark: '校园跑腿服务报酬', user_recv_perception: '劳务报酬',
    transfer_scene_report_infos: [
     { info_type: '岗位类型', info_content: '校园跑腿服务' },
     { info_type: '报酬说明', info_content: '校园跑腿订单完单报酬' }
    ], out_authorization_no: record.outAuthorizationNo
   });
   await update(id, record, response);
  }
 }
}

module.exports = EarningsService;
