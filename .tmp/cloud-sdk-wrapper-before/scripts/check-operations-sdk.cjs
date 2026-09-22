'use strict';
// Exercise installed SDK serializers. Replace transport before the first call;
// unexpected requests fail locally instead of reaching the network.
const assert = require('node:assert/strict');
const cloud = require('../cloudfunctions/mcloud/node_modules/wx-server-sdk');
const {wrap} = require('../cloudfunctions/mcloud/framework/tenancy/tenant_database.js');
const tenant = require('../cloudfunctions/mcloud/framework/tenancy/tenant_context.js');
const store = require('../cloudfunctions/mcloud/project/crun/service/operation_store.js');
cloud.init({env:'sdk-local-only'});
const raw = cloud.database({throwOnNotFound:false}), db = wrap(raw);
const transport = Object.getPrototypeOf(raw.collection('bx_mail')._query._request);
const original = transport.send, requests = [];
const scope = {schoolId:'sdk_school',campusId:'east'};
let rows = [], failure = null;
transport.send = async (action, params) => {
  requests.push({action,params});
  if (failure) throw failure;
  if (action === 'database.startTransaction') return {transactionId:'local-transaction'};
  if (['database.commitTransaction','database.abortTransaction'].includes(action)) return {};
  if (action === 'database.getDocument') return {data:{list:rows.map(row=>JSON.stringify(row))}};
  if (action === 'database.calculateDocument') return {data:{total:rows.length}};
  if (action === 'database.aggregateDocuments') return {data:{list:[]}};
  if (action === 'database.modifyDocument') return {data:{updated:1,upsert_id:'local'}};
  if (action === 'database.removeDocument') return {data:{deleted:1}};
  if (action === 'database.insertDocument') return {data:{insertedIds:['local']}};
  throw Error('Unexpected local SDK request: '+action);
};
(async()=>{
  assert.throws(()=>db.collection('bx_mail'),/学校|校区/);
  await tenant.run(scope,async()=>{
    const doc=db.collection('bx_operation_config').doc('config');
    assert.equal((await doc.get()).data,null);
    rows=[{_id:'config',_pid:'crun',...scope,value:{enabled:false}}];
    assert.equal((await doc.get()).data.value.enabled,false);
    rows=[{...rows[0],campusId:'west'}]; assert.equal((await doc.get()).data,null);
    failure=Object.assign(Error('synthetic-permission-failure'),{code:'PERMISSION_DENIED'});
    await assert.rejects(doc.get()); failure=null; rows=[];
    await db.collection('bx_mail').where(db.command.or([{MAIL_STATUS:0},{campusId:'west'}])).field({_id:true}).orderBy('_id','desc').limit(10).get();
    const query=JSON.stringify(requests.at(-1).params.query);
    for(const part of ['schoolId','sdk_school','campusId','east','_pid','crun'])assert.ok(query.includes(part),part);
    await db.collection('bx_mail').aggregate().lookup({from:'bx_user',localField:'MAIL_USER_ID',foreignField:'USER_MINI_OPENID',as:'owner'}).end();
    const stages=JSON.stringify(requests.at(-1).params.stages);
    assert.ok(stages.includes('sdk_school')&&stages.includes('scopedJoinValue'));
    await db.runTransaction(async tx=>{
      assert.equal(await store.get(tx,'mail','new'),null);
      await store.set(tx,'mail','new',{_pid:'crun',MAIL_STATUS:0});
      const saved=await store.get(tx,'mail','new');
      assert.equal(saved.schoolId,scope.schoolId); assert.equal(saved.campusId,scope.campusId);
      const write=requests.findLast(row=>row.action==='database.modifyDocument');
      assert.ok(JSON.stringify(write.params.data).includes('sdk_school'));
      assert.equal(saved.MAIL_STATUS,0);
    },0);
    rows=[{_id:'foreign',_pid:'crun',...scope,campusId:'west'}];
    await assert.rejects(db.collection('bx_mail').doc('foreign').set({data:{MAIL_STATUS:1}}),/不属于/);
  });
  assert.equal(typeof cloud.openapi.subscribeMessage.send,'function');
  assert.equal(typeof require('../cloudfunctions/mcloud/index.js').main,'function');
  console.log('Installed wx-server-sdk '+require('../cloudfunctions/mcloud/node_modules/wx-server-sdk/package.json').version+': scoped query/projection/lookup, missing/foreign documents, transaction write/cache/rollback OK; '+requests.length+' mocked requests, no network.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{transport.send=original;});
