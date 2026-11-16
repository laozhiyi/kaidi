'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
function harness(response, state=-1) {
 const rows={mail:{order:{_id:'order',MAIL_USER_ID:'poster',MAIL_PAYMENT_MODE:'wechat',MAIL_PAY_NO:'a'.repeat(32),MAIL_TOTAL_FEE:600,MAIL_PAY_STATUS:0,MAIL_STATUS:state,MAIL_END_TIME:Date.now()+60000}},payment:{['a'.repeat(32)]:{orderId:'order',merchant:'1003137035',amount:600,state:'pending'}}};
 const calls=[];
 const store={key:(...x)=>x.join('_'),database:()=>({}),get:async(_,c,id)=>rows[c] && rows[c][id] ? structuredClone(rows[c][id]):null,set:async(_,c,id,r)=>{rows[c][id]=structuredClone(r);},transaction:async fn=>fn({})};
 class Mail {async _record(tx,row){calls.push('publish');await store.set(tx,'mail','order',row);}async _quota(){}}
 const cloud={cloudPay:{queryOrder:async()=>response,refund:async()=>{calls.push('refund');return {returnCode:'SUCCESS',resultCode:'SUCCESS'};},queryRefund:async()=>({return_code:'SUCCESS',result_code:'SUCCESS',refund_status_0:'SUCCESS'})}};
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../../cloudfunctions/mcloud/project/crun/service/payment_service.js'),'utf8'),{module,exports:module.exports,process:{env:{}},console,require:id=>{
  if(id==='./operation_store.js')return store;
  if(id.includes('cloud_base'))return {getCloud:()=>cloud};
  if(id.includes('tenant_context'))return {system:fn=>fn(),run:(_,fn)=>fn()};
  if(id.includes('app_error'))return Error;
  if(id==='./mail_service.js')return Mail;
  if(id.includes('config.js'))return {CLOUD_ID:'env'};
  return require(id);
 }});
 return {service:new module.exports(),rows,calls,id:'a'.repeat(32)};
}
const paid={returnCode:'SUCCESS',resultCode:'SUCCESS',tradeState:'SUCCESS',outTradeNo:'a'.repeat(32),subMchId:'1003137035',totalFee:600,transactionId:'wx123'};
test('only a verified upstream payment publishes; duplicate reconciliation does not republish',async()=>{
 const h=harness(paid);await h.service.reconcile(h.id);await h.service.reconcile(h.id);
 assert.equal(h.rows.mail.order.MAIL_STATUS,0);assert.equal(h.rows.mail.order.MAIL_PAY_STATUS,1);assert.deepEqual(h.calls,['publish']);
});
test('unpaid orders remain private pending orders',async()=>{
 const h=harness({...paid,tradeState:'NOTPAY'});await h.service.reconcile(h.id);
 assert.equal(h.rows.mail.order.MAIL_STATUS,-1);assert.deepEqual(h.calls,[]);
});
test('wrong amount, merchant or trade reference cannot publish',async()=>{
 for(const invalid of [{totalFee:1},{subMchId:'other'},{outTradeNo:'other'}]){
  const h=harness({...paid,...invalid});await assert.rejects(()=>h.service.reconcile(h.id),/PAYMENT_MISMATCH/);assert.equal(h.rows.mail.order.MAIL_STATUS,-1);
 }
});
test('payment arriving after cancellation is refunded and never published',async()=>{
 const h=harness(paid,99);await h.service.reconcile(h.id);
 assert.equal(h.rows.mail.order.MAIL_STATUS,99);assert.equal(h.rows.mail.order.MAIL_PAY_STATUS,2);assert.equal(h.rows.payment[h.id].state,'refunded');assert.deepEqual(h.calls,['refund']);
 await h.service.reconcile(h.id);assert.deepEqual(h.calls,['refund']);
});
