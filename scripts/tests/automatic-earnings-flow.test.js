'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('../test-support/operations-fixture.cjs');

async function deliveredOrder(f){
 const id=await f.publish();
 await f.service.acceptMail('rider',id,{requestId:f.req('accept')});
 await f.service.pickupMail('rider',id,{requestId:f.req('pickup'),images:['cloud://bucket/private-evidence/rider/pickup.png']});
 await f.service.deliverMail('rider',id,{requestId:f.req('deliver'),mode:'face'});
 Object.assign(f.table('mail').get(id),{MAIL_PAYMENT_MODE:'wechat',MAIL_PAY_STATUS:1,MAIL_PAY_NO:'payment-one'});
 return id;
}

test('poster confirmation dispatches settlement only after receipt is committed',async()=>{
 const f=fixture(),id=await deliveredOrder(f),calls=[];
 const Payment=f.load('payment_service.js');
 Payment.prototype.reconcile=async payNo=>{
  calls.push(payNo);
  assert.equal(f.table('mail').get(id).MAIL_STATUS,9);
  assert.equal(f.table('user').get('poster').USER_POINTS,100);
 };
 await f.service.finishMail('poster',id,{requestId:f.req('finish')});
 assert.deepEqual(calls,['payment-one']);
 await assert.rejects(f.service.finishMail('rider',id,{requestId:f.req('rider-finish')}),/仅发布者/);
 assert.equal(calls.length,1);
});

test('automatic receipt after eight hours dispatches the same settlement flow',async()=>{
 const f=fixture(),id=await deliveredOrder(f),calls=[];
 f.table('mail').get(id).MAIL_DELIVERED_TIME=Date.now()-8*3600000-1000;
 f.load('payment_service.js').prototype.reconcile=async payNo=>{
  calls.push(payNo);assert.equal(f.table('mail').get(id).MAIL_STATUS,9);
 };
 await new (f.load('maintenance_service.js'))()._sweep(id,'auto_confirm');
 assert.deepEqual(calls,['payment-one']);
 assert.equal(f.table('mail').get(id).MAIL_AUTO_CONFIRMED,true);
});

test('a transfer failure leaves receipt committed and earnings pending for reconciliation',async()=>{
 const f=fixture(),id=await deliveredOrder(f);
 f.table('mail').get(id).MAIL_EARNINGS_STATUS='pending';
 f.load('payment_service.js').prototype.reconcile=async()=>{throw Object.assign(Error('transfer timeout'),{code:'TEST_TRANSFER_TIMEOUT'});};
 const result=await f.service.finishMail('poster',id,{requestId:f.req('finish')});
 assert.equal(result.id,id);
 assert.equal(f.table('mail').get(id).MAIL_STATUS,9);
 assert.equal(f.table('mail').get(id).MAIL_EARNINGS_STATUS,'pending');
});
