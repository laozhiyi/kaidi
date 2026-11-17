'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const crypto = require('node:crypto');

const appid = 'wx0123456789abcdef';
const mchid = '1234567890';
const id = 'a'.repeat(32);
const paid = {
 trade_state:'SUCCESS', out_trade_no:id, mchid, appid, amount:{total:600,currency:'CNY'},
 payer:{openid:'poster'}, transaction_id:'wx123'
};

function harness(state = -1) {
 const rows = { mail:{order:{
  _id:'order', MAIL_USER_ID:'poster', MAIL_ACCEPT_USER_ID:'rider', MAIL_PAYMENT_MODE:'wechat',
  MAIL_PAY_NO:id, MAIL_TOTAL_FEE:600, MAIL_PAY_STATUS:0, MAIL_STATUS:state, MAIL_END_TIME:Date.now()+60000
 }}, payment:{} };
 const calls = [];
 let authorized = true;
 const clone = value => value && structuredClone(value);
 const store = {
  key:(...parts)=>parts.join('_'), scopeKey:(...parts)=>parts.join('_'), scope:()=>null, database:()=>({}),
  get:async(_,table,key)=>clone(rows[table][key]), set:async(_,table,key,row)=>{rows[table][key]=clone(row);},
  transaction:async fn=>fn({})
 };
 class Mail {
  async _user() {}
  async _record(tx,row) { calls.push('publish');await store.set(tx,'mail','order',row); }
  async _quota() {}
 }
 const api = { sign:()=>'signed', request:async()=>{throw Error('Unexpected API request');} };
 function load(name) {
  const module = { exports:{} };
  const dependencies = {
   './operation_store.js':store, './mail_service.js':Mail, './wechat_pay_api.js':api, crypto,
   '../config/pay_config.js':{ appid,mchid,ready:()=>true,enabled:()=>true,notifyUrl:'https://example.test/pay' },
   './earnings_authorization_service.js':class {async stored(){return authorized ? {outAuthorizationNo:'authorization-one',appid,merchant:mchid,openid:'rider'} : null;}},
   '../../../framework/core/app_error.js':Error,
   '../../../framework/cloud/cloud_base.js':{getCloud:()=>({getWXContext:()=>({APPID:appid,OPENID:'poster'})})}
  };
  const file = path.join(__dirname,'../../cloudfunctions/mcloud/project/crun/service',name+'.js');
  vm.runInNewContext(fs.readFileSync(file,'utf8'),{module, console, require:key=>key==='./earnings_service.js'?load('earnings_service').constructor:dependencies[key]}, {filename:file});
  return new module.exports();
 }
 function payment() {
  rows.payment[id] = {orderId:'order',merchant:mchid,appid,openid:'poster',amount:600,state:'pending'};
  return load('payment_service');
 }
 function earnings() {
  payment();
  Object.assign(rows.payment[id],{state:'complete',transactionId:'wx123'});
  Object.assign(rows.mail.order,{MAIL_STATUS:9,MAIL_PAY_STATUS:1,MAIL_TRANSACTION_ID:'wx123',MAIL_EARNINGS_STATUS:'pending'});
  return load('earnings_service');
 }
 return { rows,calls,api,payment,earnings,load,setAuthorized:value=>{authorized=value;} };
}

test('prepay charges the stored amount and signs the checkout package',async()=>{
 const h=harness();
 h.api.request=async(method,url,body)=>{
  assert.equal(method,'POST');assert.equal(url,'/v3/pay/transactions/jsapi');
  assert.equal(body.amount.total,600);assert.equal(body.payer.openid,'poster');assert.equal(body.notify_url,'https://example.test/pay');
  return {prepay_id:'prepaid'};
 };
 const result=await h.load('payment_service').prepare('poster','order');
 assert.equal(result.payment.package,'prepay_id=prepaid');
 assert.equal(result.payment.signType,'RSA');
 assert.equal(h.rows.payment[id].state,'pending');
 assert.equal(h.rows.mail.order.MAIL_STATUS,-1);
});

test('verified payment publishes once even when notified again',async()=>{
 const h=harness();const service=h.payment();
 await service.reconcile(id,paid);await service.reconcile(id,paid);
 assert.equal(h.rows.mail.order.MAIL_STATUS,0);
 assert.equal(h.rows.mail.order.MAIL_PAY_STATUS,1);
 assert.deepEqual(h.calls,['publish']);
});

test('unpaid, wrong amount, wrong app and wrong payer cannot publish',async()=>{
 for (const data of [{trade_state:'NOTPAY'},{amount:{total:1,currency:'CNY'}},{appid:'other'},{payer:{openid:'other'}}]) {
  const h=harness();const service=h.payment();
  if (data.trade_state) await service.reconcile(id,{...paid,...data});
  else await assert.rejects(service.reconcile(id,{...paid,...data}),/PAYMENT_MISMATCH/);
  assert.equal(h.rows.mail.order.MAIL_STATUS,-1);
 }
});

test('a payment received after cancellation is refunded once and never published',async()=>{
 const h=harness(99);const service=h.payment();
 h.api.request=async(method,url,body)=>{
  assert.equal(method,'POST');assert.equal(url,'/v3/refund/domestic/refunds');
  h.calls.push('refund');
  return {status:'SUCCESS',out_refund_no:body.out_refund_no,out_trade_no:id,amount:{refund:600,total:600}};
 };
 await service.reconcile(id,paid);await service.reconcile(id,paid);
 assert.equal(h.rows.mail.order.MAIL_PAY_STATUS,2);
 assert.equal(h.rows.payment[id].state,'refunded');
 assert.deepEqual(h.calls,['refund']);
});

test('automatic earnings only queue paid completed orders and use the stored amount',async()=>{
 const h=harness();const service=h.earnings();
 h.rows.mail.order.MAIL_STATUS=3;
 await assert.rejects(service.queue('order'),/不可结算/);
 h.rows.mail.order.MAIL_STATUS=9;
 const transferId=await service.queue('order');
 assert.equal(h.rows.payment[transferId].amount,540);
 assert.equal(h.rows.payment[transferId].openid,'rider');
 assert.equal(await service.queue('order'),transferId);
 // 转账记录与商户单号指针各一条，其余支付记录不变
 assert.equal(Object.keys(h.rows.payment).filter(key=>h.rows.payment[key].kind!=='transfer_pointer').length,2);
 h.rows.mail.order.MAIL_PAY_STATUS=2;
 await assert.rejects(service.queue('order'),/不可结算/);
});

test('automatic transfers query an unknown outcome and reuse the same bill only when not found',async()=>{
 const h=harness();const service=h.earnings();
 const transferId=await service.queue('order');
 let firstBill, attempts=0, found=false;
 h.api.request=async(method,url,body)=>{
  if (method==='GET') {
   if (!found) throw Object.assign(Error('not found'),{code:'NOT_FOUND'});
   return {out_bill_no:firstBill,appid,mch_id:mchid,transfer_amount:540,state:'SUCCESS'};
  }
  assert.equal(url,'/v3/fund-app/mch-transfer/transfer-bills/transfer');
  assert.equal(body.transfer_scene_id,'1005');assert.equal(body.transfer_amount,540);
  assert.equal(body.openid,'rider');assert.equal(body.out_authorization_no,undefined);
  if (++attempts===1) {firstBill=body.out_bill_no;throw Error('network timeout');}
  assert.equal(body.out_bill_no,firstBill);
  found=true;
  return {out_bill_no:firstBill,appid,mch_id:mchid,transfer_amount:540,state:'SUCCESS'};
 };
 await assert.rejects(service.reconcile(transferId),/network timeout/);
 assert.equal(h.rows.mail.order.MAIL_EARNINGS_STATUS,'pending');
 await service.reconcile(transferId);
 await service.reconcile(transferId);
 assert.equal(h.rows.mail.order.MAIL_EARNINGS_STATUS,'paid');
 assert.equal(attempts,2);
});

test('a successful transfer with a lost response is queried and never paid a second time',async()=>{
 const h=harness();const service=h.earnings(),transferId=await service.queue('order');
 let sent=0,bill;
 h.api.request=async(method,url,body)=>{
  if(method==='POST'){sent++;bill=body.out_bill_no;throw Error('lost response');}
  return {out_bill_no:bill,appid,mch_id:mchid,transfer_amount:540,state:'SUCCESS'};
 };
 await assert.rejects(service.reconcile(transferId),/lost response/);
 await service.reconcile(transferId);
 await service.reconcile(transferId);
 assert.equal(sent,1);
 assert.equal(h.rows.mail.order.MAIL_EARNINGS_STATUS,'paid');
});

test('unconfirmed authorization and mismatched transfer results cannot record earnings as paid',async()=>{
 for(const mismatch of [{mch_id:'other'},{appid:'other'},{transfer_amount:1},{openid:'other'}]){
  const h=harness(),earnings=h.earnings(),transferId=await earnings.queue('order');
  const bill=h.rows.payment[transferId].billNo;
  h.api.request=async()=>({out_bill_no:bill,appid,mch_id:mchid,transfer_amount:540,state:'SUCCESS',...mismatch});
  await assert.rejects(earnings.reconcile(transferId),/WECHAT_TRANSFER_MISMATCH/);
  assert.equal(h.rows.mail.order.MAIL_EARNINGS_STATUS,'pending');
 }
});

test('transfer response with only documented fields reaches WAIT_USER_CONFIRM and keeps the package',async()=>{
 const h=harness();const service=h.earnings(),transferId=await service.queue('order');
 const bill=h.rows.payment[transferId].billNo;
 h.api.request=async(method,url,body)=>{
  assert.equal(method,'POST');assert.equal(url,'/v3/fund-app/mch-transfer/transfer-bills/transfer');
  return {out_bill_no:body.out_bill_no,transfer_bill_no:'1330000071100999991182020050700019480001',
   create_time:'2026-11-17T22:00:00+08:00',state:'WAIT_USER_CONFIRM',package_info:'pkg-one'};
 };
 await service.reconcile(transferId);
 const record=h.rows.payment[transferId];
 assert.equal(record.billNo,bill);
 assert.equal(record.status,'WAIT_USER_CONFIRM');
 assert.equal(record.state,'transfer_pending');
 assert.equal(record.packageInfo,'pkg-one');
 assert.equal(h.rows.mail.order.MAIL_EARNINGS_STATUS,'pending');
});

test('WAIT_USER_CONFIRM without package_info is rejected instead of silently hiding the button',async()=>{
 const h=harness();const service=h.earnings(),transferId=await service.queue('order');
 h.api.request=async(method,url,body)=>({out_bill_no:body.out_bill_no,state:'WAIT_USER_CONFIRM'});
 await assert.rejects(service.reconcile(transferId),/WECHAT_TRANSFER_PACKAGE_MISSING/);
});

test('completion reconciliation automatically transfers once without a rider claim request',async()=>{
 const h=harness();h.earnings();h.rows.payment[id].state='paid';
 let transfers=0;
 h.api.request=async(method,url,body)=>{
  assert.equal(method,'POST');assert.equal(url,'/v3/fund-app/mch-transfer/transfer-bills/transfer');transfers++;
  assert.equal(body.openid,'rider');assert.equal(body.out_authorization_no,undefined);
  return {out_bill_no:body.out_bill_no,appid,mch_id:mchid,transfer_amount:540,state:'SUCCESS'};
 };
 const service=h.load('payment_service');
 await service.reconcile(id);await service.reconcile(id);
 assert.equal(h.rows.payment[id].state,'complete');
 assert.equal(h.rows.mail.order.MAIL_EARNINGS_STATUS,'paid');
 assert.equal(transfers,1);
});
