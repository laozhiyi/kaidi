'use strict';
// 导出文件：下载链接 1 天、文件保留 2 天、失败重试与定时维护节流。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fixture } = require('../test-support/operations-fixture.cjs');

const DAY = 86400000;
const fileID = name => 'cloud://purge-env.bucket/crun/private-export/EXPORT_USER_0123456789abcdef0123456789ab_' + name + '.xlsx';

test('export files are deleted after two days and kept before that', async () => {
  const f = fixture(), cleanup = f.load('export_cleanup.js');
  const old = fileID('old'), fresh = fileID('fresh');
  await cleanup.record(old, 'admin', Date.now() - 2 * DAY - 60000);
  await cleanup.record(fresh, 'admin', Date.now() - DAY);
  const result = await cleanup.sweep({ batchSize: 50 });
  assert.equal(result.deleted, 1);
  assert.deepEqual(f.deletedFiles, [old]);
  const rows = [...f.table('export_file').values()];
  assert.equal(rows.find(row => row.fileID === old).deleted, true);
  assert.ok(rows.find(row => row.fileID === old).deletedAt > 0);
  assert.equal(rows.find(row => row.fileID === fresh).deleted, false);
  // 已删除的记录不会重复处理。
  assert.equal((await cleanup.sweep({ batchSize: 50 })).scanned, 0);
});

test('failed deletions retry and stop at the attempt limit with a log', async () => {
  const f = fixture(), cleanup = f.load('export_cleanup.js');
  const broken = fileID('broken');
  await cleanup.record(broken, 'admin', Date.now() - 3 * DAY);
  f.failDeleteFile(broken);
  const logs = [], original = console.error;
  console.error = (...args) => logs.push(args);
  try {
    let result = await cleanup.sweep({ batchSize: 50 });
    assert.equal(result.failed, 1);
    let row = [...f.table('export_file').values()].find(item => item.fileID === broken);
    assert.equal(row.deleted, false);
    assert.equal(row.attempts, 1);

    await cleanup.sweep({ batchSize: 50 });
    await cleanup.sweep({ batchSize: 50 });
    row = [...f.table('export_file').values()].find(item => item.fileID === broken);
    assert.equal(row.attempts, 3);
    assert.equal(row.stopped, true);
    assert.equal(row.deleted, false);

    // 到上限后不再自动重试。
    assert.equal((await cleanup.sweep({ batchSize: 50 })).scanned, 0);
  } finally { console.error = original; }
  assert.ok(logs.length >= 1, '到上限要记一条错误日志');
  const payload = logs.at(-1)[1];
  assert.ok(payload.id, '日志包含记录 id');
  assert.ok(payload.code, '日志包含错误码');
  assert.equal(JSON.stringify(payload).includes('private-export'), false, '日志不输出文件名');
});

test('orders maintenance cleans exports at most once an hour', async () => {
  const f = fixture(), worker = new (f.load('maintenance_service.js'))();
  const first = fileID('first');
  await f.load('export_cleanup.js').record(first, 'admin', Date.now() - 3 * DAY);
  let result = await worker.runScheduled('orders', { batchSize: 10, maxBatches: 1 });
  assert.equal(result.exportCleanup.ran, true);
  assert.equal(result.exportCleanup.deleted, 1);

  const second = fileID('second');
  await f.load('export_cleanup.js').record(second, 'admin', Date.now() - 3 * DAY);
  result = await worker.runScheduled('orders', { batchSize: 10, maxBatches: 1 });
  assert.equal(result.exportCleanup.ran, false);
  assert.equal(result.exportCleanup.reason, 'interval');
  assert.equal([...f.table('export_file').values()].find(row => row.fileID === second).deleted, false);

  // 间隔过去后恢复执行。
  f.table('worker_state').get(f.store.key('scheduled', 'orders', 'all')).exportCleanupAt = Date.now() - 3600001;
  result = await worker.runScheduled('orders', { batchSize: 10, maxBatches: 1 });
  assert.equal(result.exportCleanup.ran, true);
  assert.equal(result.exportCleanup.deleted, 1);
});

test('the export prompt states the link and file retention windows', () => {
  const biz = fs.readFileSync(path.resolve(__dirname, '../../miniprogram/projects/crun/biz/admin_export_biz.js'), 'utf8');
  assert.ok(biz.includes('下载链接 1 天内有效，文件保留 2 天'));
  for (const page of ['user/export/admin_user_export.wxml', 'mail/export/admin_mail_export.wxml']) {
    const wxml = fs.readFileSync(path.resolve(__dirname, '../../miniprogram/projects/crun/pages/admin', page), 'utf8');
    assert.ok(wxml.includes('下载链接 1 天内有效，文件保留 2 天'), page);
  }
});

test('a missing export_file collection cannot break the maintenance run or the worker state', async () => {
  const f = fixture(), worker = new (f.load('maintenance_service.js'))();
  const db = f.store.database(), collection = db.collection;
  // 模拟集合还没建出来：查询直接抛错。
  db.collection = name => { if (name === 'bx_export_file') throw new Error('collection not exists'); return collection(name); };
  const logs = [], original = console.error;
  console.error = (...args) => logs.push(args);
  let result;
  try {
    result = await worker.runScheduled('orders', { batchSize: 5, maxBatches: 1 });
  } finally {
    console.error = original;
    db.collection = collection;
  }
  assert.ok(result, '维护必须正常返回');
  assert.equal(result.exportCleanup.reason, 'error');
  assert.equal(result.exportCleanup.ran, false);
  assert.equal(result.mediaPurge.ran, true, '凭证清理不受影响');
  const state = f.table('worker_state').get(f.store.key('scheduled', 'orders', 'all'));
  assert.ok(state, 'worker_state 必须写入');
  assert.ok(state.mediaPurgeAt > 0, '凭证清理的间隔记录正常保存');
  assert.equal(state.exportCleanupAt, 0, '失败时不更新导出清理的间隔记录');
  const entry = logs.find(args => /export_cleanup/.test(String(args[0])));
  assert.ok(entry, '失败时记一条阶段日志');
  assert.equal(entry[1].code, 'CLEANUP_FAILED');
  assert.equal(JSON.stringify(entry[1]).includes('xlsx'), false, '日志不输出文件名');
});

test('media purge and export cleanup failures stay independent', async () => {
  const f = fixture(), worker = new (f.load('maintenance_service.js'))();
  const purge = f.load('order_media_purge.js'), cleanup = f.load('export_cleanup.js');
  const realPurge = purge.sweep, realCleanup = cleanup.sweep;
  const logs = [], original = console.error;
  console.error = (...args) => logs.push(args);
  try {
    purge.sweep = async () => { throw Object.assign(new Error('purge down'), { code: 'PURGE_DOWN' }); };
    let result = await worker.runScheduled('orders', { batchSize: 5, maxBatches: 1 });
    assert.equal(result.mediaPurge.reason, 'error');
    assert.equal(result.mediaPurge.ran, false);
    assert.equal(result.exportCleanup.ran, true, '导出清理照常执行');
    let state = f.table('worker_state').get(f.store.key('scheduled', 'orders', 'all'));
    assert.equal(state.mediaPurgeAt, 0);
    assert.ok(state.exportCleanupAt > 0);
    assert.ok(logs.some(args => /media_purge/.test(String(args[0])) && args[1] && args[1].code === 'PURGE_DOWN'));

    // 反向：导出清理失败时，凭证清理照常执行。
    purge.sweep = realPurge;
    cleanup.sweep = async () => { throw Object.assign(new Error('export down'), { code: 'EXPORT_DOWN' }); };
    const previous = f.table('worker_state').get(f.store.key('scheduled', 'orders', 'all'));
    previous.mediaPurgeAt = 0;
    previous.exportCleanupAt = 0;
    result = await worker.runScheduled('orders', { batchSize: 5, maxBatches: 1 });
    assert.equal(result.mediaPurge.ran, true, '凭证清理照常执行');
    assert.equal(result.exportCleanup.reason, 'error');
    state = f.table('worker_state').get(f.store.key('scheduled', 'orders', 'all'));
    assert.ok(state.mediaPurgeAt > 0);
    assert.equal(state.exportCleanupAt, 0, '失败时不更新导出清理的间隔记录');
    assert.ok(logs.some(args => /export_cleanup/.test(String(args[0])) && args[1] && args[1].code === 'EXPORT_DOWN'));
  } finally {
    console.error = original;
    purge.sweep = realPurge;
    cleanup.sweep = realCleanup;
  }
});
