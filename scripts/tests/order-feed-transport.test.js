'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {client,tick}=require('../test-support/reliability-client.cjs');
test('feed transport reads only the scoped endpoint, polls with jitter, and closes cleanly',async()=>{
  const f=client(),feed=f.load('projects/crun/biz/order_feed_biz.js'),changes=[],errors=[];
  const handle=feed.watch({scope:f.cloud.scopeSnapshot(),onChange:value=>changes.push(value),onError:e=>errors.push(e)});
  await tick();assert.equal(f.calls[0].data.route,'operations/feed');assert.equal(f.calls[0].data.scope.campusId,'yucai');assert.equal(f.watchers.length,0);
  f.respond(0,{docs:[{_id:'opaque',revision:'v1'}]});await tick();assert.equal(changes.length,1);
  const timer=[...f.timers.values()][0];assert.ok(timer.delay>=10000&&timer.delay<12000);
  await f.advance(12000);assert.equal(f.calls.length,2);
  handle.close();f.respond(1,{docs:[{_id:'opaque',revision:'late'}]});await tick();
  assert.equal(changes.length,1);assert.equal(f.timers.size,0);assert.equal(errors.length,0);
});
test('failed or oversized feed replies stop polling and report one failure',async()=>{
  for(const mode of ['network','oversized']){
    const f=client(),errors=[],handle=f.load('projects/crun/biz/order_feed_biz.js').watch({scope:f.cloud.scopeSnapshot(),onChange(){throw Error('unexpected change');},onError:error=>errors.push(error)});
    await tick();if(mode==='network')f.fail(0);else f.respond(0,{docs:Array.from({length:65},()=>({_id:'x'}))});await tick();
    assert.equal(errors.length,1);assert.equal(f.timers.size,0);handle.close();
  }
});
