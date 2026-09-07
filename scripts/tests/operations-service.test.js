const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('../test-support/operations-fixture.cjs');
const password=require('../../cloudfunctions/mcloud/framework/utils/password_util.js');

test('server recomputes cents and rejects malformed forms, disabled service and bad deadlines',async()=>{
 const f=fixture(),rules=f.load('order_rules.js');const forms=f.forms();forms.push({mark:'price',val:0.01});
 assert.equal(rules.validateForms(forms,f.config,Date.now()).totalFee,150);
 for(const transform of [a=>a.push({mark:'tel',val:'123'}),a=>a.find(x=>x.mark==='small').val=-1,a=>a.find(x=>x.mark==='small').val=1.5,a=>a.find(x=>x.mark==='campus').val='外校',a=>a.find(x=>x.mark==='urgent').val=true,a=>a.find(x=>x.mark==='img').val=['https://untrusted'],a=>a.push({mark:'formEnd',val:'2020-01-01 12:00'})]){
  const input=f.forms();transform(input);assert.throws(()=>rules.validateForms(input,f.config,Date.now()));
 }
 f.config.enabled=false;await assert.rejects(f.publish(),/暂停/);assert.equal(f.table('mail').size,0);
});

test('public DTO never contains forms, pickup codes, contact details or file identifiers',async()=>{
 const f=fixture(),id=await f.publish();const row=f.table('mail').get(id);row.MAIL_OBJ.imgUrls=['cloud://env/private/poster/secret.jpg'];
 const outsider=await f.service.viewMail('other',id);const json=JSON.stringify(outsider);
 for(const sensitive of ['MAIL_FORMS','123-456','13800000000','宿舍101','secret.jpg','MAIL_USER_ID'])assert.ok(!json.includes(sensitive),sensitive);
 const own=await f.service.viewMail('poster',id);assert.equal(own.mypost,true);assert.ok(own.MAIL_MEDIA.pickup[0].startsWith('https://signed.invalid'));
 await assert.rejects(f.service.getMailDetail('other',id),/无权限/);
});

test('publish retry is idempotent even after closure, and changed payload cannot reuse the key',async()=>{
 const f=fixture(),id=await f.publish();f.config.enabled=false;assert.equal(await f.publish(),id);assert.equal(f.table('mail').size,1);assert.equal(f.table('order_event').size,1);
 const changed=f.forms();changed.find(x=>x.mark==='small').val=2;await assert.rejects(f.publish({forms:changed}),/不同内容/);
});

test('two racing riders yield one accept, one quota reservation and no partial loser writes',async()=>{
 const f=fixture(),id=await f.publish();const results=await Promise.allSettled(['rider','rider2'].map(u=>f.service.acceptMail(u,id,{requestId:f.req(u)})));
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(f.table('mail').get(id).MAIL_STATUS,1);assert.equal(f.table('order_event').size,2);
 assert.equal([...f.table('order_quota').values()].filter(x=>x.role==='rider').length,1);
});

test('rider approval, active status, campus, self-accept and deadline are server enforced',async()=>{
 for(const change of [{USER_RIDER_STATUS:0},{USER_STATUS:9},{USER_RIDER_CAMPUS:'雁山校区'}]){
  const f=fixture(),id=await f.publish();f.user('rider',change);await assert.rejects(f.service.acceptMail('rider',id,{requestId:f.req()}));assert.equal(f.table('mail').get(id).MAIL_STATUS,0);
 }
 const f=fixture(),id=await f.publish();await assert.rejects(f.service.acceptMail('poster',id,{requestId:f.req()}),/不可接取/);
 f.table('mail').get(id).MAIL_END_TIME=1;await assert.rejects(f.service.acceptMail('rider',id,{requestId:f.req()}),/不可接取/);
});

test('accept versus cancel serializes and accept versus edit never mutates an accepted order',async()=>{
 const f=fixture(),id=await f.publish();const result=await Promise.allSettled([f.service.acceptMail('rider',id,{requestId:f.req('accept')}),f.service.cancelMail('poster',id,{requestId:f.req('cancel')})]);assert.equal(result.filter(x=>x.status==='fulfilled').length,1);
 if(f.table('mail').get(id).MAIL_STATUS===1)await assert.rejects(f.service.editMail('poster',{id,forms:f.forms(),requestId:f.req('edit')}),/尚未被接取/);
});

test('only rider can submit required proof; only poster can confirm; quotas released once',async()=>{
 const f=fixture(),id=await f.publish();await f.service.acceptMail('rider',id,{requestId:f.req('accept')});
 await assert.rejects(f.service.finishMail('poster',id,{requestId:f.req('early')}),/已送达/);
 await assert.rejects(f.service.deliverMail('poster',id,{note:'送达',images:['cloud://proof'],requestId:f.req('wrong')}),/接单人/);
 await assert.rejects(f.service.deliverMail('rider',id,{note:'送达',images:[],requestId:f.req('empty')}),/凭证/);
 await f.service.deliverMail('rider',id,{note:'已当面交付',images:['cloud://proof'],requestId:f.req('deliver')});
 await assert.rejects(f.service.finishMail('rider',id,{requestId:f.req('wrongfinish')}),/发布者/);
 const input={requestId:f.req('finish')};await f.service.finishMail('poster',id,input);await f.service.finishMail('poster',id,input);
 assert.equal(f.table('mail').get(id).MAIL_STATUS,9);assert.equal(f.table('order_event').size,4);
 for(const quota of f.table('order_quota').values())assert.equal(quota.active.length,0);
 await f.service.delMail('poster',id,{requestId:f.req('archive')});assert.ok(f.table('mail').has(id));
});

test('exception freezes flow and requires active administrator resolution with audit',async()=>{
 const f=fixture(),id=await f.publish();await f.service.acceptMail('rider',id,{requestId:f.req('accept')});
 await f.service.exceptionMail('poster',id,{reason:'申请取消',note:'地址填写错误',requestId:f.req('exception')});
 await assert.rejects(f.service.deliverMail('rider',id,{note:'送达',images:['cloud://proof'],requestId:f.req('deliver')}));
 await assert.rejects(f.service.resolveMail('missing',id,{resolution:'cancel',note:'双方同意',requestId:f.req('resolve')}),/管理员/);
 await f.service.resolveMail('admin',id,{resolution:'cancel',note:'已联系双方核实，同意取消',requestId:f.req('resolve')});
 assert.equal(f.table('mail').get(id).MAIL_STATUS,99);assert.equal(f.table('mail').get(id).MAIL_HISTORY.at(-1).actor,'admin');
});

test('quota counts concurrent publishes and accepted orders; unsafe mutation APIs are disabled',async()=>{
 const f=fixture();f.config.maxOpenOrders=1;const results=await Promise.allSettled([f.publish({requestId:f.req('one')}),f.publish({requestId:f.req('two')})]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
 await assert.rejects(f.service.statusMail(),/禁用/);await assert.rejects(f.service.updateMailForms(),/禁止/);
 const id=[...f.table('mail').keys()][0];await assert.rejects(f.service.delMail('poster',id,{requestId:f.req('delete')}),/已结束/);
 await assert.rejects(f.service.getMailList('other',{whereEx:{MAIL_USER_ID:'poster'}}),/不允许/);
});

test('feedback is participant scoped and optimistic replies are idempotent and notify once',async()=>{
 const f=fixture(),id=await f.publish(),svc=new (f.load('feedback_service.js'))();const input={title:'配送投诉',content:'请协助联系',type:'complain',orderId:id,requestId:f.req('fb')};
 await assert.rejects(svc.insertFeedback('other',input),/本人/);const fb=(await svc.insertFeedback('poster',input)).id;
 await assert.rejects(svc.getMyFeedbackDetail('other',fb),/不存在/);
 await svc.replyFeedback(fb,'已联系双方核实','admin',0,f.req('reply'),1);await svc.replyFeedback(fb,'已联系双方核实','admin',0,f.req('reply'),1);
 await assert.rejects(svc.replyFeedback(fb,'更新说明','admin',0,f.req('stale'),1),/刷新/);
 assert.equal(f.table('feedback').get(fb).FB_VERSION,1);assert.equal([...f.table('notification').values()].filter(x=>x.feedbackId===fb).length,1);
});

test('maintenance expires only waiting offline orders, not delivered orders, and is repeat safe',async()=>{
 const f=fixture(),id=await f.publish();f.table('mail').get(id).MAIL_END_TIME=1;
 const svc=new (f.load('maintenance_service.js'))();await svc.run();await svc.run();assert.equal(f.table('mail').get(id).MAIL_STATUS,99);assert.equal(f.table('order_event').size,2);
 const second=await f.publish({requestId:f.req('second')});await f.service.acceptMail('rider',second,{requestId:f.req('accept')});await f.service.deliverMail('rider',second,{note:'送达',images:['cloud://proof'],requestId:f.req('deliver')});f.table('mail').get(second).MAIL_DUE_TIME=1;await svc.run();await svc.run();assert.equal(f.table('mail').get(second).MAIL_STATUS,2);assert.equal(f.table('mail').get(second).MAIL_HISTORY.filter(x=>x.action==='overdue').length,1);
});

test('notification claim prevents double dispatch and retry budget terminates failures',async()=>{
 const before=[process.env.ORDER_SUBSCRIBE_TEMPLATE_ID,process.env.ORDER_SUBSCRIBE_FIELDS];process.env.ORDER_SUBSCRIBE_TEMPLATE_ID='template';process.env.ORDER_SUBSCRIBE_FIELDS=JSON.stringify({order:'character_string1',status:'thing2',time:'time3'});
 try{const f=fixture();await f.publish();const id=[...f.table('notification').keys()][0];f.table('subscription').set(f.store.key('crun','poster'),{enabled:true});const svc=new (f.load('maintenance_service.js'))();await Promise.all([svc.dispatch(id),svc.dispatch(id)]);assert.equal(f.sends,1);assert.equal(f.table('notification').get(id).delivery,'sent');
 f.table('notification').get(id).delivery='pending';f.table('notification').get(id).attempts=0;f.setSendError({errCode:500});for(let i=0;i<3;i++){f.table('notification').get(id).nextAttemptAt=0;await svc.dispatch(id);}assert.equal(f.table('notification').get(id).delivery,'failed');await svc.dispatch(id);assert.equal(f.sends,4);
 }finally{for(const [i,name] of ['ORDER_SUBSCRIBE_TEMPLATE_ID','ORDER_SUBSCRIBE_FIELDS'].entries())if(before[i]===undefined)delete process.env[name];else process.env[name]=before[i];}
});

test('scrypt passwords reject weak and legacy hashes and use randomized salts',()=>{
 assert.throws(()=>password.hash('123456'));const secret='ValidPass2026abc';const one=password.hash(secret),two=password.hash(secret);assert.notEqual(one,two);assert.equal(password.verify(secret,one),true);assert.equal(password.verify('wrong',one),false);assert.equal(password.verify(secret,'e10adc3949ba59abbe56e057f20f883e'),false);
});

test('admin login verifies password before issuing a token and password changes revoke it',async()=>{
 const f=fixture(),row=f.table('admin').get('admin');Object.assign(row,{ADMIN_NAME:'operator',ADMIN_PASSWORD:password.hash('ValidPass2026abc'),ADMIN_LOGIN_CNT:0});const svc=new (f.load('admin/admin_mgr_service.js'))();
 await assert.rejects(svc.adminLogin('operator','wrong','poster'));assert.equal(row.ADMIN_TOKEN,undefined);
 const login=await svc.adminLogin('operator','ValidPass2026abc','poster');assert.equal(login.token.length,64);assert.equal(f.table('admin').get('admin').ADMIN_TOKEN_USER,'poster');
 await svc.pwdtMgr('admin','ValidPass2026abc','ChangedPass2026abc');assert.equal(f.table('admin').get('admin').ADMIN_TOKEN,'');
});

test('registration is unique under racing calls and cannot self-authorize or edit a disabled profile',async()=>{
 const f=fixture(),svc=new (f.load('passport_service.js'))();f.config.registrationReview=true;const input={name:'同学',mobile:'13912345678',pic:'/avatar.png',forms:[],status:1};
 await Promise.all([svc.register('newuser',input),svc.register('newuser',input)]);const users=[...f.table('user').values()].filter(x=>x.USER_MINI_OPENID==='newuser');assert.equal(users.length,1);assert.equal(users[0].USER_STATUS,0);assert.equal(users[0].USER_MOBILE_VERIFIED,false);
 await assert.rejects(svc.register('newuser2',input),/登记/);f.user('blocked',{USER_STATUS:9});await assert.rejects(svc.editBase('blocked',{...input,mobile:'13987654321'}),/停用/);
});


test('invalid quantity coercions and normalized impossible dates are rejected',()=>{
 const f=fixture(),rules=f.load('order_rules.js');for(const value of [true,false,[],[1],{},'1e0','1.0',' ']){const forms=f.forms();forms.find(x=>x.mark==='small').val=value;assert.throws(()=>rules.validateForms(forms,f.config,Date.now()));}
 const forms=f.forms();forms.push({mark:'formEnd',val:'2026-02-30 12:00'});assert.throws(()=>rules.validateForms(forms,f.config,Date.parse('2026-02-27T00:00:00+08:00')),/有效日期/);
});
test('administrator can freeze and resolve a disabled participant order with preserved audit',async()=>{
 const f=fixture(),id=await f.publish();await f.service.acceptMail('rider',id,{requestId:f.req('take')});f.user('poster',{USER_STATUS:9});await f.service.holdMail('admin',id,{note:'发单人已停用，人工核实',requestId:f.req('hold')});assert.equal(f.table('mail').get(id).MAIL_STATUS,3);
 await f.service.resolveMail('admin',id,{resolution:'cancel',note:'核实尚未取件，双方取消',requestId:f.req('resolve')});assert.equal(f.table('mail').get(id).MAIL_STATUS,99);assert.equal(f.table('order_event').size,4);assert.ok([...f.table('order_quota').values()].every(x=>x.active.length===0));
});
test('configuration and rider reviews recheck current administrator permission inside transaction',async()=>{
 const f=fixture(),Config=f.load('operation_config_service.js'),Ops=f.load('operations_service.js');f.table('admin').get('admin').ADMIN_STATUS=0;
 await assert.rejects(new Config().saveConfig(f.config,'admin'),/权限已失效/);await assert.rejects(new Ops().riderReview('admin','rider',1,'身份核验通过'),/停用/);assert.equal(f.table('operation_audit').size,0);
 f.table('admin').get('admin').ADMIN_STATUS=1;await new Config().saveConfig(f.config,'admin');assert.equal(f.table('operation_audit').size,1);
});
