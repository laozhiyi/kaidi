'use strict';
const store = require('./operation_store.js');
const config = require('../config/pay_config.js');
const wxpay = require('./wechat_pay_api.js');
const AppError = require('../../../framework/core/app_error.js');

const endpoint = '/v3/fund-app/mch-transfer/transfer-bills';
const terminal = ['FAIL', 'CANCELLED'];

function view(record) {
 const result = { status: record.status, amount: record.amount };
 if (record.status === 'WAIT_USER_CONFIRM' && record.package) {
  result.confirm = { appId: record.appid, mchId: record.merchant, package: record.package };
 }
 return result;
}

async function read(id) {
 return store.get(store.database(), 'payment', id);
}

async function update(id, record, response, queried) {
 if (!response || response.out_bill_no !== record.billNo || !response.state ||
     (queried && (response.appid !== record.appid || response.mch_id !== record.merchant ||
      response.openid !== record.openid || response.transfer_amount !== record.amount))) {
  throw new Error('WECHAT_TRANSFER_MISMATCH');
 }
 return store.transaction(async tx => {
  const current = await store.get(tx, 'payment', id);
  if (!current || current.billNo !== record.billNo || current.status === 'SUCCESS' || terminal.includes(current.status)) return current;
  if (!queried && current.status !== 'CREATED' && current.status !== response.state) return current;
  const updated = { ...current, status: response.state, package: response.state === 'WAIT_USER_CONFIRM'
   ? response.package_info || current.package || '' : '', wechatBillNo: response.transfer_bill_no || current.wechatBillNo || '',
   state: response.state === 'SUCCESS' || terminal.includes(response.state) ? 'transfer_done' : 'transfer_pending',
   nextCheckAt: Date.now() + 60000 };
  if (updated.status === 'SUCCESS') {
   const order = await store.get(tx, 'mail', current.orderId);
   if (!order || order.MAIL_ACCEPT_USER_ID !== current.rider || order.MAIL_STATUS !== 9) throw new Error('WECHAT_EARNINGS_ORDER_MISMATCH');
   await store.set(tx, 'mail', current.orderId, { ...order, MAIL_EARNINGS_STATUS: 'paid' });
  }
  await store.set(tx, 'payment', id, updated);
  return updated;
 });
}

async function refresh(id, record) {
 try {
  const response = await wxpay.request('GET', endpoint + '/out-bill-no/' + record.billNo);
  return update(id, record, response, true);
 } catch (error) {
  if (error.code === 'NOT_FOUND' || error.code === 'RESOURCE_NOT_EXISTS') return record;
  throw error;
 }
}

class EarningsService {
 async claim(userId, orderId, start) {
  if (!config.ready()) throw new AppError('报酬结算暂不可用，请联系在线客服');
  await new (require('./mail_service.js'))()._user(userId, {allowPending:true});
  const id = store.scopeKey('transfer', orderId);
  const scope = store.scope();
  const reserve = expected => store.transaction(async tx => {
   const order = await store.get(tx, 'mail', orderId);
   if (!order || order.MAIL_ACCEPT_USER_ID !== userId || order.MAIL_USER_ID === userId ||
       order.MAIL_STATUS !== 9 || order.MAIL_PAYMENT_MODE !== 'wechat' || order.MAIL_PAY_STATUS !== 1 ||
       order.MAIL_ADMIN_DELETED === true || order.MAIL_REFUND_STATUS || !order.MAIL_TRANSACTION_ID || !order.MAIL_PAY_NO) throw new AppError('此订单暂不可领取报酬');
   const payment = await store.get(tx, 'payment', order.MAIL_PAY_NO);
   if (!payment || payment.orderId !== orderId || !['paid', 'complete'].includes(payment.state) ||
       payment.merchant !== config.mchid || payment.appid !== config.appid || payment.transactionId !== order.MAIL_TRANSACTION_ID ||
       payment.amount !== order.MAIL_TOTAL_FEE || !Number.isSafeInteger(payment.amount) || payment.amount < 1) {
    throw new AppError('订单收款需核对，请联系在线客服');
   }
   const old = await store.get(tx, 'payment', id);
   if (old && (!expected || old.billNo !== expected || !terminal.includes(old.status))) return old;
   const amount = Math.floor(payment.amount * 9 / 10);
   if (amount < 1) throw new AppError('报酬金额需核对，请联系在线客服');
   if (!start) return { status: 'AVAILABLE', amount };
   const attempt = old ? old.attempt + 1 : 1;
   const record = { _pid: 'crun', orderId, rider: userId, merchant: payment.merchant, appid: payment.appid,
    openid: userId.split('^^^').pop(), amount, billNo: store.key('earnings', id, attempt), attempt,
    status: 'CREATED', state: 'transfer_pending', nextCheckAt: Date.now() + 60000,
    ...(scope ? { schoolId: scope.schoolId, campusId: scope.campusId } : {}) };
   await store.set(tx, 'payment', id, record);
   return record;
  });

  let record = await reserve();
  if (record.rider && (record.rider !== userId || record.appid !== config.appid || record.merchant !== config.mchid)) {
   throw new AppError('报酬账户需核对，请联系在线客服');
  }
  if (record.state === 'transfer_pending' && (!start || record.status !== 'CREATED')) record = await refresh(id, record);
  if (start && terminal.includes(record.status)) record = await reserve(record.billNo);
  if (start && (record.status === 'CREATED' || record.status === 'WAIT_USER_CONFIRM' && !record.package)) {
   const response = await wxpay.request('POST', endpoint, {
    appid: record.appid, out_bill_no: record.billNo, transfer_scene_id: '1005', openid: record.openid,
    transfer_amount: record.amount, transfer_remark: '校园跑腿服务报酬', user_recv_perception: '劳务报酬',
    transfer_scene_report_infos: [
     { info_type: '岗位类型', info_content: '校园跑腿服务' },
     { info_type: '报酬说明', info_content: '校园跑腿订单完单报酬' }
    ]
   });
   record = await update(id, record, response, false);
  }
  return view(record);
 }

 async reconcile(id) {
  if (!config.ready()) return;
  const record = await read(id);
  if (record && record.state === 'transfer_pending' && record.merchant === config.mchid && record.appid === config.appid) {
   await refresh(id, record);
  }
 }
}

module.exports = EarningsService;
