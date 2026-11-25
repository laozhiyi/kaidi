'use strict';
const crypto = require('crypto');
const store = require('./operation_store.js');
const cloud = require('../../../framework/cloud/cloud_base.js');
const tenant = require('../../../framework/tenancy/tenant_context.js');
const AppError = require('../../../framework/core/app_error.js');
const cfg = require('../config/pay_config.js');
const api = require('./wechat_pay_api.js');

const transactions = '/v3/pay/transactions/out-trade-no/';
const refunds = '/v3/refund/domestic/refunds';
const active = ['pending', 'paid', 'transfer_pending'];
let reportedInvalidConfig = false;

class PaymentService {
 static newOrderMode() {
  if (cfg.provider === 'adapay') {
   if (cfg.adapayReady()) return 'adapay';
   if (!reportedInvalidConfig) {
    reportedInvalidConfig = true;
    console.warn('[adapay] invalid config', {invalidFields:require('../config/adapay_config.js').invalidFields()});
   }
   return 'unavailable';
  }
  if (cfg.provider && cfg.provider !== 'wechat') return 'unavailable';
  if (!cfg.requested()) return 'offline';
  const invalidFields = cfg.invalidFields();
  if (!invalidFields.length) return 'wechat';
  if (!reportedInvalidConfig) {
   reportedInvalidConfig = true;
   console.warn('[payment] invalid config', { invalidFields });
  }
  return 'unavailable';
 }

 async owned(userId, id) {
  await new (require('./mail_service.js'))()._user(userId, {allowPending:true});
  const row = await store.get(store.database(), 'mail', id);
  if (!row || row.MAIL_USER_ID !== userId || row.MAIL_ADMIN_DELETED === true) throw new AppError('订单不存在');
  return row;
 }

 async prepare(userId, id) {
  const ownedOrder = await this.owned(userId,id);
  if (ownedOrder.MAIL_PAYMENT_MODE === 'adapay') return new (require('./adapay_payment_service.js'))().prepare(userId,id);
  if (!cfg.ready()) throw new AppError('微信支付暂不可用');
  await this.owned(userId, id);
  const wx = cloud.getCloud().getWXContext();
  if (wx.APPID !== cfg.appid || wx.OPENID !== userId.split('^^^').pop()) throw new AppError('支付账号与当前小程序不匹配');
  const scope = store.scope();
  const order = await store.transaction(async tx => {
   const row = await store.get(tx, 'mail', id);
   if (!row || row.MAIL_USER_ID !== userId || row.MAIL_PAYMENT_MODE !== 'wechat' || row.MAIL_STATUS !== -1 ||
       row.MAIL_ADMIN_DELETED === true || row.MAIL_END_TIME <= Date.now()) throw new AppError('当前订单不可支付');
   const old = await store.get(tx, 'payment', row.MAIL_PAY_NO);
   if (old && (old.state !== 'pending' || old.appid !== cfg.appid || old.merchant !== cfg.mchid)) {
    throw new AppError('支付单状态已变化，请联系在线客服');
   }
   if (!old) await store.set(tx, 'payment', row.MAIL_PAY_NO, {
    _pid:'crun', orderId:id, userId, merchant:cfg.mchid, appid:cfg.appid, openid:wx.OPENID,
    amount:row.MAIL_TOTAL_FEE, state:'pending', createdAt:Date.now(), nextCheckAt:Date.now()+60000,
    ...(scope ? {schoolId:scope.schoolId,campusId:scope.campusId} : {})
   });
   return row;
  });
  try {
   const result = await api.request('POST', '/v3/pay/transactions/jsapi', {
    appid:cfg.appid, mchid:cfg.mchid, description:'云速取跑腿服务费', out_trade_no:order.MAIL_PAY_NO, notify_url:cfg.notifyUrl,
    time_expire:new Date(order.MAIL_END_TIME).toISOString().replace(/\.\d{3}Z$/, '+00:00'),
    amount:{total:order.MAIL_TOTAL_FEE,currency:'CNY'}, payer:{openid:wx.OPENID}
   });
   if (!result || !result.prepay_id) throw new Error('MISSING_PREPAY_ID');
   const timeStamp = String(Math.floor(Date.now()/1000));
   const nonceStr = crypto.randomBytes(16).toString('hex');
   const pkg = 'prepay_id=' + result.prepay_id;
   const paySign = api.sign([cfg.appid,timeStamp,nonceStr,pkg,''].join('\n'));
   return { payment:{timeStamp,nonceStr,package:pkg,signType:'RSA',paySign}, id };
  } catch (error) {
   console.error('[payment] prepare failed', error.code || error.message);
   throw new AppError('微信支付下单失败，请稍后重试');
  }
 }

 async status(userId,id) {
  const order = await this.owned(userId,id);
  if (['wechat','adapay'].includes(order.MAIL_PAYMENT_MODE) && order.MAIL_PAY_NO) await this.reconcile(order.MAIL_PAY_NO);
  const row = await this.owned(userId,id);
  return {paid:row.MAIL_PAY_STATUS===1,published:row.MAIL_PAY_STATUS===1 && ![-1,99].includes(row.MAIL_STATUS),
   status:row.MAIL_STATUS,refundStatus:row.MAIL_REFUND_STATUS || ''};
 }

 async reconcile(id, notified) {
  const db = store.database();
  const payment = await store.get(db,'payment',id);
  if (!payment || !['pending','paid'].includes(payment.state)) return;
  if (payment.provider === 'adapay') return new (require('./adapay_payment_service.js'))().reconcile(id);
  if (!cfg.ready() || payment.appid !== cfg.appid || payment.merchant !== cfg.mchid) throw new Error('PAYMENT_CONFIGURATION_MISMATCH');
  if (payment.state === 'pending') {
   let result = notified;
   if (!result) {
    try { result = await api.request('GET', transactions + id + '?mchid=' + payment.merchant); }
    catch (error) {
     if (['ORDER_NOT_EXIST','ORDERNOTEXIST'].includes(error.code)) return;
     throw error;
    }
   }
   if (!result || !result.trade_state) throw new Error('PAYMENT_QUERY_FAILED');
   if (result.trade_state === 'SUCCESS') {
    if (result.out_trade_no !== id || result.mchid !== payment.merchant || result.appid !== payment.appid ||
        result.payer?.openid !== payment.openid || result.amount?.total !== payment.amount ||
        result.amount?.currency !== 'CNY' || !result.transaction_id) throw new Error('PAYMENT_MISMATCH');
    await this.applyPaid(id, payment, result.transaction_id);
   } else {
    const order = await store.get(db,'mail',payment.orderId);
    const closed = ['CLOSED','REVOKED','PAYERROR'].includes(result.trade_state);
    if (!closed) {
     if (!order || !['NOTPAY','USERPAYING'].includes(result.trade_state) || order.MAIL_STATUS !== 99 && order.MAIL_END_TIME > Date.now()) return;
     await api.request('POST', transactions + id + '/close', {mchid:payment.merchant});
    }
    await this.finish(id,'pending','closed');
    return;
   }
  }

  const order = await store.get(db,'mail',payment.orderId);
  if (order?.MAIL_STATUS === 99 && order.MAIL_PAY_STATUS === 1) await this.refund(id,payment);
  else if (order?.MAIL_STATUS === 9 && order.MAIL_PAY_STATUS === 1) {
   const earnings = new (require('./earnings_service.js'))();
   const transferId = await earnings.queue(payment.orderId);
   await this.finish(id,'paid','complete');
   await earnings.reconcile(transferId);
  }
 }

 async applyPaid(id, payment, transactionId) {
  await store.transaction(async tx => {
   const record = await store.get(tx,'payment',id);
   if (record?.state !== 'pending') return;
   const order = await store.get(tx,'mail',payment.orderId);
   if (!order || order.MAIL_PAY_NO !== id || order.MAIL_TOTAL_FEE !== payment.amount || order.MAIL_PAYMENT_MODE !== 'wechat') {
    throw new Error('PAYMENT_ORDER_MISMATCH');
   }
   order._id = payment.orderId;
   order.MAIL_PAY_STATUS = 1;
   order.MAIL_EARNINGS_STATUS = 'pending';
   order.MAIL_PAY_TIME = Date.now();
   order.MAIL_TRANSACTION_ID = transactionId;
   const service = new (require('./mail_service.js'))();
   service.getProjectId = () => 'crun';
   if (order.MAIL_STATUS === -1 && order.MAIL_END_TIME > Date.now()) {
    order.MAIL_STATUS = 0;
    await service._record(tx,order,{userId:order.MAIL_USER_ID},'payment',store.key('payment',id),'微信支付已确认，订单已发布');
   } else {
    if (order.MAIL_STATUS === -1) {
     order.MAIL_STATUS = 99;
     await service._quota(tx,order.MAIL_USER_ID,'poster',payment.orderId,false,0);
    }
    if (order.MAIL_STATUS === 99) order.MAIL_REFUND_STATUS = 'pending';
    await store.set(tx,'mail',payment.orderId,order);
   }
   await store.set(tx,'payment',id,{...record,state:'paid',transactionId,nextCheckAt:Date.now()+60000});
  });
 }

 async finish(id, previous, state) {
  await store.transaction(async tx => {
   const row = await store.get(tx,'payment',id);
   if (row?.state === previous) await store.set(tx,'payment',id,{...row,state,nextCheckAt:0});
  });
 }

 async refund(id,payment) {
  const outRefundNo = store.key('refund',id);
  const result = await api.request('POST',refunds,{
   out_trade_no:id,out_refund_no:outRefundNo,reason:'订单已取消',
   amount:{refund:payment.amount,total:payment.amount,currency:'CNY'}
  });
  const status = result?.status === 'SUCCESS' ? result : await api.request('GET',refunds + '/' + outRefundNo);
  if (status?.out_refund_no !== outRefundNo || status.out_trade_no !== id ||
      status.amount?.refund !== payment.amount || status.amount?.total !== payment.amount) throw new Error('REFUND_MISMATCH');
  const done = status.status === 'SUCCESS';
  await store.transaction(async tx => {
   const record = await store.get(tx,'payment',id);
   const row = await store.get(tx,'mail',payment.orderId);
   if (!row || row.MAIL_STATUS !== 99 || row.MAIL_PAY_NO !== id || record?.state !== 'paid') return;
   row.MAIL_REFUND_STATUS = done ? 'success' : status.status === 'PROCESSING' ? 'processing' : 'needs_review';
   if (done) row.MAIL_PAY_STATUS = 2;
   await store.set(tx,'mail',payment.orderId,row);
   await store.set(tx,'payment',id,{...record,state:done?'refunded':'paid',nextCheckAt:done?0:Date.now()+60000});
  });
 }

 async sweep(deadline = Date.now() + 10000) {
  if (!cfg.ready() && !(cfg.adapayReady && cfg.adapayReady())) return;
  await tenant.system(async () => {
   const db = store.database();
   const rows = (await db.collection(store.collection('payment')).where({
    _pid:'crun',state:db.command.in(active),nextCheckAt:db.command.lte(Date.now())
   }).orderBy('nextCheckAt','asc').limit(10).get()).data;
   const windowEnd = Math.min(deadline,Date.now()+10000);
   for (const row of rows) {
    if (Date.now() >= windowEnd) break;
    try {
     await tenant.run({schoolId:row.schoolId,campusId:row.campusId},() => row.state === 'transfer_pending'
      ? new (require('./earnings_service.js'))().reconcile(row._id) : this.reconcile(row._id));
    } catch (error) { console.error('[payment] reconcile failed',row._id,error.code || error.message); }
    await store.transaction(async tx => {
     const current = await store.get(tx,'payment',row._id);
     if (current && active.includes(current.state) && current.nextCheckAt <= Date.now()) {
      await store.set(tx,'payment',row._id,{...current,nextCheckAt:Date.now()+60000});
     }
    });
   }
  });
 }

 async callback(event) {
  let notice;
  try {
   if (!cfg.ready()) return {statusCode:503,body:''};
   notice = api.notification(event);
   if (['MCHTRANSFER.AUTHORIZATION.CONFIRMED','MCHTRANSFER.AUTHORIZATION.CLOSED'].includes(notice.type)) {
    const expected = notice.type === 'MCHTRANSFER.AUTHORIZATION.CONFIRMED' ? 'TAKING_EFFECT' : 'CLOSED';
    if (notice.data.state !== expected) return {statusCode:400,body:''};
    await tenant.system(() => new (require('./earnings_authorization_service.js'))().notification(notice.data));
    return {statusCode:204,body:''};
   }
   if (notice.type === 'MCHTRANSFER.BILL.FINISHED') {
    if (!['SUCCESS','FAIL','CANCELLED'].includes(notice.data.state) || !/^[A-Za-z0-9]{5,32}$/.test(notice.data.out_bill_no || '')) return {statusCode:400,body:''};
    const transfer = await tenant.system(async () => new (require('./earnings_service.js'))().locate(notice.data.out_bill_no));
    if (!transfer) return {statusCode:204,body:''};
    await tenant.run({schoolId:transfer.schoolId,campusId:transfer.campusId},() => new (require('./earnings_service.js'))().notification(notice.data));
    return {statusCode:204,body:''};
   }
   if (notice.type !== 'TRANSACTION.SUCCESS' || notice.data.trade_state !== 'SUCCESS' ||
       !/^[a-f0-9]{32}$/.test(notice.data.out_trade_no)) return {statusCode:400,body:''};
  } catch (_) { return {statusCode:401,body:''}; }
  try {
   await tenant.system(async () => {
    const id = notice.data.out_trade_no;
    const record = await store.get(store.database(),'payment',id);
    if (!record?.schoolId || !record.campusId) throw new Error('PAYMENT_NOT_FOUND');
    await tenant.run({schoolId:record.schoolId,campusId:record.campusId},() => this.reconcile(id,notice.data));
   });
   return {statusCode:204,body:''};
  } catch (error) {
   console.error('[payment] notification failed',error.code || error.message);
   return {statusCode:500,body:''};
  }
 }
}

module.exports = PaymentService;
