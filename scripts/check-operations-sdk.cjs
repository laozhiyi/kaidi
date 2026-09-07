'use strict';
// Compatibility check against the installed SDK. Transport is replaced: NO cloud requests.
const assert=require('node:assert/strict');
const cloud=require('../cloudfunctions/mcloud/node_modules/wx-server-sdk');
const store=require('../cloudfunctions/mcloud/project/crun/service/operation_store.js');
(async()=>{
 const db=store.database();
 assert.equal(db.config.throwOnNotFound,false);
 // Normal (non-transactional) config reads use the same SDK missing-doc option.
 const doc=db.collection(store.collection('operation_config')).doc('sdk-config-check');
 doc._document.get=async()=>({data:[]});
 assert.equal((await doc.get()).data,null);
 doc._document.get=async()=>({data:[{_id:'sdk-config-check',value:{enabled:false}}]});
 assert.equal((await doc.get()).data.value.enabled,false);
 doc._document.get=async()=>{throw Object.assign(new Error('synthetic-permission-failure'),{code:'PERMISSION_DENIED'});};
 await assert.rejects(doc.get());
 let row=null,saved=null,error=null;
 const rawDoc={async get(){if(error)throw error;return {data:row};},async set(data){saved=data;return {updated:1};}};
 db._db.runTransaction=async callback=>callback({collection:()=>({doc:()=>rawDoc})});
 await db.runTransaction(async tx=>{
  assert.equal(await store.get(tx,'mail','sdk-check'),null);
  row={_id:'sdk-check',MAIL_STATUS:0};
  assert.equal((await store.get(tx,'mail','sdk-check')).MAIL_STATUS,0);
  await store.set(tx,'mail','sdk-check',row);
  assert.equal(saved._id,undefined);assert.equal(saved.MAIL_STATUS,0);
  error=Object.assign(new Error('synthetic-network-failure'),{code:'NETWORK_ERROR'});
  await assert.rejects(store.get(tx,'mail','sdk-check'));
 });
 assert.equal(typeof cloud.getTempFileURL,'function');
 assert.equal(typeof cloud.openapi.security.msgSecCheck,'function');
 assert.equal(typeof cloud.openapi.subscribeMessage.send,'function');
 assert.equal(typeof require('../cloudfunctions/mcloud/index.js').main,'function');
 console.log('Installed SDK '+require('../cloudfunctions/mcloud/node_modules/wx-server-sdk/package.json').version+': config reads, transaction wrappers, error propagation and entrypoint OK (no network calls).');
})().catch(e=>{console.error(e);process.exitCode=1;});
