'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {client,tick}=require('../test-support/reliability-client.cjs');
const directory={schools:[{schoolId:'gxnu',name:'学校 A',enabled:true},{schoolId:'school_b',name:'学校 B',enabled:true}],campuses:[{schoolId:'gxnu',campusId:'yucai',name:'育才校区',enabled:true},{schoolId:'gxnu',campusId:'wangcheng',name:'王城校区',enabled:true},{schoolId:'school_b',campusId:'east',name:'东校区',enabled:true}]};
async function prepare(){const f=client(),tenant=f.load('projects/crun/biz/tenant_biz.js');await tenant.directory(async()=>directory);return {...f,tenant};}
test('initialization shares one catalog read and freezes a command before yielding',async()=>{
  const f=client({unselected:true}),params={id:'original'},task=f.ops().command('mail/accept',params);
  params.id='changed';await tick();assert.equal(f.calls.length,1);assert.equal(f.calls[0].data.route,'tenant/catalog');
  f.respond(0,directory);await tick();assert.equal(f.calls[1].data.params.id,'original');
  assert.deepEqual(structuredClone(f.calls[1].data.scope),{schoolId:'gxnu',campusId:'yucai'});
  f.respond(1,{ok:true});await task;assert.equal(f.timers.size,0);
});
test('catalog failure releases initialization state so the next attempt can recover',async()=>{
  const f=client({unselected:true});const first=f.cloud.ensureScope();const rejected=assert.rejects(first);await tick();f.fail(0);await rejected;
  assert.equal(f.cloud.scopeSnapshot(),null);assert.equal(f.timers.size,0);
  const retry=f.cloud.ensureScope();await tick();f.respond(1,directory);await retry;
  assert.equal(f.cloud.scopeKey(),'gxnu/yucai');
});
test('late campus A replies cannot overwrite campus B data or reuse its read cache',async()=>{
  const f=await prepare();const a=f.cloud.callCloud('mail/list',{}, {hint:false}),aAgain=f.cloud.callCloud('mail/list',{}, {hint:false});
  const rejected=Promise.all([assert.rejects(a,e=>e.staleScope===true),assert.rejects(aAgain,e=>e.staleScope===true)]);
  assert.equal(f.calls.length,1);f.tenant.select(directory.campuses[1],{reload:false});
  const b=f.cloud.callCloud('mail/list',{}, {hint:false});assert.equal(f.calls.length,2);
  f.respond(0,{list:[{_id:'a'}]});f.respond(1,{list:[{_id:'b'}]});await rejected;
  assert.equal((await b).data.list[0]._id,'b');assert.equal(f.calls[1].data.scope.campusId,'wangcheng');
});
test('switching is blocked while a command is pending and recovery retains its original campus',async()=>{
  const f=await prepare(),task=f.ops().command('mail/accept',{id:'order'},{retries:0});const failed=assert.rejects(task);await tick();
  assert.throws(()=>f.tenant.select(directory.campuses[1],{reload:false}),/处理中/);
  f.fail(0);await failed;
  const pending=f.ops().pendingCommand('mail/accept',{id:'order'});assert.equal(pending.scope.campusId,'yucai');
  f.tenant.select(directory.campuses[1],{reload:false});assert.equal(f.ops().pendingCommand('mail/accept',{id:'order'}),null);
  f.tenant.select(directory.campuses[0],{reload:false});assert.equal(f.ops().pendingCommand('mail/accept',{id:'order'}).requestId,pending.requestId);
  const recovery=f.ops().recoverCommand('mail/accept',{id:'order'});await tick();assert.equal(f.calls[1].data.scope.campusId,'yucai');
  f.respond(1,{state:'committed',result:{id:'order'}});await recovery;assert.equal(f.ops().pendingCommand('mail/accept',{id:'order'}),null);
});
test('switching schools clears login and list caches but retains uncertain request identifiers',async()=>{
  const f=await prepare();for(const key of ['CACHE_TOKEN','CACHE_TOKEN_deadtime','orders_LIST','orders_LIST_deadtime'])f.storage.set(key,'old');
  f.storage.set('crun-pending:rider:mail/insert:new:gxnu/yucai',{requestId:'keep'});
  f.tenant.select(directory.campuses[2],{reload:false});
  assert.equal(f.storage.has('CACHE_TOKEN'),false);assert.equal(f.storage.has('orders_LIST'),false);
  assert.equal(f.storage.get('crun-pending:rider:mail/insert:new:gxnu/yucai').requestId,'keep');
});
test('a disabled saved campus offers valid alternatives, while admins can reopen the final disabled campus',async()=>{
  const f=client(),component=f.mount('projects/crun/cmpts/campus_selector/campus_selector.js');await tick();
  const disabled=structuredClone(directory);disabled.campuses[0].enabled=false;f.respond(0,disabled);await tick();
  assert.match(component.data.error,/停用/);assert.ok(component.data.campuses.some(row=>row.campusId==='wangcheng'));
  component.choose(disabled.campuses[1]);assert.equal(f.cloud.scopeKey(),'gxnu/wangcheng');
  const admin=client({unselected:true}),load=admin.cloud.ensureScope({allowDisabled:true});await tick();
  const closed={schools:[{...directory.schools[0],enabled:false}],campuses:[{...directory.campuses[0],enabled:false}]};admin.respond(0,closed);await load;
  assert.equal(admin.cloud.scopeKey(),'gxnu/yucai');
  const guest=client({unselected:true}),blocked=guest.cloud.ensureScope();const rejected=assert.rejects(blocked,/暂无开放/);await tick();guest.respond(0,closed);await rejected;
});
test('late profile configuration cannot replace the next campus location choices',async()=>{
  const f=await prepare(),profile=f.load('projects/crun/pages/my/profile_methods.js');
  const page=()=>({data:{},setData(value){Object.assign(this.data,value);}}),a=page(),b=page();
  const old=profile.loadCampuses(a);f.tenant.select(directory.campuses[1],{reload:false});const next=profile.loadCampuses(b);
  f.respond(1,{campuses:['王城校区'],locations:{phases:['新区'],pickupStations:[]}});await next;
  f.respond(0,{campuses:['育才校区'],locations:{phases:['旧区'],pickupStations:[]}});await old;
  assert.deepEqual(Array.from(f.load('projects/crun/biz/address_biz.js').PHASES),['新区']);
  assert.equal(b.data.campuses[0],'王城校区');assert.equal(a.data.campuses,undefined);
});

test('opening a subscription resolves its campus before starting order reads',async()=>{
  const f=await prepare(),page=f.mount('projects/crun/pages/mail/my_detail/mail_my_detail.js');
  page.onLoad({id:'linked-order',schoolId:'gxnu',campusId:'wangcheng'});
  const task=page.onShow();await tick();assert.equal(f.calls.length,1);assert.equal(f.calls[0].data.route,'tenant/catalog');
  f.respond(0,directory);await tick();assert.equal(f.cloud.scopeKey(),'gxnu/wangcheng');
  for(let i=1;i<f.calls.length;i++){
    assert.equal(f.calls[i].data.scope.campusId,'wangcheng');
    f.respond(i,f.calls[i].data.route==='operations/config'?{paymentMode:'offline'}:{_id:'linked-order',MAIL_STATUS:0,MAIL_OBJ:{title:'订单'}});
  }
  await task;assert.equal(page.data.mail._id,'linked-order');page.onHide();assert.equal(f.timers.size,0);
});

test('leaving a subscription page before directory resolution cannot switch the active campus',async()=>{
  const f=await prepare(),page=f.mount('projects/crun/pages/mail/my_detail/mail_my_detail.js');
  page.onLoad({id:'linked-order',schoolId:'gxnu',campusId:'wangcheng'});
  const task=page.onShow();await tick();page.onHide();f.respond(0,directory);await task;
  assert.equal(f.cloud.scopeKey(),'gxnu/yucai');assert.equal(f.calls.length,1);assert.equal(f.watchers.length,0);
});
