'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const test=require('node:test'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'../../cloudfunctions/mcloud');
function entry(file,{openid='',env={},timer=null,setupError=null,scheduledError=null}={}){
  const module={exports:{}},calls=[],logs=[];
  class Base{async initSetup(){calls.push('setup');if(setupError)throw setupError;}}
  class Service{async runScheduled(...args){calls.push(['scheduled',...args]);if(scheduledError)throw scheduledError;return args;}async batch(args){calls.push(['batch',args]);return args;}}
  vm.runInNewContext(fs.readFileSync(path.join(ROOT,file),'utf8'),{module,exports:module.exports,global:{},process:{env},console:{info:(...args)=>logs.push(args),error:(...args)=>logs.push(args)},require(name){
    if(name.endsWith('cloud_base.js'))return {getCloud:()=>({getWXContext:()=>({OPENID:openid})})};
    if(name.endsWith('base_project_service.js'))return Base;
    if(name.endsWith('maintenance_service.js')||name.endsWith('tenant_migration_service.js'))return Service;
    if(name.endsWith('timer_event.js'))return require(path.join(ROOT,'timer_event.js'));
    if(name.endsWith('timer_entry.js'))return timer||{run(){throw Error('timer stub missing');}};
    if(name.endsWith('application.js'))return {app:async(event)=>{calls.push(['app',event]);return 'api-reply';}};
    throw Error('Unexpected entry dependency '+name);
  }});return {main:module.exports.main,run:module.exports.run,calls,logs};
}
test('scheduled work runs inside mcloud itself and rejects forged client timers before initialization',async()=>{
  const forged=entry('timer_entry.js',{openid:'student'});
  await assert.rejects(forged.run({Type:'Timer',TriggerName:'orders-minute'}),/TIMER_ONLY/);assert.equal(forged.calls.length,0);

  const plain=entry('timer_entry.js');
  await assert.rejects(plain.run({route:'run'}),/TIMER_ONLY/);
  await assert.rejects(plain.run({Type:'Timer',TriggerName:'wrong'}),/TIMER_ONLY/);
  assert.equal(plain.calls.length,0);

  for(const [trigger,kind] of [['orders-minute','orders'],['notifications-minute','notifications']]){
    const f=entry('timer_entry.js');
    await f.run({Type:'Timer',TriggerName:trigger});
    assert.equal(f.calls[0],'setup');assert.equal(f.calls[1][0],'scheduled');assert.equal(f.calls[1][1],kind);
    // mcloud 默认 30 秒超时，所以默认预算要低于 40 秒的独立 worker 口径。
    assert.equal(f.calls[1][2].budgetMs,20000);
  }

  const tuned=entry('timer_entry.js',{env:{WORKER_BUDGET_MS:'40000',WORKER_SHARD:'3'}});
  await tuned.run({Type:'Timer',TriggerName:'orders-minute'});
  assert.equal(tuned.calls[1][2].budgetMs,40000);assert.equal(tuned.calls[1][2].shard,3);
});
test('mcloud index forwards timer events to the maintenance entry and leaves normal api calls untouched',async()=>{
  const seen=[],timer={run:async(event,options)=>{seen.push(options);return {trigger:event.TriggerName};}};
  const f=entry('index.js',{timer});
  assert.deepEqual(await f.main({Type:'Timer',TriggerName:'orders-minute'}),{trigger:'orders-minute'});
  assert.equal(seen.length,1);assert.equal(seen[0].budgetMs,20000);
  assert.equal(await f.main({route:'mail/view',data:{}}),'api-reply');
  assert.equal(f.calls.length,1,'only the api path is handed to the router');
});
test('standalone worker entries stay available as thin wrappers for split deployments',async()=>{
  for(const [file,kind] of [['order_worker.js','orders'],['notification_worker.js','notifications']]){
    const timer={run:async(event,options)=>({event,options})},w=entry(file,{timer});
    const out=await w.main({Type:'Timer',TriggerName:'worker-'+kind+'-minute'});
    assert.equal(out.options.expectKind,kind);assert.equal(out.options.budgetMs,40000);assert.equal(out.event.Type,'Timer');
  }
});
test('migration requires explicit enablement and target environment; plan never applies a caller dryRun flag',async()=>{
  for(const options of [{},{env:{TENANT_MIGRATION_ENABLED:'true'}},{openid:'user',env:{TENANT_MIGRATION_ENABLED:'true',CLOUD_ENV_ID:'test-only'}}]){
    const f=entry('migration_worker.js',options);await assert.rejects(f.main({action:'apply'}),/DISABLED/);assert.equal(f.calls.length,0);
  }
  const f=entry('migration_worker.js',{env:{TENANT_MIGRATION_ENABLED:'true',CLOUD_ENV_ID:'test-only'}});
  const result=await f.main({action:'plan',dryRun:false});assert.equal(result.dryRun,true);
});


test('timer diagnostics distinguish successful execution, rejected clients and failed stages without logging inputs',async()=>{
  const successful=entry('timer_entry.js');
  await successful.run({Type:'Timer',TriggerName:'orders-minute',privateKey:'never-log-this'});
  assert.deepEqual(successful.logs.map(row=>row[0]),['YUNSUQU_TIMER_START','YUNSUQU_TIMER_DONE']);
  assert.equal(successful.logs[1][1].kind,'orders');
  assert(!JSON.stringify(successful.logs).includes('never-log-this'));

  const forged=entry('timer_entry.js',{openid:'private-openid'});
  await assert.rejects(forged.run({Type:'Timer',TriggerName:'orders-minute'}),/TIMER_ONLY/);
  assert.equal(forged.logs[1][0],'YUNSUQU_TIMER_FAILED');
  assert.equal(forged.logs[1][1].stage,'authorization');
  assert(!JSON.stringify(forged.logs).includes('private-openid'));
  assert.equal(forged.calls.length,0);

  for(const [option,stage] of [['setupError','initialization'],['scheduledError','maintenance']]){
    const original=Object.assign(new Error('sensitive provider description'),{code:'DATABASE_TEST_ERROR'});
    const f=entry('timer_entry.js',{[option]:original});
    await assert.rejects(f.run({Type:'Timer',TriggerName:'orders-minute'}),error=>error===original);
    assert.equal(f.logs.at(-1)[0],'YUNSUQU_TIMER_FAILED');
    assert.equal(f.logs.at(-1)[1].stage,stage);
    assert.equal(f.logs.at(-1)[1].code,'DATABASE_TEST_ERROR');
    assert(!JSON.stringify(f.logs).includes('sensitive provider description'));
    assert(!f.logs.some(row=>row[0]==='YUNSUQU_TIMER_DONE'));
  }
});


test('timer event compatibility preserves authorization and rejects malformed event types',async()=>{
  for(const event of [
    {Type:'Timer',TriggerName:'orders-minute'},
    {Type:'timer',TriggerName:'orders-minute'},
    {type:'timer',triggerName:'orders-minute'},
    {type:'Timer',TriggerName:'orders-minute'}
  ]){
    const timer=entry('timer_entry.js');
    await timer.run(event);
    assert.equal(timer.calls[1][1],'orders');
    const forged=entry('timer_entry.js',{openid:'student'});
    await assert.rejects(forged.run(event),/TIMER_ONLY/);
    assert.equal(forged.calls.length,0);
    const api=entry('index.js',{timer:{run:async normalized=>normalized.Type}});
    assert.equal(await api.main(event),'Timer');
    assert.equal(api.calls.length,0);
  }
  const normalize=require(path.join(ROOT,'timer_event.js')).normalize;
  for(const event of [null,undefined,[],{},'Timer',{Type:{toString:()=> 'Timer'}},{TriggerName:'orders-minute'},{Type:'other',type:'timer'},{Type:'request',TriggerName:'orders-minute'}])assert.equal(normalize(event),null);
  const unknown=entry('timer_entry.js');
  await assert.rejects(unknown.run({type:'timer',triggerName:'unknown'}),/TIMER_ONLY/);
  assert.equal(unknown.calls.length,0);
});

test('unrouted entry diagnostics identify deployed code without exposing payload values',async()=>{
  const f=entry('index.js');
  assert.equal(await f.main({type:'sensitive-type',TriggerName:'sensitive-name',privateKey:'sensitive-key'}),'api-reply');
  assert.equal(f.logs[0][0],'YUNSUQU_ENTRY_UNROUTED_V2');
  assert.equal(f.logs[0][1].hasLowerType,true);
  assert.equal(f.logs[0][1].hasUpperTrigger,true);
  assert(!JSON.stringify(f.logs).includes('sensitive-'));
});
