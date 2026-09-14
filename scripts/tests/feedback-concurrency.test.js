'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { fixture } = require('../test-support/operations-fixture.cjs');
const { concurrentTransactions } = require('../test-support/concurrent-transactions.cjs');
const check = require('../../cloudfunctions/mcloud/framework/validate/data_check.js');

function feedbackController(f, audit = {}) {
  const Service = f.load('feedback_service.js');
  const stats = { texts: 0, images: 0, activeImages: 0, maxImages: 0 };
  class Base { validateData(rules) { return check.check(structuredClone(this.input), rules); } }
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../cloudfunctions/mcloud/project/crun/controller/feedback_controller.js'), 'utf8'), {
    module, require(name) {
      if (name === './base_project_controller.js') return Base;
      if (name.endsWith('/feedback_service.js')) return Service;
      if (name.endsWith('/operation_store.js')) return f.store;
      if (name.endsWith('/order_rules.js')) return f.load('order_rules.js');
      if (name.endsWith('/time_util.js')) return { timestamp2Time: String };
      if (name.endsWith('/content_check.js')) return {
        async checkTextMultiClient() { stats.texts++; if (audit.text) await audit.text(); },
        async checkCloudImage(id) {
          stats.images++; stats.activeImages++; stats.maxImages = Math.max(stats.maxImages, stats.activeImages);
          try { await new Promise(resolve => setImmediate(resolve)); return audit.image ? await audit.image(id) : id.replace('/private/', '/private-evidence/'); }
          finally { stats.activeImages--; }
        }
      };
      throw Error('Unexpected dependency ' + name);
    }
  });
  return { stats, submit(userId, input) { const controller = new module.exports(); controller._userId = userId; controller.input = input; return controller.insertFeedback(); } };
}

const input = (f, request = 'feedback') => ({ type: 'complain', title: '配送申诉', content: '请协助核实本次配送情况', requestId: f.req(request), img: [] });

test('100 different users submit concurrently into the administrator inbox without a shared write lock', async () => {
  const f = fixture(), metrics = concurrentTransactions(f), controller = feedbackController(f);
  const users = Array.from({ length: 100 }, (_, i) => 'user-' + i);
  users.forEach(id => f.user(id));
  const results = await Promise.all(users.map(id => controller.submit(id, input(f, id))));
  assert.equal(new Set(results.map(result => result.id)).size, 100);
  assert.equal(f.table('feedback').size, 100);
  assert.ok(metrics.maxActive > 1, 'The test must overlap transaction callbacks');
  assert.equal(metrics.conflicts, 0, 'Independent users must not contend on a global quota document');
  const service = new (f.load('feedback_service.js'))();
  const inbox = await service.getAdminFeedbackList({ status: 0, page: 1 });
  assert.equal(inbox.total, 100); assert.equal(inbox.list.length, 20); assert.equal(inbox.hasMore, true);
  const seen = new Set();
  for (let page = 1; page <= 5; page++) for (const row of (await service.getAdminFeedbackList({ status: 0, page })).list) seen.add(row._id);
  assert.equal(seen.size, 100);
  for (const id of users) {
    const list = await service.getMyFeedbackList(id, { page: 1 });
    assert.equal(list.list.length, 1); assert.equal(list.list[0].FB_USER_ID, id);
  }
});

test('concurrent duplicate requests create one record and consume one submission quota', async () => {
  const f = fixture(), metrics = concurrentTransactions(f), service = new (f.load('feedback_service.js'))(), params = input(f);
  const results = await Promise.all(Array.from({ length: 30 }, () => service.insertFeedback('poster', params)));
  assert.equal(new Set(results.map(row => row.id)).size, 1);
  assert.equal(f.table('feedback').size, 1);
  assert.equal([...f.table('operation_limit').values()].reduce((sum, row) => sum + row.count, 0), 1);
  assert.ok(metrics.conflicts > 0, 'The test must exercise transaction retries');
});

test('lost-response retries reuse archived evidence without repeating audits or consuming quota', async () => {
  const f = fixture(); concurrentTransactions(f);
  const controller = feedbackController(f), params = { ...input(f), img: ['cloud://env/private/poster/a.jpg'] };
  const original = await controller.submit('poster', params);
  const limits = JSON.stringify([...f.table('operation_limit')]);
  const auditCounts = { ...controller.stats };
  for (let i = 0; i < 15; i++) assert.equal((await controller.submit('poster', params)).id, original.id);
  assert.equal(JSON.stringify([...f.table('operation_limit')]), limits);
  assert.deepEqual(controller.stats, auditCounts);
  assert.equal(f.table('feedback').get(original.id).FB_IMG[0], 'cloud://env/private-evidence/poster/a.jpg');
  await assert.rejects(controller.submit('poster', { ...params, content: '更换后的内容' }), /相同请求标识/);
  await assert.rejects(controller.submit('poster', { ...params, img: ['cloud://env/private/poster/b.jpg'] }), /相同请求标识/);
  assert.equal(f.table('feedback').size, 1);
});

test('an interrupted database write rolls back the submission quota and can be retried safely', async () => {
  const f = fixture(); concurrentTransactions(f);
  const service = new (f.load('feedback_service.js'))(), originalSet = f.store.set;
  let fail = true;
  f.store.set = async (tx, name, ...args) => { if (fail && name === 'feedback') throw Error('temporary database failure'); return originalSet(tx, name, ...args); };
  await assert.rejects(service.insertFeedback('poster', input(f)), /temporary database/);
  assert.equal(f.table('feedback').size, 0); assert.equal(f.table('operation_limit').size, 0);
  fail = false;
  await service.insertFeedback('poster', input(f));
  assert.equal(f.table('feedback').size, 1);
  assert.equal([...f.table('operation_limit').values()][0].count, 1);
});

test('new submissions remain rate limited per user while saved requests always remain retryable', async () => {
  const f = fixture(); concurrentTransactions(f);
  const service = new (f.load('feedback_service.js'))();
  for (let i = 0; i < 5; i++) await service.insertFeedback('poster', input(f, String(i)));
  await assert.rejects(service.insertFeedback('poster', input(f, 'sixth')), /频繁/);
  await service.insertFeedback('poster', input(f, '0'));
  await service.insertFeedback('other', input(f, 'sixth'));
  assert.equal(f.table('feedback').size, 6);
});

test('image audits have bounded concurrency and a failed image never creates a partial appeal', async () => {
  const f = fixture(); concurrentTransactions(f);
  let fail = true;
  const controller = feedbackController(f, { image: async id => { if (fail && id.includes('3.jpg')) throw Error('image audit unavailable'); return id.replace('/private/', '/private-evidence/'); } });
  const params = { ...input(f), img: Array.from({ length: 6 }, (_, i) => 'cloud://env/private/poster/' + i + '.jpg') };
  await assert.rejects(controller.submit('poster', params), /image audit/);
  assert.equal(f.table('feedback').size, 0); assert.ok(controller.stats.maxImages <= 2);
  fail = false;
  const result = await controller.submit('poster', params);
  assert.deepEqual(Array.from(f.table('feedback').get(result.id).FB_IMG), params.img.map(id => id.replace('/private/', '/private-evidence/')));
});

test('concurrent administrator replies cannot overwrite each other and the user receives the committed result once', async () => {
  const f = fixture(); concurrentTransactions(f);
  f.table('admin').set('admin2', { _id: 'admin2', _pid: 'crun', ADMIN_STATUS: 1, ADMIN_TYPE: 1 });
  const service = new (f.load('feedback_service.js'))(), { id } = await service.insertFeedback('poster', input(f));
  const replies = await Promise.allSettled([
    service.replyFeedback(id, '已联系双方并处理', 'admin', 0, f.req('reply1')),
    service.replyFeedback(id, '已核实配送情况', 'admin2', 0, f.req('reply2'))
  ]);
  assert.equal(replies.filter(result => result.status === 'fulfilled').length, 1);
  assert.match(replies.find(result => result.status === 'rejected').reason.message, /其他管理员更新/);
  const detail = await service.getMyFeedbackDetail('poster', id);
  assert.equal(detail.FB_STATUS, 1); assert.equal(detail.FB_VERSION, 1); assert.equal(detail.FB_HISTORY.length, 1);
  assert.equal((await service.getAdminFeedbackList({ status: 1, page: 1 })).list[0].FB_REPLY, detail.FB_REPLY);
  assert.equal([...f.table('notification').values()].filter(row => row.feedbackId === id && row.userId === 'poster').length, 1);
  await assert.rejects(service.getMyFeedbackDetail('other', id), /不存在/);
});
