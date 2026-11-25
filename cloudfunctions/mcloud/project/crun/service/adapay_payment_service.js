'use strict';
const store = require('./operation_store.js');
const cfg = require('../config/adapay_config.js');
const api = require('./adapay_api.js');
const tenant = require('../../../framework/tenancy/tenant_context.js');
const cloud = require('../../../framework/cloud/cloud_base.js');
const AppError = require('../../../framework/core/app_error.js');
const accounts = () => new (require('./adapay_account_service.js'))();
function bound(p) {
 if (!cfg.ready() || p.provider !== 'adapay' || p.appid !== cfg.appid || p.prod !== cfg.prod) throw new Error('ADAPAY_CONFIGURATION_MISMATCH');
}
function check(p, data, id) {
 if (!data || !data.id || data.order_no !== id || api.cents(data.pay_amt) !== p.amount || data.pay_channel !== 'wx_lite' ||
     data.app_id && data.app_id !== p.appid || data.prod_mode !== undefined && String(data.prod_mode) !== String(p.prod) ||
     data.expend?.open_id && data.expend.open_id !== p.openid || data.pay_mode && data.pay_mode !== 'delay' ||
     p.providerId && data.id !== p.providerId || data.currency && data.currency !== 'cny') throw new Error('ADAPAY_PAYMENT_MISMATCH');
}
function checkout(data) {
 let pay=data?.expend?.pay_info;
 if (typeof pay === 'string') {try {pay=JSON.parse(pay);}catch(_){throw new AppError('支付参数尚未就绪，请稍后重试');}}
 if (!pay || !/^prepay_id=/.test(pay.package || '') || !pay.timeStamp || !pay.nonceStr || !pay.paySign || !['RSA','MD5','HMAC-SHA256'].includes(pay.signType) || pay.appId && pay.appId !== cfg.wxAppid) throw new AppError('支付参数尚未就绪，请稍后重试');
 return {timeStamp:String(pay.timeStamp),nonceStr:pay.nonceStr,package:pay.package,signType:pay.signType,paySign:pay.paySign};
}
class AdapayPaymentService {
 async prepare(userId,id) {
  if (!cfg.ready()) throw new AppError('在线支付配置尚未完成，请联系管理员');
  const wx=cloud.getCloud().getWXContext();
  if (wx.APPID !== cfg.wxAppid || wx.OPENID !== userId.split('^^^').pop()) throw new AppError('支付身份不匹配');
  const scope=store.scope();
  const p=await store.transaction(async tx => {
   const o=await store.get(tx,'mail',id);
   if (!o || o.MAIL_USER_ID!==userId || o.MAIL_PAYMENT_MODE!=='adapay' || o.MAIL_STATUS!==-1 || o.MAIL_ADMIN_DELETED || o.MAIL_END_TIME<=Date.now()) throw new AppError('当前订单不可支付');
   let row=await store.get(tx,'payment',o.MAIL_PAY_NO);
   if (!row) row={_pid:'crun',provider:'adapay',appid:cfg.appid,prod:cfg.prod,orderId:id,userId,openid:wx.OPENID,
    amount:o.MAIL_TOTAL_FEE,state:'pending',createdAt:Date.now(),nextCheckAt:Date.now()+60000,...(scope?{schoolId:scope.schoolId,campusId:scope.campusId}:{})};
   bound(row);
   if(row.state!=='pending'||row.leaseUntil>Date.now())throw new AppError('支付请求处理中，请稍后核对订单');
   await store.set(tx,'payment',o.MAIL_PAY_NO,{...row,leaseUntil:Date.now()+30000});
   return {...row,id:o.MAIL_PAY_NO};
  });
  try {
   let data=await this.query(p.id,p);
   if (data?.status==='succeeded') {await this.reconcile(p.id);throw new AppError('订单付款已确认，请刷新订单');}
   if (!data) {
    const o=await store.get(store.database(),'mail',id);
    const remain=Math.min(o.MAIL_END_TIME-Date.now(),2*3600000);
    if(remain<60000)throw new AppError('订单临近截止，请重新发布');
    const d=new Date(Date.now()+remain);
    const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(d);
    const date=Object.fromEntries(parts.map(x=>[x.type,x.value]));
    // Delay-mode payment creation rejects a nonempty fee_mode. Select external
    // merchant fees on /payments/confirm when the funds are actually split.
    data=await api.request('POST','/v1/payments',{order_no:p.id,pay_channel:'wx_lite',pay_mode:'delay',
     currency:'cny',pay_amt:api.money(p.amount),goods_title:'云速取跑腿服务费',goods_desc:'校园跑腿服务',notify_url:cfg.notifyUrl,
     time_expire:date.year+date.month+date.day+date.hour+date.minute+date.second,
     expend:{open_id:p.openid,wx_app_id:cfg.wxAppid,is_raw:'1'},device_info:{device_ip:wx.CLIENTIP || wx.CLIENTIPV6 || ''}});
    check(p,data,p.id);
    await this.patch(p.id,{providerId:data.id,checkout:checkout(data),checkoutExpiresAt:Date.now()+remain});
   }
   return {id,payment:p.checkout && p.checkoutExpiresAt>Date.now()?p.checkout:checkout(data)};
  } finally {await this.patch(p.id,{leaseUntil:0});}
 }
 async patch(id,fields) {return store.transaction(async tx=>{const p=await store.get(tx,'payment',id);if(p)await store.set(tx,'payment',id,{...p,...fields});});}
 async query(id,p) {
  bound(p);
  let data;
  if(p.providerId)data=await api.request('GET','/v1/payments/'+p.providerId,{payment_id:p.providerId});
  else {
   const list=await api.request('GET','/v1/payments/list',{order_no:id,page_size:2,page_index:1});
   if(list.status!=='succeeded'||!Array.isArray(list.payments)&&list.payments!==undefined)throw new Error('ADAPAY_QUERY_FAILED');
   const rows=(list.payments||[]).filter(x=>x.order_no===id);
   if(rows.length>1||list.has_more)throw new Error('ADAPAY_DUPLICATE_PAYMENT');
   if(!rows.length)return null;
   data=await api.request('GET','/v1/payments/'+rows[0].id,{payment_id:rows[0].id});
  }
  check(p,data,id);return data;
 }
 async reconcile(id) {
  let p=await store.get(store.database(),'payment',id);
  if(!p||p.provider!=='adapay'||!['pending','paid'].includes(p.state))return;
  bound(p);
  const data=p.state === 'pending' ? await this.query(id,p) : null;
  let o=await store.get(store.database(),'mail',p.orderId);
  if(!o)throw new Error('ADAPAY_ORDER_MISSING');
  if(p.state==='pending') {
   if(!data)return;
   if(data.status!=='succeeded') {
    if(o.MAIL_STATUS===99 || o.MAIL_END_TIME<=Date.now()) {
     if(!['closed','failed'].includes(data.status))await api.request('POST','/v1/payments/'+data.id+'/close',{payment_id:data.id,notify_url:cfg.notifyUrl});
     // A successful close request is not proof that payment failed; re-query on the next pass.
     if(['closed','failed'].includes(data.status))await this.patch(id,{state:'closed',nextCheckAt:0});
    }
    return;
   }
   await store.transaction(async tx=>{
    const current=await store.get(tx,'payment',id), order=await store.get(tx,'mail',p.orderId);
    if(current?.state!=='pending')return;
    if(!order||order.MAIL_PAYMENT_MODE!=='adapay'||order.MAIL_PAY_NO!==id||order.MAIL_TOTAL_FEE!==p.amount)throw new Error('ADAPAY_ORDER_MISMATCH');
    Object.assign(order,{_id:p.orderId,MAIL_PAY_STATUS:1,MAIL_PAY_TIME:Date.now(),MAIL_TRANSACTION_ID:data.id,MAIL_EARNINGS_STATUS:'pending'});
    if(order.MAIL_STATUS===-1&&order.MAIL_END_TIME>Date.now()) {
     order.MAIL_STATUS=0;
     const svc=new(require('./mail_service.js'))();svc.getProjectId=()=> 'crun';
     await svc._record(tx,order,{userId:p.userId},'payment',store.key('payment',id),'微信支付已确认，订单已发布');
    } else {
     if(order.MAIL_STATUS===-1){order.MAIL_STATUS=99;const svc=new(require('./mail_service.js'))();svc.getProjectId=()=> 'crun';await svc._quota(tx,p.userId,'poster',p.orderId,false,0);}
     if(order.MAIL_STATUS===99)order.MAIL_REFUND_STATUS='pending';
     await store.set(tx,'mail',p.orderId,order);
    }
    await store.set(tx,'payment',id,{...current,state:'paid',providerId:data.id,nextCheckAt:Date.now()+60000});
   });
  }
  p=await store.get(store.database(),'payment',id);o=await store.get(store.database(),'mail',p.orderId);
  if(p.state!=='paid')return;
  if(o.MAIL_STATUS===99)await this.operation(id,'refund');
  else if(o.MAIL_STATUS===9)await this.operation(id,'split');
 }
 async operation(id,kind) {
  const name=kind==='refund'?'reverse':'confirm', scope=store.scope();
  const p=await store.transaction(async tx=>{
   const row=await store.get(tx,'payment',id), o=row&&await store.get(tx,'mail',row.orderId);
   if(!row||row.state!=='paid'||row.operationLease>Date.now())return null;
   bound(row);
   if(!o||o.MAIL_PAYMENT_MODE!=='adapay'||o.MAIL_PAY_NO!==id||o.MAIL_TOTAL_FEE!==row.amount||o.MAIL_PAY_STATUS!==1||
     o.MAIL_STATUS!==(kind==='refund'?99:9)||kind==='split'&&o.MAIL_REFUND_STATUS)throw new Error('ADAPAY_OPERATION_NOT_ALLOWED');
   if(row.operation&&row.operation!==kind)throw new Error('ADAPAY_OPERATION_CONFLICT');
   const account=kind==='split'?await accounts().requireReady(o.MAIL_ACCEPT_USER_ID,tx):null;
   if(account&&o.MAIL_ACCEPT_USER_ID===o.MAIL_USER_ID)throw new Error('ADAPAY_SELF_SPLIT');
   const opNo=store.key('adapay',kind,id);
   await store.set(tx,'payment',opNo,{_pid:'crun',provider:'adapay',kind:'adapay_pointer',paymentNo:id,...(scope?{schoolId:scope.schoolId,campusId:scope.campusId}:{})});
   const next={...row,operation:kind,operationNo:opNo,operationLease:Date.now()+30000,
    ...(account?{rider:o.MAIL_ACCEPT_USER_ID,memberId:account.memberId,riderAmount:Math.floor(row.amount*9/10)}:{})};
   if(account&&next.riderAmount<1)throw new Error('ADAPAY_SPLIT_TOO_SMALL');
   await store.set(tx,'payment',id,next);return next;
  });
  if(!p)return;
  try {
   const list=await api.request('GET','/v1/payments/'+name+'/list',{order_no:p.operationNo,payment_id:p.providerId,page_size:2});
   const field=kind==='refund'?'payment_reverses':'payment_confirms';
   if(list.status!=='succeeded'||!Array.isArray(list[field])&&list[field]!==undefined)throw new Error('ADAPAY_OPERATION_QUERY_FAILED');
   let items=(list[field]||[]).filter(x=>x.order_no===p.operationNo);
   if(items.length>1||list.has_more)throw new Error('ADAPAY_DUPLICATE_OPERATION');
   // A successful creation may precede list indexing. Once an object ID has
   // been saved, query it instead of submitting the same financial operation again.
   if (items[0] && p.operationId && items[0].id !== p.operationId) throw new Error('ADAPAY_OPERATION_MISMATCH');
   let result=items[0] || (p.operationId ? {id:p.operationId} : null);
   let queriedId = '';
   if(result) {
    queriedId = result.id;
    if (typeof queriedId !== 'string' || !/^[A-Za-z0-9_]{1,64}$/.test(queriedId)) throw new Error('ADAPAY_OPERATION_MISMATCH');
    result=await api.request('GET','/v1/payments/'+name+'/'+queriedId,{[kind==='refund'?'reverse_id':'payment_confirm_id']:queriedId});
   }
   else {
    result=await api.request('POST','/v1/payments/'+name,{payment_id:p.providerId,order_no:p.operationNo,notify_url:cfg.notifyUrl,
     ...(kind==='refund'?{reverse_amt:api.money(p.amount),reason:'订单已取消'}:{confirm_amt:api.money(p.amount),fee_mode:'O',div_members:[
      {member_id:p.memberId,amount:api.money(p.riderAmount)},{member_id:'0',amount:api.money(p.amount-p.riderAmount)}]})});
    // Persist provider id only; synchronous acceptance is not a refund/settlement terminal result.
    await this.patch(id,{operationId:result.id || ''});
    return;
   }
   // The object ID comes from our saved signed creation response or a signed
   // list scoped to payment_id + our deterministic operationNo.
   // Actual confirmation details omit payment_id. Bind them by the queried ID,
   // operationNo and amount; still reject a conflicting payment_id when supplied.
   if(!result || result.id!==queriedId || result.order_no!==p.operationNo ||
      result.payment_id!==undefined && result.payment_id!==p.providerId ||
      result.app_id!==undefined && result.app_id!==cfg.appid ||
      result.prod_mode!==undefined && String(result.prod_mode)!==String(cfg.prod) ||
      api.cents(result[kind==='refund'?'reverse_amt':'confirm_amt'])!==p.amount)throw new Error('ADAPAY_OPERATION_MISMATCH');
   if(kind==='split') {
    const d=result.div_members;
    if(!Array.isArray(d)||d.length!==2||!d.some(x=>x.member_id===p.memberId&&api.cents(x.amount)===p.riderAmount)||
       !d.some(x=>x.member_id==='0'&&api.cents(x.amount)===p.amount-p.riderAmount))throw new Error('ADAPAY_SPLIT_MISMATCH');
   }
   if(result.status==='succeeded') {
    await store.transaction(async tx=>{
     const row=await store.get(tx,'payment',id),o=await store.get(tx,'mail',p.orderId);
     if(row?.state!=='paid'||row.operationNo!==p.operationNo||!o||o.MAIL_STATUS!==(kind==='refund'?99:9))throw new Error('ADAPAY_OPERATION_STATE_CHANGED');
     await store.set(tx,'mail',p.orderId,{...o,...(kind==='refund'?{MAIL_PAY_STATUS:2,MAIL_REFUND_STATUS:'success'}:{MAIL_EARNINGS_STATUS:'settled'})});
     await store.set(tx,'payment',id,{...row,state:kind==='refund'?'refunded':'complete',operationId:result.id,nextCheckAt:0});
    });
   } else if(result.status==='failed') {
    await this.patch(id,{state:'needs_review',nextCheckAt:0});
   }
  } finally {await this.patch(id,{operationLease:0});}
 }
 async callback(event) {
  try {
   if(!cfg.ready())return {statusCode:503,body:''};
   const data=api.notification(event);
   if(!/^[a-f0-9]{32}$/.test(data.order_no||''))return {statusCode:400,body:''};
   await tenant.system(async()=>{
    let row=await store.get(store.database(),'payment',data.order_no),id=data.order_no;
    if(row?.kind==='adapay_pointer'){id=row.paymentNo;row=await store.get(store.database(),'payment',id);}
    if(!row||row.provider!=='adapay')throw new Error('ADAPAY_PAYMENT_NOT_FOUND');
    await tenant.run({schoolId:row.schoolId,campusId:row.campusId},()=>this.patch(id,{nextCheckAt:Date.now()}));
   });
   return {statusCode:200,body:'success'};
  }catch(_){return {statusCode:400,body:''};}
 }
}
module.exports = AdapayPaymentService;
