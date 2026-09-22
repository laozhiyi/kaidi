'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, A, B, tenant } = require('../test-support/tenant-services.cjs');
const request = name => 'request_' + name.padEnd(16, '_');

async function setup() {
  const f = fixture();
  // The tenant memory adapter projects fields but does not execute aggregates.
  // Supply the SDK sum/group operation; keep the actual services and scoped DB.
  f.raw.db.command.aggregate.sum = value => ({ $sum: value });
  const collection = f.raw.db.collection.bind(f.raw.db);
  f.raw.db.collection = (...args) => {
    const query = collection(...args), aggregate = query.aggregate.bind(query);
    query.aggregate = () => {
      const cursor = aggregate(), rawEnd = cursor.end.bind(cursor);
      let group, limit = Infinity;
      cursor.group = value => { group = value; return cursor; };
      cursor.limit = value => { limit = value; return cursor; };
      cursor.end = async () => {
        const result = await rawEnd();
        if (!group) return result;
        const grouped = new Map();
        for (const row of result.list) {
          const id = row[group._id.slice(1)], next = grouped.get(id) || { _id: id };
          for (const [key, expression] of Object.entries(group)) {
            if (key !== '_id') next[key] = (next[key] || 0) + expression.$sum;
          }
          grouped.set(id, next);
        }
        return { list: [...grouped.values()].slice(0, limit) };
      };
      return cursor;
    };
    return query;
  };
  await f.setup();
  f.mail = new (f.service('mail_service'))();
  f.fav = new (f.service('fav_service'))();
  f.publish = async name => (await f.mail.insertMail('poster', { forms: f.forms(A), requestId: request(name) }))._id;
  f.remove = id => f.mail.deleteOrder('platform', id, { requestId: request('delete-' + id) });
  return f;
}

test('new collectors cannot save an administrator-deleted order', async () => {
  const f = await setup();
  await tenant.run(A, async () => {
    const id = await f.publish('deleted');
    await f.remove(id);
    assert.equal(await f.mail.viewMail('rider', id), null);
    await assert.rejects(f.fav.updateFav('rider', id, 'mail', true), /不存在|下架|不可接单/);
    assert.equal(f.table('fav').size, 0);
  });
});

test('saved administrator-deleted orders are marked missing and can still be removed', async () => {
  const f = await setup();
  await tenant.run(A, async () => {
    const id = await f.publish('saved');
    await f.fav.updateFav('rider', id, 'mail', true);
    await f.fav.updateFav('rider2', id, 'mail', true);
    await f.remove(id);
    const saved = (await f.fav.getMyFavList('rider')).list[0];
    assert.equal(saved.FAV_MISSING, true);
    assert.equal(saved.FAV_ORDER_AVAILABLE, false);
    assert.equal(saved.FAV_ORDER_STATUS, '');
    assert.equal(saved.FAV_PATH, '');
    assert.equal(saved.FAV_COUNT, 0);
    assert.equal((await f.fav.isFav('rider', id, 'mail')).isFav, 1);
    const removed = await f.fav.updateFav('rider', id, 'mail', false);
    assert.equal(removed.isFav, 0);
    assert.equal(removed.exists, false);
    assert.equal(removed.available, false);
    assert.equal((await f.fav.delFav('rider2', id)).effect, 1);
    assert.equal(f.table('fav').size, 0);
    assert.equal(f.table('mail').get(id).MAIL_ADMIN_DELETED, true);
  });
});

test('projected favorite statistics hide deleted targets while retaining live orders and campus isolation', async () => {
  const f = await setup();
  const foreignId = await tenant.run(B, async () => (await f.mail.insertMail('poster', {
    forms: f.forms(B), requestId: request('foreign')
  }))._id);
  await tenant.run(A, async () => {
    const deletedId = await f.publish('stats-deleted'), liveId = await f.publish('stats-live');
    await f.fav.updateFav('rider', deletedId, 'mail', true);
    await f.fav.updateFav('rider', liveId, 'mail', true);
    await f.remove(deletedId);
    const ids = [deletedId, liveId, foreignId, 'missing-order'];
    const stats = (await f.fav.orderStats('rider', ids)).list;
    const actual = stats.map(({ count, isFav, available, exists }) => ({ count, isFav, available, exists }));
    assert.deepEqual(JSON.parse(JSON.stringify(actual)), [
      { count: 0, isFav: true, available: false, exists: false },
      { count: 1, isFav: true, available: true, exists: true },
      { count: 0, isFav: false, available: false, exists: false },
      { count: 0, isFav: false, available: false, exists: false }
    ]);
    const preloaded = [f.table('mail').get(deletedId), f.table('mail').get(liveId)];
    const reused = (await f.fav.orderStats('rider', [deletedId, liveId], preloaded)).list;
    assert.equal(reused[0].exists, false);
    assert.equal(reused[0].count, 0);
    assert.equal(reused[1].available, true);
  });
});
