'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { fixture } = require('../test-support/operations-fixture.cjs');
const { concurrentTransactions } = require('../test-support/concurrent-transactions.cjs');

test('100 overlapping riders can claim an order only once, with one quota and atomic history/notifications', async () => {
  const f = fixture(), metrics = concurrentTransactions(f), id = await f.publish();
  const riders = Array.from({ length: 100 }, (_, i) => 'rider-' + i);
  riders.forEach(id => f.user(id));
  const results = await Promise.allSettled(riders.map(user => f.service.acceptMail(user, id, { requestId: f.req(user) })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.ok(metrics.maxActive > 1); assert.ok(metrics.conflicts > 0);
  const order = f.table('mail').get(id);
  assert.equal(order.MAIL_STATUS, 1); assert.equal(order.MAIL_VERSION, 2);
  const quotas = [...f.table('order_quota').values()].filter(row => row.role === 'rider');
  assert.equal(quotas.length, 1); assert.equal(quotas[0].userId, order.MAIL_ACCEPT_USER_ID);
  assert.deepEqual(Array.from(quotas[0].active), [id]);
  assert.equal(f.table('order_event').size, 2); assert.equal(f.table('order_request').size, 2);
  assert.equal(f.table('notification').size, 3);
  assert.equal([...f.table('order_feed').values()][0].revision, f.store.key(id, 2));
});

test('100 duplicate publishes all recover the same result and consume one business rate-limit slot', async () => {
  const f = fixture(), metrics = concurrentTransactions(f);
  const ids = await Promise.all(Array.from({ length: 100 }, () => f.publish()));
  assert.equal(new Set(ids).size, 1); assert.ok(metrics.maxActive > 1);
  assert.equal(f.table('mail').size, 1); assert.equal(f.table('order_event').size, 1);
  assert.equal(f.table('order_request').size, 1); assert.equal(f.table('notification').size, 1);
  assert.equal([...f.table('operation_limit').values()][0].count, 1);
});

test('concurrent claims on different orders enforce the rider limit without dropping existing reservations', async () => {
  const f = fixture(), metrics = concurrentTransactions(f), ids = [];
  for (let i = 0; i < 12; i++) {
    const poster = 'poster-' + i; f.user(poster);
    ids.push(await f.publish({ requestId: f.req(String(i)) }, poster));
  }
  const results = await Promise.allSettled(ids.map((id, i) => f.service.acceptMail('rider', id, { requestId: f.req('take-' + i) })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, f.config.maxActiveOrders);
  const claimed = [...f.table('mail').values()].filter(row => row.MAIL_ACCEPT_USER_ID === 'rider').map(row => row._id).sort();
  const quota = f.table('order_quota').get(f.store.key('crun', 'rider', 'rider'));
  assert.deepEqual(Array.from(quota.active).sort(), claimed); assert.ok(metrics.conflicts > 0);
});

test('a write failure rolls back the order, quota, idempotency record and public refresh signal together', async () => {
  const f = fixture(); concurrentTransactions(f);
  const set = f.store.set;
  f.store.set = async (tx, name, id, row) => {
    if (name === 'notification') throw new Error('simulated database outage');
    return set(tx, name, id, row);
  };
  await assert.rejects(f.publish(), /outage/);
  for (const name of ['mail', 'order_quota', 'order_request', 'order_event', 'order_feed', 'notification', 'operation_limit']) assert.equal(f.table(name).size, 0, name);
  f.store.set = set;
  const id = await f.publish(); assert.equal(f.table('mail').get(id).MAIL_VERSION, 1);
});

test('accept versus cancel remains exclusive, while an edit can never overwrite a successful claim', async () => {
  for (let run = 0; run < 12; run++) {
    const f = fixture(); concurrentTransactions(f); const id = await f.publish();
    const results = await Promise.allSettled([
      f.service.acceptMail('rider', id, { requestId: f.req('take') }),
      f.service.cancelMail('poster', id, { requestId: f.req('cancel') })
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    const order = f.table('mail').get(id);
    if (order.MAIL_STATUS === 1) {
      await assert.rejects(f.service.editMail('poster', { id, forms: f.forms(), requestId: f.req('edit') }), /尚未被接取/);
      assert.equal(f.table('mail').get(id).MAIL_ACCEPT_USER_ID, 'rider');
    } else assert.equal(order.MAIL_STATUS, 99);
  }
});

test('orders already accepted remain visible after the acceptance deadline passes', async () => {
  const f = fixture(), id = await f.publish();
  await f.service.acceptMail('rider', id, { requestId: f.req('take') });
  f.table('mail').get(id).MAIL_END_TIME = Date.now() - 86400000;
  for (const [userId, sortType] of [['rider', 'my_accept'], ['poster', 'my_post']]) {
    const result = await f.service.getMailList(userId, { sortType });
    assert.equal(result.list.length, 1); assert.equal(result.list[0]._id, id);
  }
  assert.equal((await f.service.getMailList('other', { sortType: 'wait' })).list.length, 0);
});

test('a legacy quota seed is revalidated after another transaction closes an order', async () => {
  const f = fixture(), id = await f.publish();
  f.table('order_quota').clear(); f.config.maxOpenOrders = 1;
  const seed = await f.service._seed('poster', 'poster');
  await f.service.cancelMail('poster', id, { requestId: f.req('cancel') });
  await f.store.transaction(tx => f.service._quota(tx, 'poster', 'poster', 'new-order', true, 1, seed));
  assert.deepEqual(Array.from(f.table('order_quota').get(f.store.key('crun', 'poster', 'poster')).active), ['new-order']);
});

test('cursor pagination survives removed first-page rows, new publications and timestamp ties', async () => {
  const f = fixture(), original = await f.publish(), row = f.table('mail').get(original);
  f.table('mail').clear();
  for (let i = 1; i <= 12; i++) {
    const id = 'order-' + String(i).padStart(3, '0');
    f.table('mail').set(id, { ...structuredClone(row), _id: id, MAIL_ADD_TIME: 1000 });
  }
  const first = await f.service.getMailList('other', { sortType: 'wait', size: 3 });
  assert.deepEqual(Array.from(first.list, row => row._id), ['order-012', 'order-011', 'order-010']);
  f.table('mail').get('order-012').MAIL_STATUS = 1;
  f.table('mail').set('new-order', { ...structuredClone(row), _id: 'new-order', MAIL_ADD_TIME: 2000 });
  const ids = first.list.map(row => row._id);
  let response = first, page = 1;
  while (response.hasMore) {
    response = await f.service.getMailList('other', { sortType: 'wait', size: 3, page: ++page, cursor: response.nextCursor });
    ids.push(...response.list.map(row => row._id));
  }
  assert.equal(ids.length, 12); assert.equal(new Set(ids).size, 12);
  assert.ok(ids.includes('order-009')); assert.ok(!ids.includes('new-order'));
  assert.equal((await f.service.getMailList('other', { sortType: 'wait', size: 3 })).list[0]._id, 'new-order');
  await assert.rejects(f.service.getMailList('other', { cursor: { ...first.nextCursor, field: 'MAIL_USER_ID' } }), /分页/);
});

test('refresh signals contain no order identifiers, identities, addresses or pickup codes', async () => {
  const f = fixture(); await f.publish();
  for (const row of f.table('order_feed').values()) {
    assert.deepEqual(Object.keys(row).sort(), ['_id', '_pid', 'revision', 'shard', 'updatedAt']);
    assert.ok(row.shard >= 0 && row.shard < 64);
    for (const secret of ['poster', '123-456', '13800000000', '宿舍101']) assert.ok(!JSON.stringify(row).includes(secret));
  }
});

test('SDK transactions retry only definite conflicts, with rollback-aware SDK retries disabled', async () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../cloudfunctions/mcloud/project/crun/service/operation_store.js'), 'utf8');
  const waits = [], retries = []; let calls = 0, failure;
  const module = { exports: {} };
  const db = { async runTransaction(callback, retryCount) {
    retries.push(retryCount); calls++;
    if (failure) throw failure;
    if (calls < 3) throw { code: 'DATABASE_TRANSACTION_CONFLICT' };
    return callback({});
  } };
  vm.runInNewContext(source, { module, setTimeout(fn, ms) { waits.push(ms); fn(); }, require(name) {
    if (name.endsWith('cloud_base.js')) return { getCloud: () => ({ database: () => db }) };
    if (name.endsWith('config.js')) return { COLLECTION_PRFIX: 'bx_' };
    if (name.endsWith('app_error.js')) return Error;
    if (name.endsWith('tenant_context.js')) return require('../../cloudfunctions/mcloud/framework/tenancy/tenant_context.js');
    if (name === './account_service.js') return require('../../cloudfunctions/mcloud/project/crun/service/account_service.js');
    return require(name);
  } });
  assert.equal(await module.exports.transaction(() => 42), 42); assert.equal(calls, 3);
  assert.deepEqual(retries, [0, 0, 0]); assert.equal(waits.length, 2);
  failure = new Error('network timeout after commit');
  await assert.rejects(module.exports.transaction(() => 99), /after commit/); assert.equal(calls, 4);
  failure = { code: 'DATABASE_TRANSACTION_CONFLICT' };
  await assert.rejects(module.exports.transaction(() => 99), error => error.retryable === true);
  assert.equal(calls, 9);
});

test('chat messages and administrator replies keep one record when their responses are lost or requests race', async () => {
  const f = fixture(), metrics = concurrentTransactions(f), Chat = f.load('campus_service_service.js'), service = new Chat();
  f.table('campus_service').set('service', { _id: 'service', _pid: 'crun', CS_STATUS: 1 });
  const responses = await Promise.all(Array.from({ length: 50 }, () => service.sendCampusMessage('guest', 'service', '请问如何取件', f.req('message'))));
  assert.equal(new Set(responses.map(result => result.id)).size, 1); assert.equal(f.table('campus_service_message').size, 1);
  const session = responses[0].sessionId;
  await Promise.all(Array.from({ length: 30 }, () => service.replyCampusMessage(session, '请提供订单编号', f.req('reply'), 'admin')));
  assert.equal(f.table('campus_service_message').size, 2); assert.ok(metrics.maxActive > 1);
  await assert.rejects(service.sendCampusMessage('guest', 'service', '不同的内容', f.req('message')), /不同消息/);
  f.table('admin').get('admin').ADMIN_STATUS = 0;
  await assert.rejects(service.replyCampusMessage(session, '已停用', f.req('revoked'), 'admin'), /权限/);
  assert.equal(f.table('campus_service_message').size, 2);
});

test('favorite refresh uses a bounded number of database queries as the displayed order count grows', async () => {
  const f = fixture(), id = await f.publish(), row = f.table('mail').get(id), ids = [];
  for (let i = 0; i < 50; i++) { const id = 'order-' + i; ids.push(id); f.table('mail').set(id, { ...structuredClone(row), _id: id }); }
  const db = f.store.database(), collection = db.collection, queries = [];
  db.collection = name => { queries.push(name); return collection(name); };
  const stats = await new (f.load('fav_service.js'))().orderStats('rider', ids);
  assert.equal(stats.list.length, 50); assert.equal(queries.length, 3);
});

test('maintenance isolates a failing item, repairs legacy history and reminds orders already picked up', async () => {
  const f=fixture(), bad=await f.publish(), good=await f.publish({requestId:f.req('good')}), picked=await f.publish({requestId:f.req('picked')});
  await f.service.acceptMail('rider',picked,{requestId:f.req('take')});
  await f.service.pickupMail('rider',picked,{requestId:f.req('pickup')});
  f.table('mail').get(bad).MAIL_END_TIME=1;f.table('mail').get(good).MAIL_END_TIME=1;
  f.table('mail').get(good).MAIL_HISTORY={legacy:true};f.table('mail').get(picked).MAIL_DUE_TIME=1;
  const set=f.store.set;
  f.store.set=async(tx,name,id,row)=>{if(name==='mail'&&id===bad)throw Error('one damaged record');return set(tx,name,id,row);};
  const result=await new (f.load('maintenance_service.js'))().run();
  assert.equal(result.failed,1);assert.equal(f.table('mail').get(bad).MAIL_STATUS,0);
  assert.equal(f.table('mail').get(good).MAIL_STATUS,99);
  assert.equal(f.table('mail').get(good).MAIL_HISTORY.at(-1).action,'expire');
  assert.equal(f.table('mail').get(picked).MAIL_OVERDUE_NOTIFIED,true);
  assert.equal(f.table('mail').get(picked).MAIL_STATUS,4);
});
