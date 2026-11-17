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

// 微信文档「发起商家转账」应答仅含 out_bill_no、transfer_bill_no、create_time、state、package_info；
// appid、mch_id、transfer_amount、openid 等字段仅在返回时比对，不要求必须存在。
const transferStates = ['ACCEPTED', 'PROCESSING', 'WAIT_USER_CONFIRM', 'TRANSFERING', 'SUCCESS', 'FAIL', 'CANCELING', 'CANCELLED'];
function sameIfPresent(value, expected) {
 return value === undefined || value === expected;
}

async function update(id, record, response) {
 if (!response || response.out_bill_no !== record.billNo || !transferStates.includes(response.state) ||
     !sameIfPresent(response.appid, record.appid) || !sameIfPresent(response.mch_id, record.merchant) ||
     !sameIfPresent(response.transfer_amount, record.amount) || !sameIfPresent(response.openid, record.openid)) {
  throw new Error('WECHAT_TRANSFER_MISMATCH');
 }
 // 待确认收款必须带 package_info，否则骑手端无法拉起收款页
 if (response.state === 'WAIT_USER_CONFIRM' && (typeof response.package_info !== 'string' || !response.package_info)) {
  throw new Error('WECHAT_TRANSFER_PACKAGE_MISSING');
 }
 return store.transaction(async tx => {
  const current = await store.get(tx, 'payment', id);
  if (!current || current.billNo !== record.billNo || terminal.includes(current.status)) return current;
  const done = terminal.includes(response.state);
  const updated = { ...current, status: response.state, wechatBillNo: response.transfer_bill_no || current.wechatBillNo || '',
   packageInfo: response.state === 'WAIT_USER_CONFIRM' ? (response.package_info || current.packageInfo || '') : '',
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

// 骑手超过 24 小时未确认收款，撤销转账（仅 WAIT_USER_CONFIRM 状态可撤销）
const confirmWindowMs = 24 * 3600000;
async function cancelIfExpired(id, record) {
 if (!record || record.mode !== 'confirm' || record.status !== 'WAIT_USER_CONFIRM') return;
 if (Date.now() - (record.attemptedAt || 0) < confirmWindowMs) return;
 const response = await wxpay.request('POST', endpoint + '/out-bill-no/' + record.billNo + '/cancel', {});
 // 撤销是异步的：CANCELING 时保持待结算，由后续查询收敛到终态
 if (!response || response.out_bill_no !== record.billNo || !terminal.includes(response.state)) return;
 await store.transaction(async tx => {
  const current = await store.get(tx, 'payment', id);
  if (!current || current.billNo !== record.billNo || terminal.includes(current.status)) return;
  const order = await store.get(tx, 'mail', current.orderId);
  await store.set(tx, 'payment', id, { ...current, status: response.state, state: 'transfer_done', packageInfo: '', nextCheckAt: 0 });
  if (order && order.MAIL_EARNINGS_STATUS === 'pending') await store.set(tx, 'mail', current.orderId, { ...order, MAIL_EARNINGS_STATUS: 'failed' });
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
 // 系统上下文中只读取指针，得到记录所属校区，供回调进入对应租户后处理
 async locate(billNo) {
  const pointer = await read(billNo);
  if (!pointer || pointer.kind !== 'transfer_pointer' || !pointer.transferId || !pointer.schoolId) return null;
  return { schoolId: pointer.schoolId, campusId: pointer.campusId };
 }

 // 回调只作为触发信号：以签名查询结果为准更新状态，避免相信未核验的通知内容
 async notification(data) {
  const pointer = await read(data.out_bill_no);
  if (!pointer || pointer.kind !== 'transfer_pointer' || !pointer.transferId) return null;
  const record = await read(pointer.transferId);
  if (!record || record.billNo !== data.out_bill_no) return null;
  return refresh(pointer.transferId, record);
 }

 // 骑手在「我的订单」详情页拉起确认收款所需的参数
 async confirmPackage(userId, orderId) {
  const order = await store.get(store.database(), 'mail', orderId);
  if (!order || order.MAIL_ACCEPT_USER_ID !== userId || order.MAIL_STATUS !== 9) throw new AppError('此订单暂无待确认报酬');
  // 与 queue 使用同一 scopeKey：骑手请求处于订单所在校区上下文中，记录 id 一致
  const record = await read(store.scopeKey('transfer', orderId));
  if (!record || record.rider !== userId || record.mode !== 'confirm' || record.state !== 'transfer_pending' ||
      record.status !== 'WAIT_USER_CONFIRM' || !record.packageInfo) return { confirm: null };
  return { confirm: { appId: record.appid, mchId: record.merchant, package: record.packageInfo } };
 }

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
   const record = { _pid: 'crun', orderId, rider: userId, merchant: payment.merchant, appid: payment.appid,
    openid: userId.split('^^^').pop(), amount, billNo: store.key('earnings', id, 1), attempt: 1,
    mode: 'confirm',
    status: 'CREATED', state: 'transfer_pending', nextCheckAt: Date.now() + 60000,
    ...(scope ? { schoolId: scope.schoolId, campusId: scope.campusId } : {}) };
   await store.set(tx, 'payment', id, record);
   await store.set(tx, 'payment', record.billNo, { _pid: 'crun', kind: 'transfer_pointer', transferId: id,
    ...(scope ? { schoolId: scope.schoolId, campusId: scope.campusId } : {}) });
   await store.set(tx, 'mail', orderId, { ...order, MAIL_EARNINGS_STATUS: 'pending' });
   return id;
  });
 }

 async reconcile(id) {
  if (!config.ready()) return;
  let record = await read(id);
  if (!record || record.merchant !== config.mchid || record.appid !== config.appid) return;
  // 等待骑手确认的转账：仅在超时时查询并撤销，否则保持等待
  if (record.state === 'transfer_pending' && record.status === 'WAIT_USER_CONFIRM') {
   if (Date.now() - (record.attemptedAt || 0) < confirmWindowMs) return;
   const queried = await refresh(id, record);
   if (queried) await cancelIfExpired(id, queried);
   return;
  }
  if (record.state !== 'transfer_pending') return;
  // An unknown request outcome must be queried under the same bill before sending again.
  if (record.attemptedAt || record.status !== 'CREATED') {
   const queried = await refresh(id, record);
   if (queried) { await cancelIfExpired(id, queried); return; }
   if (record.status !== 'CREATED') throw new Error('WECHAT_TRANSFER_NOT_FOUND');
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
   // 文档：转账金额 >= 2000 元时必须传收款用户真实姓名（需加密），当前报酬不会达到该额度
   if (record.amount >= 200000) throw new Error('WECHAT_TRANSFER_NAME_REQUIRED');
   const response = await wxpay.request('POST', endpoint + '/transfer', {
    appid: record.appid, out_bill_no: record.billNo, transfer_scene_id: '1005', openid: record.openid,
    transfer_amount: record.amount, transfer_remark: '校园跑腿服务报酬', user_recv_perception: '劳务报酬',
    transfer_scene_report_infos: [
     { info_type: '岗位类型', info_content: '校园跑腿服务' },
     { info_type: '报酬说明', info_content: '校园跑腿订单完单报酬' }
    ]
   });
   await update(id, record, response);
  }
 }
}

module.exports = EarningsService;
