'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,A,B,C,tenant}=require('../test-support/tenant-services.cjs');
const req=name=>'request_'+name.padEnd(16,'_');
async function setup(){const f=fixture();await f.setup();return f;}
async function publish(f,scope=A,name='publish') {return tenant.run(scope,()=>new (f.service('mail_service'))().insertMail('poster',{forms:f.forms(scope),requestId:req(name)}));}
test('orders, configurations, quotas and notifications stay in their server-resolved campus',async()=>{
  const f=await setup(),a=await publish(f,A,'a'),b=await publish(f,B,'b'),c=await publish(f,C,'c');
  for(const [scope,id] of [[A,a._id],[B,b._id],[C,c._id]])await tenant.run(scope,async()=>{
    const rows=(await f.db.collection('bx_mail').get()).data;assert.deepEqual(rows.map(x=>x._id),[id]);
    const Mail=f.service('mail_service');
    assert.equal(await new Mail().getMailDetail('poster',scope===A?b._id:a._id),null);
    for(const name of ['notification','order_quota'])assert.ok((await f.db.collection('bx_'+name).get()).data.every(row=>row.schoolId===scope.schoolId&&row.campusId===scope.campusId));
  });
  assert.equal(f.table('order_quota').size,3);
  const dir=new (f.service('tenant_service'))();await assert.rejects(dir.resolve({schoolId:A.schoolId,campusId:'missing'}),/不存在/);
  await assert.rejects(dir.resolve({schoolId:'../other',campusId:A.campusId}),/编号/);
});
test('publishing and recovering a request in another campus cannot create a second order',async()=>{
  const f=await setup(),id=await publish(f,A,'same');
  await assert.rejects(publish(f,B,'same'),/原提交校区/);
  const Recovery=f.service('request_recovery_service');
  await assert.rejects(tenant.run(B,()=>new Recovery().recover('poster',{route:'mail/insert',requestId:req('same')})),/原提交校区/);
  const result=await tenant.run(A,()=>new Recovery().recover('poster',{route:'mail/insert',requestId:req('same')}));
  assert.equal(result.state,'committed');assert.equal(result.result._id,id._id);assert.equal(f.table('mail').size,1);
});
test('simultaneous acceptance has one winner and foreign-campus riders cannot participate',async()=>{
  const f=await setup(),published=await publish(f),Mail=f.service('mail_service');
  const jobs=Array.from({length:20},(_,i)=>tenant.run(i%3===0?B:A,()=>new Mail().acceptMail(i%2?'rider':'rider2',published._id,{requestId:req('claim'+i)})));
  const outcomes=await Promise.allSettled(jobs);assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(f.table('mail').get(published._id).MAIL_STATUS,1);
  assert.equal([...f.table('order_event').values()].filter(x=>x.action==='accept').length,1);
  assert.ok([...f.table('order_event').values()].every(x=>x.campusId===A.campusId));
});
test('directory edits require live platform authority, preserve versions, and new campuses stay paused',async()=>{
  const f=await setup(),Tenant=f.service('tenant_service'),svc=new Tenant();
  await tenant.run(A,async()=>{
    const admin=f.platform();
    await svc.saveSchool(admin,{schoolId:'new_school',name:'新学校',enabled:true,version:0});
    const value={schoolId:'new_school',campusId:'north',name:'北校区',enabled:true,version:0,locations:{phases:['北苑'],pickupStations:[{name:'北门',list:['服务点']} ]}};
    await svc.saveCampus(admin,value);
    await assert.rejects(svc.saveCampus(admin,value),/配置已更新/);
    const scope=await svc.resolve(value);
    await tenant.run(scope,async()=>{
      const Config=f.service('operation_config_service'),config=await new Config().getConfig();assert.equal(config.enabled,false);assert.deepEqual(Array.from(config.locations.phases),['北苑']);
      await new Config().saveConfig({smallPrice:2},admin._id,'pricing');assert.equal((await new Config().getConfig()).enabled,false);
    });
    f.table('admin').get('platform').ADMIN_PLATFORM=false;
    await assert.rejects(svc.saveSchool({...admin,ADMIN_PLATFORM:true},{schoolId:'other',name:'错误',enabled:true,version:0}),/平台管理员/);
  });
});

test('directory metadata excludes location bodies and grants, while details enforce platform access',async()=>{
  const f=await setup(),svc=new (f.service('tenant_service'))();
  f.table('admin').set('local',{_id:'local',_pid:'crun',ADMIN_NAME:'校区管理员',ADMIN_STATUS:1,ADMIN_TYPE:1,ADMIN_SCOPES:[{schoolId:A.schoolId,campusId:A.campusId}],ADMIN_PASSWORD:'private',ADMIN_TOKEN:'secret'});
  await tenant.run(A,async()=>{
    const directory=await svc.adminDirectory(f.platform());
    assert.equal(directory.campuses.length,3);
    assert.ok(directory.campuses.every(row=>row.locations===undefined));
    assert.ok(directory.admins.every(row=>row.scopes===undefined));
    assert.equal(JSON.stringify(directory).includes('secret'),false);
    const campus=await svc.adminCampusDetail(f.platform(),B);assert.ok(campus.locations.phases.length>0);
    const admin=await svc.adminAccountDetail(f.platform(),'local');assert.equal(admin.scopes[0].campusId,A.campusId);
    assert.equal(admin.ADMIN_PASSWORD,undefined);assert.equal(admin.ADMIN_TOKEN,undefined);
    for(const work of [()=>svc.adminDirectory(f.table('admin').get('local')),()=>svc.adminCampusDetail(f.table('admin').get('local'),B),()=>svc.adminAccountDetail(f.table('admin').get('local'),'platform')])await assert.rejects(work,/平台管理员/);
  });
});
test('scoped admin grants are rechecked inside the order transaction',async()=>{
  const f=await setup(),id=(await publish(f,A))._id,Mail=f.service('mail_service');
  f.table('admin').set('local',{_id:'local',_pid:'crun',ADMIN_STATUS:1,ADMIN_TYPE:1,ADMIN_SCOPES:[{schoolId:A.schoolId,campusId:B.campusId}]});
  await assert.rejects(tenant.run(A,()=>new Mail().holdMail('local',id,{requestId:req('hold'),note:'核验'})),/权限/);
  assert.equal(f.table('mail').get(id).MAIL_STATUS,0);
  await tenant.run(A,()=>new (f.service('tenant_service'))().grantAdmin(f.platform(),{adminId:'local',scopes:[{schoolId:A.schoolId,campusId:A.campusId}],type:1}));
  assert.equal(f.table('admin').get('local').ADMIN_TOKEN,'');
  await tenant.run(A,()=>new Mail().holdMail('local',id,{requestId:req('hold'),note:'核验'}));
  assert.equal(f.table('mail').get(id).MAIL_STATUS,3);
});
test('news manifests and read acknowledgements isolate campuses and survive edits',async()=>{
  const f=await setup(),Catalog=f.service('news_catalog_service');
  for(const [scope,id] of [[A,'news-a'],[B,'news-b']])await tenant.run(scope,()=>new Catalog().change(id,{NEWS_TITLE:id,NEWS_CONTENT:[{type:'text',val:'正文'}],NEWS_STATUS:1},{insert:true}));
  await tenant.run(A,async()=>{
    const catalog=new Catalog();const state=await catalog.forUser('poster');assert.deepEqual(Array.from(state.entries,x=>x._id),['news-a']);
    await f.store.transaction(tx=>catalog.acknowledge(tx,'poster','news-a'));
    await catalog.change('news-a',{NEWS_TITLE:'已编辑'});
    const refreshed=await catalog.forUser('poster');assert.equal(refreshed.entries[0].NEWS_TITLE,'已编辑');assert.equal(refreshed.readIds.has('news-a'),true);
  });
  const b=await tenant.run(B,()=>new Catalog().forUser('poster'));assert.equal(b.readIds.has('news-a'),false);assert.deepEqual(Array.from(b.entries,x=>x._id),['news-b']);
});
test('scheduled jobs process all campuses with transactions and skip zero due times',async()=>{
  const f=await setup(),now=Date.now();
  for(const [scope,id] of [[A,'expire-a'],[B,'expire-b'],[C,'expire-c']])await f.put(scope,'mail',id,{MAIL_STATUS:0,MAIL_PAYMENT_MODE:'offline',MAIL_END_TIME:now-500,MAIL_USER_ID:'poster',MAIL_OBJ:{}});
  await f.put(A,'mail','zero',{MAIL_STATUS:1,MAIL_DUE_TIME:0,MAIL_USER_ID:'poster',MAIL_OBJ:{}});
  const result=await new (f.service('maintenance_service'))().runScheduled('orders',{batchSize:2,maxBatches:4});
  assert.equal(result.failed,0);assert.equal(result.processed,3);
  for(const id of ['expire-a','expire-b','expire-c'])assert.equal(f.table('mail').get(id).MAIL_STATUS,99);
  assert.equal(f.table('mail').get('zero').MAIL_OVERDUE_NOTIFIED,undefined);
  assert.equal(f.table('order_event').size,3);
});
test('failed oldest worker rows do not starve later rows across bounded runs',async()=>{
  const f=await setup(),now=Date.now(),Worker=f.service('maintenance_service'),worker=new Worker();
  for(let i=0;i<4;i++)await f.put(A,'mail','due-'+i,{MAIL_STATUS:0,MAIL_PAYMENT_MODE:'offline',MAIL_END_TIME:now-5000+i,MAIL_USER_ID:'poster',MAIL_OBJ:{}});
  const original=worker._sweep.bind(worker);worker._sweep=(id,action)=>id==='due-0'?Promise.reject(Error('poison row')):original(id,action);
  const first=await worker.runScheduled('orders',{batchSize:1,maxBatches:2});assert.equal(first.failed,1);assert.equal(first.processed,1);assert.equal(first.hasMore,true);
  const second=await worker.runScheduled('orders',{batchSize:1,maxBatches:5});assert.equal(second.processed,2);
  assert.equal(f.table('mail').get('due-3').MAIL_STATUS,99);assert.equal(f.table('mail').get('due-0').MAIL_STATUS,0);
});
test('plugin quotes are versioned and explicitly enabled opening hours are enforced by the server',async()=>{
  const f=await setup(),id=(await publish(f))._id,row=f.table('mail').get(id),rules=f.service('order_rules');
  assert.equal(row.MAIL_SCHEMA_VERSION,2);assert.equal(row.MAIL_RULE_SNAPSHOT.pluginVersion,1);assert.equal(row.MAIL_RULE_SNAPSHOT.totalFee,150);
  const config={enabled:true,enforceBusinessHours:true,openHour:8,closeHour:22};
  assert.throws(()=>rules.requireOpen(config,Date.parse('2026-09-21T23:00:00+08:00')),/营业时间/);
  assert.doesNotThrow(()=>rules.requireOpen(config,Date.parse('2026-09-21T09:00:00+08:00')));
});

test('business hours controls only affect the authorized campus',async()=>{
  const f=await setup(),Config=f.service('operation_config_service');
  const local={_id:'local',_pid:'crun',ADMIN_STATUS:1,ADMIN_TYPE:1,ADMIN_SCOPES:[{schoolId:A.schoolId,campusId:A.campusId}]};
  f.table('admin').set(local._id,local);
  await tenant.run(A,()=>new Config().saveConfig({enforceBusinessHours:true},local._id,'service'));
  assert.equal((await tenant.run(A,()=>new Config().getConfig())).enforceBusinessHours,true);
  assert.equal((await tenant.run(B,()=>new Config().getConfig())).enforceBusinessHours,false);
  await assert.rejects(tenant.run(B,()=>new Config().saveConfig({enforceBusinessHours:true},local._id,'service')),/权限/);
  assert.equal((await tenant.run(B,()=>new Config().getConfig())).enforceBusinessHours,false);
});
test('the feed endpoint returns only current-campus opaque revisions',async()=>{
  const f=await setup();await publish(f,A,'feed-a');await publish(f,B,'feed-b');
  const value=await tenant.run(A,()=>new (f.service('operations_service'))().feed());
  assert.equal(value.docs.length,1);assert.deepEqual(Object.keys(value.docs[0]).sort(),['_id','revision']);
  const stored=f.table('order_feed').get(value.docs[0]._id);assert.equal(stored.campusId,A.campusId);
});
test('shared school accounts obey one registration policy and campus grants cannot change it',async()=>{
  const f=await setup();f.table('school').get(A.schoolId).registrationReview=true;
  const Passport=f.service('passport_service'),p={name:'新同学',mobile:'13900000009',pic:'avatar',forms:[{mark:'sex',val:'女'},{mark:'college',val:'计算机学院'},{mark:'sub',val:'软件工程'},{mark:'campus',val:B.campusName}]};
  f.cloud.getWXContext=()=>({OPENID:'new-user',APPID:'wx3d8dc6fb0e764ec7'});
  f.cloud.openapi.phonenumber={getPhoneNumber:async()=>({errCode:0,phoneInfo:{phoneNumber:p.mobile,purePhoneNumber:p.mobile,countryCode:'86',watermark:{appid:'wx3d8dc6fb0e764ec7'}}})};
  await tenant.run(B,()=>new Passport().wechatLogin('new-user',{code:'school-phone-code'}));
  const result=await tenant.run(B,()=>new Passport().register('new-user',p));assert.equal(result.token.status,0);
  const same=await tenant.run(A,()=>new Passport().login('new-user'));assert.equal(same.token.status,0);
  const local={_id:'local',_pid:'crun',ADMIN_STATUS:1,ADMIN_TYPE:1,ADMIN_SCOPES:[{schoolId:A.schoolId,campusId:A.campusId}]};f.table('admin').set(local._id,local);
  await tenant.run(A,async()=>{
    assert.equal(tenant.canSchoolAdmin(local),false);
    assert.equal(tenant.canSchoolAdmin({...local,ADMIN_SCOPES:[{schoolId:A.schoolId,campusId:'*'}]}),true);
    await assert.rejects(new (f.service('operation_config_service'))().saveConfig({registrationReview:false},local._id,'rules'),/学校管理员/);
  });
  assert.equal(f.table('school').get(A.schoolId).registrationReview,true);
});
test('administrator login limits cannot be reset by changing campuses',async()=>{
  const f=await setup();await tenant.run(A,()=>f.store.limitAdmin('crun','same-admin','login',1,900000));
  await assert.rejects(tenant.run(B,()=>f.store.limitAdmin('crun','same-admin','login',1,900000)),/频繁/);
  assert.equal(f.table('admin_limit').size,1);
});
test('worker budget stops starting new items and preserves the first unprocessed row',async()=>{
  const f=await setup(),Worker=f.service('maintenance_service'),worker=new Worker(),real=Date.now;
  let now=real();for(let i=0;i<10;i++)await f.put(A,'mail','budget-'+i,{MAIL_STATUS:0,MAIL_PAYMENT_MODE:'offline',MAIL_END_TIME:now-5000+i,MAIL_USER_ID:'poster'});
  const seen=[];worker._sweep=async id=>{seen.push(id);now+=400;f.table('mail').get(id).MAIL_STATUS=99;};
  try{
    Date.now=()=>now;
    const first=await worker.runScheduled('orders',{batchSize:10,maxBatches:10,budgetMs:1000});assert.ok(first.processed>0&&first.processed<=4);assert.equal(first.hasMore,true);
    const before=seen.length;await worker.runScheduled('orders',{batchSize:10,maxBatches:10,budgetMs:1000});assert.ok(seen.length>before);assert.equal(new Set(seen).size,seen.length);
  }finally{Date.now=real;}
});

test('subscription links retain the originating campus when users have switched elsewhere',async()=>{
  const f=await setup(),vars=['ORDER_SUBSCRIBE_TEMPLATE_ID','ORDER_SUBSCRIBE_FIELDS'],before=vars.map(key=>process.env[key]);
  const sends=[];f.cloud.openapi.subscribeMessage.send=async args=>{sends.push(args);return {errCode:0};};
  try{
    process.env.ORDER_SUBSCRIBE_TEMPLATE_ID='test-template';process.env.ORDER_SUBSCRIBE_FIELDS=JSON.stringify({order:'order',status:'status',time:'time'});
    const order=await publish(f,B,'linked');
    await tenant.run(B,async()=>{
      await f.store.set(f.db,'subscription',f.store.scopeKey('crun','poster'),{_pid:'crun',userId:'poster',enabled:true});
      const message=[...f.table('notification').values()][0];
      await new (f.service('maintenance_service'))().dispatch(message._id);
      assert.equal(sends.length,1);assert.ok(sends[0].page.includes('id='+order._id));
      assert.ok(sends[0].page.includes('schoolId='+B.schoolId));assert.ok(sends[0].page.includes('campusId='+B.campusId));
      assert.ok(sends[0].page.includes('notificationId='+message._id));
    });
  }finally{vars.forEach((key,i)=>before[i]===undefined?delete process.env[key]:process.env[key]=before[i]);}
});
