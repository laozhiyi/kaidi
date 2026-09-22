'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const test=require('node:test'),assert=require('node:assert/strict');
function entry(file,{openid='',env={}}={}){
  const module={exports:{}},calls=[];
  class Base{async initSetup(){calls.push('setup');}}
  class Service{async runScheduled(...args){calls.push(args);return args;}async batch(args){calls.push(args);return args;}}
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../../cloudfunctions/mcloud/'+file),'utf8'),{module,exports:module.exports,global:{},process:{env},require(name){
    if(name.endsWith('cloud_base.js'))return {getCloud:()=>({getWXContext:()=>({OPENID:openid})})};
    if(name.endsWith('base_project_service.js'))return Base;
    if(name.endsWith('maintenance_service.js')||name.endsWith('tenant_migration_service.js'))return Service;
    throw Error('Unexpected entry dependency '+name);
  }});return {main:module.exports.main,calls};
}
test('order and notification workers reject forged client timers before initialization',async()=>{
  for(const [file,trigger] of [['order_worker.js','orders-minute'],['notification_worker.js','notifications-minute']]){
    const user=entry(file,{openid:'student'});await assert.rejects(user.main({Type:'Timer',TriggerName:trigger}),/TIMER_ONLY/);assert.equal(user.calls.length,0);
    const service=entry(file);await assert.rejects(service.main({route:'run'}),/TIMER_ONLY/);await assert.rejects(service.main({Type:'Timer',TriggerName:'wrong'}),/TIMER_ONLY/);
    await service.main({Type:'Timer',TriggerName:trigger});assert.equal(service.calls[0],'setup');assert.equal(service.calls[1][0],file==='order_worker.js'?'orders':'notifications');
  }
});
test('migration requires explicit enablement and target environment; plan never applies a caller dryRun flag',async()=>{
  for(const options of [{},{env:{TENANT_MIGRATION_ENABLED:'true'}},{openid:'user',env:{TENANT_MIGRATION_ENABLED:'true',CLOUD_ENV_ID:'test-only'}}]){
    const f=entry('migration_worker.js',options);await assert.rejects(f.main({action:'apply'}),/DISABLED/);assert.equal(f.calls.length,0);
  }
  const f=entry('migration_worker.js',{env:{TENANT_MIGRATION_ENABLED:'true',CLOUD_ENV_ID:'test-only'}});
  const result=await f.main({action:'plan',dryRun:false});assert.equal(result.dryRun,true);
});
