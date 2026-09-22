'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,A,B,tenant}=require('../test-support/tenant-services.cjs');
async function setup(){
  const f=fixture();await f.setup();
  // A legacy installation has no scoped business data yet.
  for(const name of ['user','operation_config','admin'])f.table(name).clear();
  const plan={version:1,legacySchoolId:A.schoolId,aliases:{'东校区':{schoolId:A.schoolId,campusId:A.campusId}},defaults:{},overrides:{},admins:{},configTargets:[{schoolId:A.schoolId,campusId:A.campusId}]};
  const Migration=f.service('tenant_migration_service'),migration=new Migration();
  return {...f,plan,Migration,migration};
}
async function apply(f,collection,options={}){
  const args={plan:f.plan,collection,...options};const preview=await f.migration.batch(args);
  assert.deepEqual(Array.from(preview.items.filter(x=>x.status==='unresolved')),[]);
  return f.migration.batch({...args,dryRun:false,expectedHash:preview.batchHash});
}
test('migration fingerprints ignore object key ordering and reject edits after preview',async()=>{
  const f=await setup(),hash=f.service('migration_journal').hash;
  assert.equal(hash({_id:'x',nested:{b:2,a:1}}),hash({nested:{a:1,b:2},_id:'x'}));
  f.table('mail').set('m',{_id:'m',_pid:'crun',MAIL_OBJ:{campus:'东校区'},MAIL_TOTAL_FEE:150});
  const preview=await f.migration.batch({plan:f.plan,collection:'mail'});
  f.table('mail').get('m').MAIL_TOTAL_FEE=200;
  await assert.rejects(f.migration.batch({plan:f.plan,collection:'mail',dryRun:false,expectedHash:preview.batchHash}),/指纹/);
  assert.equal(f.table('tenant_migration').size,0);
});
test('ambiguous legacy rows stop their batch, and fresh scoped records are preserved',async()=>{
  const f=await setup();f.table('mail').set('unknown',{_id:'unknown',_pid:'crun'});
  const preview=await f.migration.batch({plan:f.plan,collection:'mail'});
  assert.equal(preview.items[0].status,'unresolved');
  await assert.rejects(f.migration.batch({plan:f.plan,collection:'mail',dryRun:false,expectedHash:preview.batchHash}),/无法确定/);
  f.table('mail').clear();await f.put(B,'order_quota','fresh',{active:['m']});
  await apply(f,'order_quota');assert.equal(f.table('order_quota').get('fresh').tenantRetired,undefined);
  assert.equal(f.table('order_quota').get('fresh').campusId,B.campusId);
});
test('shared request guards journal once and rollback restores every legacy record exactly',async()=>{
  const f=await setup(),id=f.store.key('crun','poster','request_123456789');
  const mail={_id:id,_pid:'crun',MAIL_OBJ:{campus:'东校区'},MAIL_TOTAL_FEE:150,MAIL_STATUS:9};
  const request={_id:id,_pid:'crun',orderId:id,action:'publish'};
  f.table('mail').set(id,structuredClone(mail));f.table('order_request').set(id,structuredClone(request));
  await apply(f,'mail');await apply(f,'order_request');
  assert.equal(f.table('request_scope').size,1);
  assert.equal([...f.table('tenant_migration').values()].filter(x=>x.collection==='request_scope'&&x.kind==='record').length,1);
  assert.equal(f.table('mail').get(id).MAIL_SCHEMA_VERSION,1);
  await apply(f,'mail'); // Safe replay.
  let after='';for(;;){const result=await f.migration.rollback({plan:f.plan,after,size:1});after=result.nextAfter;if(!result.hasMore)break;}
  assert.deepEqual(f.table('mail').get(id),mail);assert.deepEqual(f.table('order_request').get(id),request);
  assert.equal(f.table('request_scope').size,0);
});
test('rollback refuses to overwrite a post-migration business change',async()=>{
  const f=await setup();f.plan.defaults.news={schoolId:A.schoolId,campusId:A.campusId};
  f.table('news').set('n',{_id:'n',_pid:'crun',NEWS_TITLE:'旧公告'});await apply(f,'news');
  f.table('news').get('n').NEWS_TITLE='已被编辑';
  await assert.rejects(f.migration.rollback({plan:f.plan}),/业务写入/);
  assert.equal(f.table('news').get('n').NEWS_TITLE,'已被编辑');
});
test('phone uniqueness conflicts are detected before the conflicting row is changed',async()=>{
  const f=await setup();
  for(const id of ['u1','u2'])f.table('user').set(id,{_id:id,_pid:'crun',USER_MINI_OPENID:id,USER_MOBILE:'13800000000'});
  await apply(f,'user',{size:1});
  const preview=await f.migration.batch({plan:f.plan,collection:'user',after:'u1',size:1});
  assert.equal(preview.items[0].status,'unresolved');assert.match(preview.items[0].reason,/唯一键/);
  assert.equal(f.table('user').get('u2').schoolId,undefined);
});

test('duplicate phone locks in the same batch reject apply without a partial migration',async()=>{
  const f=await setup();
  for(const id of ['u1','u2'])f.table('user').set(id,{_id:id,_pid:'crun',USER_MINI_OPENID:id,USER_MOBILE:'13800000000'});
  const preview=await f.migration.batch({plan:f.plan,collection:'user'});
  assert.equal(preview.items.filter(row=>row.status==='unresolved').length,1);
  await assert.rejects(f.migration.batch({plan:f.plan,collection:'user',dryRun:false,expectedHash:preview.batchHash}),/无法确定/);
  assert.ok([...f.table('user').values()].every(row=>row.schoolId===undefined));
  assert.equal(f.table('identity_unique').size,0);assert.equal(f.table('tenant_migration').size,0);
});
test('verification requires complete scans, and finalization rebuilds an early empty news manifest',async()=>{
  const f=await setup();
  f.table('admin').set('old-admin',{_id:'old-admin',_pid:'crun',ADMIN_STATUS:1,ADMIN_TYPE:1});f.plan.admins['old-admin']={platform:true};
  f.plan.defaults.news={schoolId:A.schoolId,campusId:A.campusId};
  f.table('news').set('n',{_id:'n',_pid:'crun',NEWS_TITLE:'历史公告',NEWS_STATUS:1,NEWS_CONTENT:[{type:'text',val:'正文'}]});
  await tenant.run(A,()=>new (f.service('news_catalog_service'))().ensure());
  await assert.rejects(f.migration.finalize({plan:f.plan,scope:A}),/尚未迁移/);
  for(const collection of f.Migration.COLLECTIONS){await apply(f,collection);const verified=await f.migration.verify({plan:f.plan,collection});assert.equal(verified.issues.length,0,JSON.stringify(verified));}
  const result=await f.migration.finalize({plan:f.plan,scope:A});assert.equal(result.activeNews,1);
  const current=await tenant.run(A,()=>new (f.service('news_catalog_service'))().ensure());assert.equal(current.entries[0]._id,'n');
  const recordsBefore=structuredClone([...f.table('tenant_migration').values()]);
  const repeated=await f.migration.finalize({plan:f.plan,scope:A});assert.equal(repeated.activeNews,1);
  assert.deepEqual([...f.table('tenant_migration').values()],recordsBefore);
  assert.deepEqual(await tenant.run(A,()=>new (f.service('news_catalog_service'))().ensure()),current);
});
