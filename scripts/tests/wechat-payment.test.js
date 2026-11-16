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
   '../../../framework/core/app_error.js':Error,
   '../../../framework/cloud/cloud_base.js':{getCloud:()=>({getWXContext:()=>({APPID:appid,OPENID:'poster'})})}
  };
  const file = path.join(__dirname,'../../cloudfunctions/mcloud/project/crun/service',name+'.js');
  vm.runInNewContext(fs.readFileSync(file,'utf8'),{module, console, require:key=>dependencies[key]}, {filename:file});
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
 return { rows,calls,api,payment,earnings,load };
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

test('only the rider can claim a paid, completed order and the amount comes from the order',async()=>{
 const h=harness();const service=h.earnings();
 await assert.rejects(service.claim('poster','order',true),/不可领取/);
 h.rows.mail.order.MAIL_STATUS=3;
 await assert.rejects(service.claim('rider','order',true),/不可领取/);
 h.rows.mail.order.MAIL_STATUS=9;
 assert.equal((await service.claim('rider','order',false)).amount,540);
 assert.equal(Object.keys(h.rows.payment).length,1);
});

test('transfer retries reuse the same bill after an unknown result and paid status blocks another transfer',async()=>{
 const h=harness();const service=h.earnings();
 let firstBill, attempts=0, status='WAIT_USER_CONFIRM';
 h.api.request=async(method,url,body)=>{
  if (method==='GET') return {out_bill_no:firstBill,appid,mch_id:mchid,openid:'rider',transfer_amount:540,state:status};
  assert.equal(body.transfer_scene_id,'1005');assert.equal(body.transfer_amount,540);assert.equal(body.openid,'rider');
  if (++attempts===1) {firstBill=body.out_bill_no;throw Error('network timeout');}
  assert.equal(body.out_bill_no,firstBill);
  return {out_bill_no:firstBill,state:'WAIT_USER_CONFIRM',package_info:'confirm-pkg'};
 };
 await assert.rejects(service.claim('rider','order',true),/network timeout/);
 assert.equal((await service.claim('rider','order',true)).confirm.package,'confirm-pkg');
 status='SUCCESS';
 assert.equal((await service.claim('rider','order',false)).status,'SUCCESS');
 assert.equal((await service.claim('rider','order',true)).status,'SUCCESS');
 assert.equal(h.rows.mail.order.MAIL_EARNINGS_STATUS,'paid');
 assert.equal(attempts,2);
});
