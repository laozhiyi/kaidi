'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('../test-support/operations-fixture.cjs');
const Versions=require('../../cloudfunctions/mcloud/project/crun/public/agreement_versions.js');
const Agreements=require('../../miniprogram/projects/crun/public/agreements.js');
const UI=require('../../miniprogram/projects/crun/biz/mail_ui_biz.js');
const consent=()=>({accepted:true,userVersion:Versions.VERSION,privacyVersion:Versions.VERSION});
function profile(f) {
 return {name:'同学',mobile:'13912345678',pic:'cloud://test/avatar.png',forms:[
  {mark:'sex',val:'男'},{mark:'college',val:'计算机学院'},{mark:'sub',val:'软件工程'},
  {mark:'campus',val:'育才校区'},{mark:'studentId',val:'20240001'},
  {mark:'studentCard',val:['cloud://test/student-card.png']},{mark:'disclaimer',val:true}
 ]};
}
test('legacy disclaimer and stale versions cannot author consent for a profile save',async()=>{
 const f=fixture(),svc=new(f.load('passport_service.js'))();
 delete f.table('user').get('poster').USER_AGREEMENTS;
 const input=profile(f);
 await assert.rejects(svc.editBase('poster',input),/当前版本/);
 await assert.rejects(svc.editBase('poster',{...input,agreements:{...consent(),userVersion:'2026-11-26'}}),/当前版本/);
 assert.equal(f.table('user').get('poster').USER_AGREEMENTS,undefined);
});
test('profile consent uses the server time, preserves versions and does not overwrite acceptance on ordinary edits',async()=>{
 const f=fixture(),svc=new(f.load('passport_service.js'))(),before=Date.now();
 delete f.table('user').get('poster').USER_AGREEMENTS;
 await svc.editBase('poster',{...profile(f),agreements:{...consent(),acceptedAt:1}});
 const first=structuredClone(f.table('user').get('poster').USER_AGREEMENTS);
 assert.equal(first.userVersion,Versions.VERSION);assert(first.acceptedAt>=before);
 await svc.editBase('poster',{...profile(f),name:'更新昵称'});
 assert.deepEqual(f.table('user').get('poster').USER_AGREEMENTS,first);
 assert.equal(f.table('user').get('poster').USER_AGREEMENT_HISTORY.length,1);
});
test('saved consent never overrides an explicit refusal or invalid versions on a later profile save',async()=>{
 const f=fixture(),svc=new(f.load('passport_service.js'))();
 const before=structuredClone(f.table('user').get('poster'));
 for(const agreements of [{...consent(),accepted:false},{...consent(),userVersion:'2026-11-26'},{...consent(),privacyVersion:'2026-11-26'},null,{}]) {
  await assert.rejects(svc.editBase('poster',{...profile(f),name:'不应保存的新昵称',agreements}),/当前版本/);
  assert.deepEqual(f.table('user').get('poster'),before);
 }
});

test('profile reads project the saved consent back to the client after saving and ordinary edits',async()=>{
 const f=fixture({projectFields:true}),svc=new(f.load('passport_service.js'))();
 delete f.table('user').get('poster').USER_AGREEMENTS;
 const legacy=await svc.getMyDetail('poster');
 assert.equal(Agreements.currentUser(legacy.USER_AGREEMENTS),false);
 const saved=await svc.editBase('poster',{...profile(f),agreements:consent()});
 const stored=structuredClone(f.table('user').get('poster').USER_AGREEMENTS);
 assert.equal(Agreements.currentUser(saved.token.agreements),true);
 const reopened=await svc.getMyDetail('poster');
 assert.deepEqual(reopened.USER_AGREEMENTS,stored);
 assert.equal(Agreements.currentUser(reopened.USER_AGREEMENTS),true);
 assert.equal(reopened.USER_AGREEMENT_HISTORY,undefined);
 await svc.editBase('poster',{...profile(f),name:'改名后重新进入'});
 assert.deepEqual((await svc.getMyDetail('poster')).USER_AGREEMENTS,stored);
 const before=structuredClone(f.table('user').get('poster'));
 await assert.rejects(svc.editBase('poster',{...profile(f),agreements:{...consent(),accepted:false}}),/当前版本/);
 assert.deepEqual(f.table('user').get('poster'),before);
});
test('already-opened riders can accept new versions without submitting identity data or calling the provider',async()=>{
 const f=fixture(),account=new(f.load('adapay_account_service.js'))();
 const old={status:'ready',accountId:'account-existing',memberId:'runner-existing',userId:'rider',consentVersion:'2026-11-26',consentedAt:1,cardTail:'1234'};
 account.stored=async()=>structuredClone(old);
 await assert.rejects(account.acceptAgreements('rider',{rulesAccepted:true,authorizationAccepted:true,rulesVersion:'2026-11-26',authorizationVersion:Versions.VERSION}),/当前版本/);
 assert.equal(f.table('payment').size,0);
 const result=await account.acceptAgreements('rider',{rulesAccepted:true,authorizationAccepted:true,rulesVersion:Versions.VERSION,authorizationVersion:Versions.VERSION});
 assert.equal(result.opened,true);assert.equal(result.consentCurrent,true);assert.equal(result.cardTail,'1234');assert.equal(result.boundAt,1,'new terms do not change the existing card binding time');
 const saved=[...f.table('payment').values()][0];
 assert.equal(saved.accountId,old.accountId);assert.equal(saved.consentHistory[0].consentVersion,'2026-11-26');
 assert.equal(saved.identity,undefined);assert.equal(saved.bankCard,undefined);
});
for(const actor of ['poster','rider']) test(actor+' can cancel before pickup, close the paid order and queue a full refund once',async()=>{
 const f=fixture(),id=await f.publish();await f.service.acceptMail('rider',id,{requestId:f.req('accept')});
 const row=f.table('mail').get(id);Object.assign(row,{MAIL_PAYMENT_MODE:'adapay',MAIL_PAY_STATUS:1,MAIL_PAY_NO:'payment-test'});
 const amount=row.MAIL_TOTAL_FEE,input={requestId:f.req('cancel')};
 await f.service.cancelMail(actor,id,input);
 const done=f.table('mail').get(id);
 assert.equal(done.MAIL_STATUS,99);assert.equal(done.MAIL_REFUND_STATUS,'pending');assert.equal(done.MAIL_TOTAL_FEE,amount);
 const events=f.table('order_event').size;await f.service.cancelMail(actor,id,input);
 assert.equal(f.table('order_event').size,events);
 assert.equal(f.table('mail').get(id).MAIL_STATUS,99);
});
test('pickup and cancellation race to a single terminal decision; users cannot cancel after pickup',async()=>{
 for(const first of ['pickup','cancel']) {
  const f=fixture(),id=await f.publish();await f.service.acceptMail('rider',id,{requestId:f.req('accept')});
  const actions={pickup:()=>f.service.pickupMail('rider',id,{requestId:f.req('pickup'),images:['cloud://test/proof']}),cancel:()=>f.service.cancelMail('poster',id,{requestId:f.req('cancel')})};
  const results=await Promise.allSettled([actions[first](),actions[first==='pickup'?'cancel':'pickup']()]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  const row=f.table('mail').get(id);assert([4,99].includes(row.MAIL_STATUS));
  if(row.MAIL_STATUS===4) for(const actor of ['poster','rider']) await assert.rejects(f.service.cancelMail(actor,id,{requestId:f.req('late-'+actor)}),/取件前|取件后/);
 }
});
test('new work requires current user consent while existing delivery and cancellation remain available',async()=>{
 const f=fixture(),first=await f.publish();await f.service.acceptMail('rider',first,{requestId:f.req('accept-first')});
 const second=(await f.service.insertMail('poster',{forms:f.forms(),requestId:f.req('publish-second')}))._id;
 delete f.table('user').get('rider').USER_AGREEMENTS;
 await assert.rejects(f.service.acceptMail('rider',second,{requestId:f.req('accept-second')}),/新版用户服务协议/);
 delete f.table('user').get('poster').USER_AGREEMENTS;
 await assert.rejects(f.service.insertMail('poster',{forms:f.forms(),requestId:f.req('publish-third')}),/新版用户服务协议/);
 await f.service.pickupMail('rider',first,{requestId:f.req('existing-pickup'),images:['cloud://test/proof']});
 assert.equal(f.table('mail').get(first).MAIL_STATUS,4);
 await f.service.cancelMail('poster',second,{requestId:f.req('existing-cancel')});
 assert.equal(f.table('mail').get(second).MAIL_STATUS,99);
});
test('both parties can cancel a user-reported pre-pickup exception but cannot override an admin hold',async()=>{
 for(const actor of ['poster','rider']){
  const f=fixture(),id=await f.publish();await f.service.acceptMail('rider',id,{requestId:f.req('accept')});
  await f.service.exceptionMail('rider',id,{requestId:f.req('exception'),reason:'取件失败',note:'无法核对取件信息'});
  assert.equal(UI.detail({...f.table('mail').get(id),mypost:actor==='poster',myaccept:actor==='rider'}).canCancel,true);
  await f.service.cancelMail(actor,id,{requestId:f.req('cancel')});assert.equal(f.table('mail').get(id).MAIL_STATUS,99);
 }
 const f=fixture(),id=await f.publish();await f.service.acceptMail('rider',id,{requestId:f.req('accept')});
 await f.service.holdMail('admin',id,{requestId:f.req('hold'),note:'核实投诉'});
 await assert.rejects(f.service.cancelMail('poster',id,{requestId:f.req('cancel-held')}),/管理员介入/);
});
test('a complaint alone preserves the waiting receipt state; an admin hold suspends automatic receipt',async()=>{
 const f=fixture(),id=await f.publish();await f.service.acceptMail('rider',id,{requestId:f.req('accept')});
 const row=f.table('mail').get(id);Object.assign(row,{MAIL_STATUS:2,MAIL_DELIVERED_TIME:Date.now()-9*3600000});
 await new(f.load('feedback_service.js'))().insertFeedback('poster',{type:'complain',title:'包裹问题',content:'需要核实交付情况',orderId:id,requestId:f.req('feedback')});
 assert.equal(f.table('mail').get(id).MAIL_STATUS,2);
 await f.service.holdMail('admin',id,{requestId:f.req('hold'),note:'核实关联投诉'});
 await new(f.load('maintenance_service.js'))()._sweep(id,'auto_confirm');
 assert.equal(f.table('mail').get(id).MAIL_STATUS,3);
});
test('the client does not offer cancellation to a third party or after pickup',()=>{
 const row={MAIL_STATUS:1,MAIL_END_TIME:Date.now()+60000,MAIL_OBJ:{},myaccept:true};
 assert.equal(UI.detail(row).canCancel,true);
 assert.equal(UI.detail({...row,MAIL_PICKUP_TIME:1}).canCancel,false);
 assert.equal(UI.detail({...row,myaccept:false}).canCancel,false);
});
test('all agreement versions match the server and material financial and complaint clauses remain highlighted',()=>{
 for(const key of Agreements.keys) assert.equal(Agreements.get(key).version,Versions.VERSION);
 for(const key of ['user','rider']) {
  const bold=Agreements.get(key).blocks.flatMap(x=>x.segments || []).filter(x=>x.b).map(x=>x.t).join('\n');
  assert.match(bold,/8小时/);assert.match(bold,/90%/);assert.match(bold,/D\+1/);assert.match(bold,/投诉/);assert.match(bold,/违约金/);
 }
});
