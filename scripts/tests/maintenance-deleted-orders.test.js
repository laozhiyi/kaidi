'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, A, tenant } = require('../test-support/tenant-services.cjs');
const request = name => 'request_' + name.padEnd(16, '_');

async function setup() {
  const f = fixture();
  await f.setup();
  f.mail = new (f.service('mail_service'))();
  f.maintenance = new (f.service('maintenance_service'))();
  return f;
}

async function dueOrder(f, label, action) {
  const id = (await f.mail.insertMail('poster', { forms: f.forms(A), requestId: request(label) }))._id;
  if (action === 'overdue') await f.mail.acceptMail('rider', id, { requestId: request('accept-' + label) });
  f.table('mail').get(id)[action === 'expire' ? 'MAIL_END_TIME' : 'MAIL_DUE_TIME'] = Date.now() - 10000;
  return id;
}

const runners = {
  scheduled: f => f.maintenance.runScheduled('orders', { maxBatches: 1, batchSize: 50 }),
  manual: f => f.maintenance.run()
};

for (const [mode, run] of Object.entries(runners)) {
  test(mode + ' maintenance excludes deleted candidates while processing live due orders', async () => {
    const f = await setup();
    await tenant.run(A, async () => {
      const removed = [], live = [];
      for (const action of ['expire', 'overdue']) {
        const deletedId = await dueOrder(f, mode + '-deleted-' + action, action);
        await f.mail.deleteOrder('platform', deletedId, { requestId: request('delete-' + action) });
        removed.push({ id: deletedId, version: f.table('mail').get(deletedId).MAIL_VERSION, action });
        live.push({ id: await dueOrder(f, mode + '-live-' + action, action), action });
      }
      const previous = new Set(f.table('notification').keys());
      const result = await run(f);
      if (mode === 'scheduled') assert.equal(result.scanned, 2);
      else { assert.equal(result.expired, 1); assert.equal(result.overdue, 1); }
      const added = [...f.table('notification').values()].filter(row => !previous.has(row._id));
      assert.equal(added.length, 3);
      assert.ok(added.every(row => live.some(order => order.id === row.orderId && order.action === row.action)));
      for (const { id, version, action } of removed) {
        const row = f.table('mail').get(id);
        assert.equal(row.MAIL_VERSION, version);
        assert.equal(row.MAIL_STATUS, action === 'expire' ? 0 : 1);
        assert.notEqual(row.MAIL_OVERDUE_NOTIFIED, true);
      }
      assert.equal(f.table('mail').get(live[0].id).MAIL_STATUS, 99);
      assert.equal(f.table('mail').get(live[1].id).MAIL_OVERDUE_NOTIFIED, true);
      assert.ok([...previous].every(id => f.table('notification').has(id)), 'Existing notification history is retained');
    });
  });

  for (const action of ['expire', 'overdue']) {
    test(mode + ' ' + action + ' rechecks deletion after selecting a due order', async () => {
      const f = await setup();
      await tenant.run(A, async () => {
        const id = await dueOrder(f, mode + '-race-' + action, action);
        const previous = new Set(f.table('notification').keys());
        const transaction = f.store.transaction;
        let removed = false, deletedVersion;
        f.store.transaction = async work => {
          // The first maintenance transaction starts after its candidate query.
          // Commit a real administrator deletion before that transaction reads.
          if (!removed) {
            removed = true;
            await f.mail.deleteOrder('platform', id, { requestId: request('racing-delete') });
            deletedVersion = f.table('mail').get(id).MAIL_VERSION;
          }
          return transaction(work);
        };
        await run(f);
        assert.equal(removed, true);
        const row = f.table('mail').get(id);
        assert.equal(row.MAIL_ADMIN_DELETED, true);
        assert.equal(row.MAIL_VERSION, deletedVersion);
        assert.equal(row.MAIL_STATUS, action === 'expire' ? 0 : 1);
        assert.notEqual(row.MAIL_OVERDUE_NOTIFIED, true);
        const added = [...f.table('notification').values()].filter(item => !previous.has(item._id));
        assert.ok(added.length > 0, 'The administrator deletion notification remains recorded');
        assert.ok(added.every(item => item.action === 'admin_delete'));
        assert.ok([...previous].every(key => f.table('notification').has(key)));
      });
    });
  }
}
