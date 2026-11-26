const test=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('../test-support/operations-fixture.cjs');
const password=require('../../cloudfunctions/mcloud/framework/utils/password_util.js');

test('server recomputes cents and rejects malformed forms, disabled service and bad deadlines',async()=>{
 const f=fixture(),rules=f.load('order_rules.js');const forms=f.forms();forms.push({mark:'price',val:1});
 assert.equal(rules.validateForms(forms,f.config,Date.now()).totalFee,100);
 // 跑腿费下限 1 元：低于 1 元的整单价格被拒绝。
 for(const low of [0.99,0.01]){const input=f.forms();input.push({mark:'price',val:low});assert.throws(()=>rules.validateForms(input,f.config,Date.now()));}
 for(const transform of [a=>a.push({mark:'tel',val:'123'}),a=>a.find(x=>x.mark==='small').val=-1,a=>a.find(x=>x.mark==='small').val=1.5,a=>a.find(x=>x.mark==='campus').val='外校',a=>a.find(x=>x.mark==='urgent').val=true,a=>a.find(x=>x.mark==='img').val=['https://untrusted'],a=>a.push({mark:'formEnd',val:'2020-01-01 12:00'})]){
  const input=f.forms();transform(input);assert.throws(()=>rules.validateForms(input,f.config,Date.now()));
 }
 f.config.enabled=false;await assert.rejects(f.publish(),/暂停/);assert.equal(f.table('mail').size,0);
});

test('public DTO exposes pickup and delivery locations without contacts or pickup credentials',async()=>{
 const f=fixture(),id=await f.publish();const row=f.table('mail').get(id);row.MAIL_OBJ.imgUrls=['cloud://env/private/poster/secret.jpg'];
 row.MAIL_OBJ.tel2='PRIVATE_SECOND_CONTACT';
 const outsider=await f.service.viewMail('other',id);const json=JSON.stringify(outsider);
 assert.equal(outsider.MAIL_OBJ.address1,'菜鸟一期');assert.equal(outsider.MAIL_OBJ.address2,'宿舍101');
 for(const sensitive of ['MAIL_FORMS','123-456','小王','13800000000','PRIVATE_SECOND_CONTACT','secret.jpg','MAIL_USER_ID'])assert.ok(!json.includes(sensitive),sensitive);
 const own=await f.service.viewMail('poster',id);assert.equal(own.mypost,true);assert.ok(own.MAIL_MEDIA.pickup[0].startsWith('https://signed.invalid'));
 await assert.rejects(f.service.getMailDetail('other',id),/无权限/);
});

test('locations stay public while credentials unlock only for the accepting rider and history stays publisher-only',async()=>{
 const f=fixture(),id=await f.publish();
 const row=f.table('mail').get(id);
 row.MAIL_OBJ.packages=[{type:'small',price:1.5,code:'PRIVATE_PACKAGE_CODE',note:'PRIVATE_PACKAGE_NOTE',images:[]}];
 row.MAIL_OBJ.imgUrls=['cloud://env/private/poster/secret.jpg'];
 row.MAIL_OBJ.tel2='PRIVATE_SECOND_CONTACT';
 row.MAIL_HISTORY[0].note='PRIVATE_HISTORY';
 const assertPublic=mail=>{
  assert.equal(mail.mypost,false);assert.equal(mail.myaccept,false);
  assert.equal(mail.MAIL_OBJ.address1,'菜鸟一期');assert.equal(mail.MAIL_OBJ.address2,'宿舍101');
  for(const key of ['poster','tel','tel2','code','packages','imgUrl','imgUrls'])assert.equal(mail.MAIL_OBJ[key],undefined,key);
  assert.equal(mail.acceptUser,undefined);
  for(const value of ['MAIL_FORMS','MAIL_HISTORY','MAIL_MEDIA','123-456','PRIVATE_PACKAGE_CODE','PRIVATE_PACKAGE_NOTE','PRIVATE_HISTORY','secret.jpg','小王','13800000000','PRIVATE_SECOND_CONTACT'])assert.ok(!JSON.stringify(mail).includes(value),value);
 };
 for(const user of ['','rider','other']) {
  assertPublic(await f.service.viewMail(user,id));
  const list=await f.service.getMailList(user,{sortType:'wait'});
  assert.equal(list.list.length,1);assertPublic(list.list[0]);
 }
 const before=await f.service.viewMail('poster',id);
 assert.equal(before.MAIL_OBJ.code,'123-456');assert.equal(before.MAIL_HISTORY[0].note,'PRIVATE_HISTORY');
 await f.service.acceptMail('rider',id,{requestId:f.req('accept')});
 const rider=await f.service.viewMail('rider',id);
 assert.equal(rider.myaccept,true);assert.equal(rider.MAIL_OBJ.code,'123-456');
 assert.equal(rider.MAIL_OBJ.address1,'菜鸟一期');assert.equal(rider.MAIL_OBJ.address2,'宿舍101');
 assert.equal(rider.MAIL_OBJ.poster,'小王');assert.equal(rider.MAIL_OBJ.tel,'13800000000');assert.equal(rider.MAIL_OBJ.tel2,'PRIVATE_SECOND_CONTACT');
 assert.equal(rider.MAIL_OBJ.packages[0].code,'PRIVATE_PACKAGE_CODE');assert.equal(rider.MAIL_MEDIA.pickup.length,1);
 assert.equal(rider.MAIL_HISTORY,undefined);
 assertPublic(await f.service.viewMail('other',id));
 const poster=await f.service.viewMail('poster',id),admin=await f.service.getMailDetail(null,id);
 assert.equal(poster.MAIL_HISTORY.length,2);assert.equal(admin.MAIL_HISTORY.length,2);
 assert.equal(poster.MAIL_HISTORY[0].note,'PRIVATE_HISTORY');
 assert.equal(f.table('mail').get(id).MAIL_HISTORY.length,2);
});

test('anonymous viewers never match unassigned or missing order identities',async()=>{
 const f=fixture(),id=await f.publish(),rules=f.load('order_rules.js');
 const row=f.table('mail').get(id);
 for(const userId of ['',null,undefined]) {
  for(const mail of [row,{...row,MAIL_USER_ID:userId,MAIL_ACCEPT_USER_ID:userId}]) {
   const view=rules.project(mail,userId);
   assert.equal(view.mypost,false);assert.equal(view.myaccept,false);
   assert.equal(view.MAIL_OBJ.address1,'菜鸟一期');assert.equal(view.MAIL_OBJ.address2,'宿舍101');
   assert.equal(view.MAIL_OBJ.code,undefined);assert.equal(view.MAIL_FORMS,undefined);assert.equal(view.MAIL_HISTORY,undefined);
  }
 }
 const anonymous=await f.service.viewMail('',id);
 assert.equal(anonymous.mypost,false);assert.equal(anonymous.myaccept,false);
});

test('publish retry is idempotent even after closure, and changed payload cannot reuse the key',async()=>{
 const f=fixture(),id=await f.publish();f.config.enabled=false;assert.equal(await f.publish(),id);assert.equal(f.table('mail').size,1);assert.equal(f.table('order_event').size,1);
 const changed=f.forms();changed.find(x=>x.mark==='small').val=2;await assert.rejects(f.publish({agreements:{accepted:true,userVersion:'2026-11-27',privacyVersion:'2026-11-27'},forms:changed}),/不同内容/);
});

test('two racing riders yield one accept, one quota reservation and no partial loser writes',async()=>{
 const f=fixture(),id=await f.publish();const results=await Promise.allSettled(['rider','rider2'].map(u=>f.service.acceptMail(u,id,{requestId:f.req(u)})));
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(f.table('mail').get(id).MAIL_STATUS,1);assert.equal(f.table('order_event').size,2);
 assert.equal([...f.table('order_quota').values()].filter(x=>x.role==='rider').length,1);
});

test('active registered users, order campus, self-accept and deadline are server enforced',async()=>{
 const inactive=fixture(),inactiveId=await inactive.publish();inactive.user('rider',{USER_STATUS:9});await assert.rejects(inactive.service.acceptMail('rider',inactiveId,{requestId:inactive.req('inactive')}));assert.equal(inactive.table('mail').get(inactiveId).MAIL_STATUS,0);
 const outside=fixture();const outsideId=await outside.publish();outside.config.campuses=['????'];await assert.rejects(outside.service.acceptMail('rider',outsideId,{requestId:outside.req('campus')}));
 const f=fixture(),id=await f.publish();await assert.rejects(f.service.acceptMail('poster',id,{requestId:f.req('self')}));
 f.table('mail').get(id).MAIL_END_TIME=1;await assert.rejects(f.service.acceptMail('rider',id,{requestId:f.req('deadline')}));
});

test('accept versus cancel serializes and accept versus edit never mutates an accepted order',async()=>{
 const f=fixture(),id=await f.publish();const result=await Promise.allSettled([f.service.acceptMail('rider',id,{requestId:f.req('accept')}),f.service.cancelMail('poster',id,{requestId:f.req('cancel')})]);assert.equal(result.filter(x=>x.status==='fulfilled').length,1);
 if(f.table('mail').get(id).MAIL_STATUS===1)await assert.rejects(f.service.editMail('poster',{id,agreements:{accepted:true,userVersion:'2026-11-27',privacyVersion:'2026-11-27'},forms:f.forms(),requestId:f.req('edit')}),/尚未被接取/);
});

test('only rider can submit required proof; only poster can confirm; quotas released once',async()=>{
 const f=fixture(),id=await f.publish();await f.service.acceptMail('rider',id,{requestId:f.req('accept')});
 await f.service.pickupMail('rider',id,{requestId:f.req('pickup'), images: ['cloud://bucket/private-evidence/rider/pickup.png'] });
 await assert.rejects(f.service.finishMail('poster',id,{requestId:f.req('early')}),/已送达/);
 await assert.rejects(f.service.deliverMail('poster',id,{note:'送达',images:['cloud://proof'],requestId:f.req('wrong')}),/接单人/);
 await assert.rejects(f.service.deliverMail('rider',id,{note:'送达',images:[],requestId:f.req('empty')}),/凭证/);
 await f.service.deliverMail('rider',id,{note:'已当面交付',images:['cloud://proof'],requestId:f.req('deliver')});
 await assert.rejects(f.service.finishMail('rider',id,{requestId:f.req('wrongfinish')}),/发布者/);
 const input={requestId:f.req('finish')};await f.service.finishMail('poster',id,input);await f.service.finishMail('poster',id,input);
 assert.equal(f.table('mail').get(id).MAIL_STATUS,9);assert.equal(f.table('order_event').size,5);
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
 const id=[...f.table('mail').keys()][0];await assert.rejects(f.service.delMail('poster',id,{requestId:f.req('delete')}),/仅可删除已完成/);
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
 const second=await f.publish({requestId:f.req('second')});await f.service.acceptMail('rider',second,{requestId:f.req('accept')});await f.service.pickupMail('rider',second,{requestId:f.req('pickup'), images: ['cloud://bucket/private-evidence/rider/pickup.png'] });await f.service.deliverMail('rider',second,{note:'送达',images:['cloud://proof'],requestId:f.req('deliver')});f.table('mail').get(second).MAIL_DUE_TIME=1;await svc.run();await svc.run();assert.equal(f.table('mail').get(second).MAIL_STATUS,2);assert.equal(f.table('mail').get(second).MAIL_HISTORY.filter(x=>x.action==='overdue').length,1);
});

test('notification claim prevents double dispatch and retry budget terminates failures',async()=>{
 const before=[process.env.ORDER_SUBSCRIBE_TEMPLATE_ID,process.env.ORDER_SUBSCRIBE_FIELDS];process.env.ORDER_SUBSCRIBE_TEMPLATE_ID='template';process.env.ORDER_SUBSCRIBE_FIELDS=JSON.stringify({order:'character_string1',status:'thing2',time:'time3'});
 try{const f=fixture();await f.publish();const id=[...f.table('notification').keys()][0];f.table('subscription').set(f.store.key('crun','poster'),{enabled:true});const svc=new (f.load('maintenance_service.js'))();await Promise.all([svc.dispatch(id),svc.dispatch(id)]);assert.equal(f.sends,1);assert.equal(f.table('notification').get(id).delivery,'sent');
 f.table('notification').get(id).delivery='pending';f.table('notification').get(id).attempts=0;f.setSendError({errCode:500});for(let i=0;i<3;i++){f.table('notification').get(id).nextAttemptAt=0;await svc.dispatch(id);}assert.equal(f.table('notification').get(id).delivery,'failed');await svc.dispatch(id);assert.equal(f.sends,4);
 }finally{for(const [i,name] of ['ORDER_SUBSCRIBE_TEMPLATE_ID','ORDER_SUBSCRIBE_FIELDS'].entries())if(before[i]===undefined)delete process.env[name];else process.env[name]=before[i];}
});

test('scrypt passwords accept the test default and reject legacy hashes',()=>{
 const one=password.hash('123456'),two=password.hash('123456');assert.notEqual(one,two);assert.equal(password.verify('123456',one),true);assert.equal(password.verify('wrong',one),false);assert.equal(password.verify('123456','e10adc3949ba59abbe56e057f20f883e'),false);
});

test('admin login verifies password before issuing a token and password changes revoke it',async()=>{
 const f=fixture(),row=f.table('admin').get('admin');Object.assign(row,{ADMIN_NAME:'operator',ADMIN_PASSWORD:password.hash('ValidPass2026abc'),ADMIN_LOGIN_CNT:0});const svc=new (f.load('admin/admin_mgr_service.js'))();
 await assert.rejects(svc.adminLogin('operator','wrong','poster'));assert.equal(row.ADMIN_TOKEN,undefined);
 const login=await svc.adminLogin('operator','ValidPass2026abc','poster');assert.equal(login.token.length,64);assert.equal(f.table('admin').get('admin').ADMIN_TOKEN_USER,'poster');
 await svc.pwdtMgr('admin','ValidPass2026abc','ChangedPass2026abc');assert.equal(f.table('admin').get('admin').ADMIN_TOKEN,'');
});

test('registration is unique under racing calls and cannot self-authorize or edit a disabled profile',async()=>{
 const f=fixture(),svc=new (f.load('passport_service.js'))();f.config.registrationReview=true;const input={name:'同学',mobile:'13912345678',pic:'cloud://test/avatar.png',agreements:{accepted:true,userVersion:'2026-11-27',privacyVersion:'2026-11-27'},forms:[{mark:'sex',val:'男'},{mark:'college',val:'计算机学院'},{mark:'sub',val:'软件工程'},{mark:'studentId',val:'20240001'},{mark:'studentCard',val:['cloud://test/student-card.png']},{mark:'disclaimer',val:true},{mark:'campus',val:'育才校区'}],status:1};
 await svc.wechatIdentityLogin('newuser');
 await Promise.all([svc.register('newuser',input),svc.register('newuser',input)]);const users=[...f.table('user').values()].filter(x=>x.USER_MINI_OPENID==='newuser');assert.equal(users.length,1);assert.equal(users[0].USER_STATUS,0);assert.equal(users[0].USER_MOBILE_VERIFIED,false);
 await svc.wechatIdentityLogin('newuser2');
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
test('configuration rechecks current administrator permission inside transaction',async()=>{
 const f=fixture(),Config=f.load('operation_config_service.js'),Ops=f.load('operations_service.js');f.table('admin').get('admin').ADMIN_STATUS=0;
 await assert.rejects(new Config().saveConfig(f.config,'admin'));assert.equal(f.table('operation_audit').size,0);
 f.table('admin').get('admin').ADMIN_STATUS=1;await new Config().saveConfig(f.config,'admin');assert.equal(f.table('operation_audit').size,1);
});

// 配送要求（骑手性别 / 送上楼）：白名单校验、非代取丢弃、公开字段与接单性别拦截。
function requirementForms(f, riderGender, upstairs) {
 const forms = f.forms();
 if (riderGender !== undefined) forms.push({ mark: 'riderGender', val: riderGender });
 if (upstairs !== undefined) forms.push({ mark: 'upstairs', val: upstairs });
 return forms;
}
function sexed(f, userId, sex) {
 f.user(userId, { USER_FORMS: [{ mark: 'sex', val: sex }, { mark: 'college', val: '计算机学院' }, { mark: 'sub', val: '软件工程' }, { mark: 'campus', val: '育才校区' }] });
}

test('delivery requirements accept only known values and default for take orders', () => {
 const f = fixture(), rules = f.load('order_rules.js'), now = Date.now();
 const take = (riderGender, upstairs) => rules.validateForms(requirementForms(f, riderGender, upstairs), f.config, now).obj;
 assert.equal(take(undefined, undefined).riderGender, 'any');
 assert.equal(take(undefined, undefined).upstairs, false);
 assert.equal(take('male', true).riderGender, 'male');
 assert.equal(take('male', true).upstairs, true);
 for (const bad of ['girl', 'MALE', '', 1, true, {}]) assert.throws(() => take(bad, false), /骑手性别/);
 for (const bad of ['true', 1, 'yes', {}, [], 0]) assert.throws(() => take('any', bad), /送上楼/);
});

test('non-take orders silently drop delivery requirements', () => {
 const f = fixture(), rules = f.load('order_rules.js');
 for (const serviceType of ['send', 'buy']) {
  const forms = requirementForms(f, 'not-a-gender', 'not-a-boolean');
  forms.push({ mark: 'serviceType', val: serviceType });
  if (serviceType === 'buy') forms.push(...Object.entries({ goods: '纯牛奶250ml', buyQuantity: 1, goodsBudget: 10 }).map(([mark, val]) => ({ mark, val })));
  const normalized = rules.validateForms(forms, f.config, Date.now());
  assert.equal(normalized.obj.serviceType, serviceType);
  assert.equal(Object.prototype.hasOwnProperty.call(normalized.obj, 'riderGender'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(normalized.obj, 'upstairs'), false);
  assert.ok(!normalized.forms.some(item => item.mark === 'riderGender' || item.mark === 'upstairs'));
 }
});

test('public order projection exposes delivery requirements before accepting', async () => {
 const f = fixture(), id = await f.publish({ agreements:{accepted:true,userVersion:'2026-11-27',privacyVersion:'2026-11-27'},forms: requirementForms(f, 'female', true) });
 const publicOrder = (await f.service.getMailList('rider', { sortType: 'wait' })).list[0];
 assert.equal(publicOrder.MAIL_OBJ.riderGender, 'female');
 assert.equal(publicOrder.MAIL_OBJ.upstairs, true);
 assert.equal((await f.service.viewMail('other', id)).MAIL_OBJ.riderGender, 'female');
});

test('gender-restricted orders reject the wrong or missing rider sex and never block any/legacy orders', async () => {
 const female = fixture(), femaleId = await female.publish({ agreements:{accepted:true,userVersion:'2026-11-27',privacyVersion:'2026-11-27'},forms: requirementForms(female, 'female', false) });
 await assert.rejects(female.service.acceptMail('rider', femaleId, { requestId: female.req('male-rider') }), /该订单仅限女生配送/);
 assert.equal(female.table('mail').get(femaleId).MAIL_STATUS, 0);
 sexed(female, 'rider2', '女');
 await female.service.acceptMail('rider2', femaleId, { requestId: female.req('female-rider') });
 assert.equal(female.table('mail').get(femaleId).MAIL_ACCEPT_USER_ID, 'rider2');

 const male = fixture(), maleId = await male.publish({ agreements:{accepted:true,userVersion:'2026-11-27',privacyVersion:'2026-11-27'},forms: requirementForms(male, 'male', false) });
 sexed(male, 'rider', '女');
 await assert.rejects(male.service.acceptMail('rider', maleId, { requestId: male.req('female-rider') }), /该订单仅限男生配送/);

 const any = fixture(), anyId = await any.publish({ agreements:{accepted:true,userVersion:'2026-11-27',privacyVersion:'2026-11-27'},forms: requirementForms(any, 'any', false) });
 await any.service.acceptMail('rider', anyId, { requestId: any.req('any-rider') });

 const legacy = fixture(), legacyId = await legacy.publish();
 assert.equal(legacy.table('mail').get(legacyId).MAIL_OBJ.riderGender, 'any');
 await legacy.service.acceptMail('rider', legacyId, { requestId: legacy.req('legacy') });
});

test('a rider without a recorded sex cannot accept a gender-restricted order', async () => {
 const f = fixture(), id = await f.publish({ agreements:{accepted:true,userVersion:'2026-11-27',privacyVersion:'2026-11-27'},forms: requirementForms(f, 'female', false) });
 f.user('rider', { USER_FORMS: [{ mark: 'college', val: '计算机学院' }] });
 // 资料完整性由既有资料规则先行拦截；这里放开它，单独验证接单侧的兜底提示。
 f.load('profile_rules.js').isReady = () => true;
 await assert.rejects(f.service.acceptMail('rider', id, { requestId: f.req('no-sex') }), /该订单有性别要求，请先在个人资料中填写性别/);
 assert.equal(f.table('mail').get(id).MAIL_STATUS, 0);
});

test('reference prices saved below 1 yuan are used as 1 yuan and do not block other settings',async()=>{
 const f=fixture(),Config=f.load('operation_config_service.js'),row=[...f.table('operation_config').values()][0];
 row.value={...row.value,smallPrice:0.5,mediumPrice:0.01};
 const read=await new Config().getConfig();assert.equal(read.smallPrice,1);assert.equal(read.mediumPrice,1);assert.equal(read.largePrice,row.value.largePrice);
 const saved=await new Config().saveConfig({maxActiveOrders:4},'admin','rules');assert.equal(saved.maxActiveOrders,4);assert.equal(saved.smallPrice,1);
 await assert.rejects(new Config().saveConfig({smallPrice:0.5},'admin','pricing'),/smallPrice/);
});
