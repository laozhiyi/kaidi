'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {fixture} = require('../test-support/operations-fixture.cjs');
const {concurrentTransactions} = require('../test-support/concurrent-transactions.cjs');
const {client, tick} = require('../test-support/reliability-client.cjs');

test('recovery returns a committed publication and refuses other actions or identities', async () => {
 const f=fixture(), id=await f.publish(), recovery=new (f.load('request_recovery_service.js'))();
 const result=await recovery.recover('poster',{route:'mail/insert',requestId:f.req('publish')});
 assert.equal(result.state,'committed'); assert.equal(result.result._id,id);
 const other=await recovery.recover('other',{route:'mail/insert',requestId:f.req('publish')});
 assert.equal(other.state,'cancelled'); assert.equal(f.table('mail').size,1);
 await assert.rejects(recovery.recover('poster',{route:'mail/cancel',id,requestId:f.req('publish')}),/不匹配/);
 await assert.rejects(recovery.recover('poster',{route:'admin/operations_hold',id,requestId:f.req('hold')}),/不支持/);
 await assert.rejects(recovery.recover('poster',{route:'__proto__',requestId:f.req('invalid')}),/不支持/);
});

test('closing an unknown publication races safely with its in-flight transaction', async () => {
 for(let run=0;run<16;run++) {
  const f=fixture(); concurrentTransactions(f);
  const recovery=new (f.load('request_recovery_service.js'))();
  const work=()=>f.publish();
  const resolve=()=>recovery.recover('poster',{route:'mail/insert',requestId:f.req('publish')});
  const tasks=run%2 ? [resolve(),work()] : [work(),resolve()];
  const results=await Promise.allSettled(tasks);
  const resolved=results[run%2?0:1], written=results[run%2?1:0];
  assert.equal(resolved.status,'fulfilled');
  if(resolved.value.state==='committed') {
   assert.equal(written.status,'fulfilled'); assert.equal(f.table('mail').size,1);
   assert.equal(resolved.value.result._id,written.value);
  } else {
   assert.equal(written.status,'rejected'); assert.equal(f.table('mail').size,0);
   await assert.rejects(work(),/已停止/);
   assert.equal(f.table('order_event').size,0); assert.equal(f.table('order_feed').size,0);
  }
 }
});

test('request closure also prevents late order changes, feedback, reviews and administrator replies', async () => {
 const f=fixture(), id=await f.publish(), recovery=new (f.load('request_recovery_service.js'))();
 const close=(userId,route,requestId,adminId='')=>recovery.recover(userId,{route,id,requestId},adminId);
 await close('rider','mail/accept',f.req('take'));
 await assert.rejects(f.service.acceptMail('rider',id,{requestId:f.req('take')}),/已停止/);
 assert.equal(f.table('mail').get(id).MAIL_STATUS,0);
 const Feedback=f.load('feedback_service.js'), feedback=new Feedback();
 await close('poster','feedback/insert',f.req('feedback'));
 await assert.rejects(feedback.insertFeedback('poster',{requestId:f.req('feedback'),title:'核对订单',content:'请帮助核对',type:'suggest',img:[]}),/已停止/);
 const saved=await feedback.insertFeedback('poster',{requestId:f.req('new-feedback'),title:'核对订单',content:'请帮助核对',type:'suggest',img:[]});
 await recovery.recover('',{route:'admin/feedback_reply',id:saved.id,requestId:f.req('reply')},'admin');
 await assert.rejects(feedback.replyFeedback(saved.id,'已处理','admin',0,f.req('reply')),/已停止/);
 const mail=f.table('mail').get(id); mail.MAIL_STATUS=9;mail.MAIL_ACCEPT_USER_ID='rider';
 await close('poster','review/insert',f.req('review'));
 await assert.rejects(new (f.load('review_service.js'))().insert('poster',{orderId:id,requestId:f.req('review'),score:5,content:'谢谢'}),/已停止/);
 assert.equal(f.table('order_review').size,0);
});

test('committed image publications replay through the real controller before audit and deadline checks', async () => {
 const f=fixture(), dataCheck=require('../../cloudfunctions/mcloud/framework/validate/data_check.js');
 let audits=0,images=0;
 class Base {
  constructor(params){this.params=params;this._userId='poster';}
  validateData(schema){return dataCheck.check(structuredClone(this.params),schema);}
  AppError(message){throw new Error(message);}
 }
 const checks={async checkTextMultiClient(){audits++;},async checkCloudImage(id){images++;return id.replace('/private/','/private-evidence/');}};
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../../cloudfunctions/mcloud/project/crun/controller/mail_controller.js'),'utf8'),{module,require(name){
  if(name.endsWith('base_project_controller.js'))return Base;
  if(name.endsWith('mail_service.js'))return f.load('mail_service.js');
  if(name.endsWith('operation_store.js'))return f.store;
  if(name.endsWith('order_rules.js'))return f.load('order_rules.js');
  if(name.endsWith('content_check.js'))return checks;
  if(name.endsWith('time_util.js'))return {timestamp2Time:String};
  throw Error('Unexpected dependency '+name);
 }});
 const input={requestId:f.req('controller'),cateId:'1',forms:[...f.forms(),{mark:'packages',val:[{type:'small',price:1.5,code:'',images:['cloud://bucket/private/poster/parcel.png']}]}]};
 const controller=new module.exports(input), first=await controller.insertMail();
 assert.equal(images,1);assert.equal(audits,1);
 assert.match(f.table('mail').get(first._id).MAIL_OBJ.packages[0].images[0],/private-evidence/);
 f.table('mail').get(first._id).MAIL_END_TIME=1;
 controller._limitAudit=async()=>{throw Error('audit limit reached');};
 const replayed=await Promise.all(Array.from({length:100},()=>controller.insertMail()));
 assert.ok(replayed.every(row=>row._id===first._id));assert.equal(images,1);assert.equal(audits,1);
 controller.params={...input,forms:f.forms()};
 await assert.rejects(controller.insertMail(),/不同内容/);
});

test('command signatures and requests keep the original payload when a caller mutates its form', async () => {
 const f=client(), params={id:'order',note:'原说明'}, submit=f.ops().command('mail/cancel',params,{retries:0});
 params.note='后来的修改';await tick();
 assert.equal(f.calls[0].data.params.note,'原说明');
 f.respond(0,{id:'order'});await submit;
});

test('a restarted client reconciles only request identifiers and can safely submit changed content afterward', async () => {
 for(const state of ['committed','cancelled']) {
  const first=client(), failed=assert.rejects(first.ops().command('mail/insert',{forms:[{val:'13800138000'}]},{retries:0}));
  await tick();first.fail(0);await failed;
  const id=first.calls[0].data.params.requestId;
  assert.ok(!JSON.stringify([...first.storage]).includes('13800138000'));
  const next=client();for(const [key,value] of first.storage)next.storage.set(key,structuredClone(value));
  const recovery=next.ops().recoverCommand('mail/insert');await tick();
  assert.equal(next.calls[0].data.route,'operations/recover');assert.equal(next.calls[0].data.params.requestId,id);
  next.respond(0,{state,result:{_id:'saved-order'}});assert.equal((await recovery).state,state);assert.equal(next.storage.size,0);
  assert.equal(next.calls.length,1);
  const changed=next.ops().command('mail/insert',{forms:[]});await tick();
  assert.notEqual(next.calls[1].data.params.requestId,id);next.respond(1,{_id:'next-order'});await changed;
 }
});

test('a business rejection after a lost reply cannot erase the still-unknown original request', async () => {
 const f=client(), ops=f.ops(), params={id:'order'}, lost=assert.rejects(ops.command('mail/pickup',params,{retries:0}));
 await tick();f.fail(0);await lost;
 const retry=assert.rejects(ops.command('mail/pickup',params),error=>typeof error.recover==='function');
 await tick();f.respond(1,{},1600);await retry;
 assert.equal(f.storage.size,1);
 const recover=ops.recoverCommand('mail/pickup',params);await tick();
 f.respond(2,{state:'committed',result:{id:'order'}});await recover;assert.equal(f.storage.size,0);
});
