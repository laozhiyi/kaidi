'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { fixture } = require('./operations-fixture.cjs');
const { concurrentTransactions } = require('./concurrent-transactions.cjs');
const root = path.resolve(__dirname, '../..');
const dataCheck = require('../../cloudfunctions/mcloud/framework/validate/data_check.js');
const clientFactory = vm.runInNewContext('(function(require, wx, module) {\n' + fs.readFileSync(path.join(root, 'miniprogram/projects/crun/biz/operations_biz.js'), 'utf8') + '\n})', { setTimeout, clearTimeout });

function controller(f, metrics) {
 class Base {
  constructor(params, userId) { this.params = params; this._userId = userId; }
  validateData(schema) { return dataCheck.check(structuredClone(this.params), schema); }
  AppError(message) { const error = new Error(message); error.name = 'AppError'; throw error; }
 }
 const module = { exports: {} };
 vm.runInNewContext(fs.readFileSync(path.join(root, 'cloudfunctions/mcloud/project/crun/controller/mail_controller.js'), 'utf8'), {
  module, require(name) {
   if (name.endsWith('base_project_controller.js')) return Base;
   if (name.endsWith('mail_service.js')) return f.load('mail_service.js');
   if (name.endsWith('operation_store.js')) return f.store;
   if (name.endsWith('order_rules.js')) return f.load('order_rules.js');
   if (name.endsWith('time_util.js')) return { timestamp2Time: String };
   // External moderation/storage I/O is simulated. No Tencent endpoint is called.
   if (name.endsWith('content_check.js')) return {
    async checkTextMultiClient() { metrics.textAudits++; },
    async checkCloudImage(id) { metrics.imageAudits++; return id.replace('/private/', '/private-evidence/'); }
   };
   throw Error('Unexpected controller dependency ' + name);
  }
 });
 return module.exports;
}

function client(userId, invoke, metrics) {
 const storage = new Map(), module = { exports: {} };
 clientFactory(name => {
  if (name.endsWith('/cloud_helper.js')) return { callCloudSumbit: invoke };
  if (name.endsWith('/passport_biz.js')) return { getUserId: () => userId };
  if (name.endsWith('/admin_biz.js')) return { getAdminToken: () => null };
  if (name.endsWith('/md5_lib.js')) return { md5: value => crypto.createHash('md5').update(value).digest('hex') };
  throw Error('Unexpected client dependency ' + name);
 }, {
  getStorageSync: key => structuredClone(storage.get(key)),
  setStorageSync: (key, value) => storage.set(key, structuredClone(value)),
  removeStorageSync: key => storage.delete(key)
 }, module);
 return { send: params => module.exports.command('mail/insert', params, { onRetry: () => metrics.clientRetries++ }), storage };
}

async function runPublishPressure({ users, perUser = 1, images = 0, lostReplyEvery = 0, failedWriteEvery = 0, commitDelayMs = 10 }) {
 const f = fixture();
 const transactions = concurrentTransactions(f, { productionRetries: true, commitDelayMs });
 const metrics = { cloudAttempts: 0, clientRetries: 0, lostReplies: 0, failedWrites: 0, textAudits: 0, imageAudits: 0 };
 const Controller = controller(f, metrics), entries = [], orderToEntry = new Map();
 for (let user = 0; user < users; user++) {
  const userId = 'pressure-user-' + user; f.user(userId);
  for (let order = 0; order < perUser; order++) {
   const sequence = entries.length + 1, tag = 'P' + sequence;
   const values = { title: '并发订单' + tag, code: tag, address2: '测试宿舍' + tag, poster: '测试用户' + user,
    img: Array.from({ length: images }, (_, i) => 'cloud://test/private/' + userId + '/' + tag + '-' + i + '.png') };
   const forms = f.forms().map(item => Object.hasOwn(values, item.mark) ? { ...item, val: values[item.mark] } : item);
   entries.push({ userId, sequence, tag, params: { forms, cateId: '1' }, attempts: 0 });
  }
 }
 const originalSet = f.store.set;
 f.store.set = async (tx, name, id, row) => {
  const entry = name === 'notification' && orderToEntry.get(row.orderId);
  if (entry && failedWriteEvery && entry.sequence % failedWriteEvery === 0 && !entry.writeFailed) {
   entry.writeFailed = true; metrics.failedWrites++;
   throw Object.assign(new Error('injected failure before transaction commit'), { retryable: true });
  }
  return originalSet(tx, name, id, row);
 };
 let release;
 const start = new Promise(resolve => { release = resolve; });
 const jobs = entries.map(entry => (async () => {
  // A separate client instance represents a separate device/session. In the
  // perUser > 1 case, several clients deliberately share one business identity.
  const app = client(entry.userId, async (route, params) => {
   assert.equal(route, 'mail/insert');
   metrics.cloudAttempts++; entry.attempts++;
   if (!entry.requestId) {
    entry.requestId = params.requestId;
    entry.expectedId = f.store.key('crun', entry.userId, params.requestId);
    orderToEntry.set(entry.expectedId, entry);
   }
   assert.equal(params.requestId, entry.requestId, 'retry changed the request id');
   let result;
   try { result = await new Controller(params, entry.userId).insertMail(); }
   catch (error) {
    throw Object.assign(new Error(error.message), { code: error.name === 'AppError' ? 1600 : 500, retryable: error.retryable === true });
   }
   if (lostReplyEvery && entry.sequence % lostReplyEvery === 0 && !entry.replyLost) {
    entry.replyLost = true; metrics.lostReplies++;
    throw Object.assign(new Error('injected response loss after commit'), { retryable: true });
   }
   return { code: 200, data: result };
  }, metrics);
  entry.storage = app.storage;
  await start;
  return app.send(entry.params);
 })());
 release();
 const outcomes = await Promise.allSettled(jobs);
 const accepted = outcomes.filter(row => row.status === 'fulfilled').length;
 const errors = outcomes.filter(row => row.status === 'rejected').map(row => String(row.reason.message)).slice(0, 5);
 let missing = 0, wrongOwner = 0, wrongContent = 0, incomplete = 0;
 const expectedIds = new Set();
 entries.forEach((entry, index) => {
  if (outcomes[index].status !== 'fulfilled') return;
  expectedIds.add(entry.expectedId);
  const row = f.table('mail').get(entry.expectedId);
  if (!row) { missing++; return; }
  if (row.MAIL_USER_ID !== entry.userId || outcomes[index].value._id !== entry.expectedId) wrongOwner++;
  if (row.MAIL_OBJ.title !== '并发订单' + entry.tag || row.MAIL_OBJ.code !== entry.tag || row.MAIL_OBJ.address2 !== '测试宿舍' + entry.tag || row.MAIL_OBJ.imgUrls.length !== images) wrongContent++;
  const eventId = f.store.key(entry.expectedId, 1), event = f.table('order_event').get(eventId);
  const request = f.table('order_request').get(entry.expectedId), quota = f.table('order_quota').get(f.store.key('crun', entry.userId, 'poster'));
  const notification = f.table('notification').get(f.store.key(eventId, entry.userId));
  if (row.MAIL_VERSION !== 1 || row.MAIL_STATUS !== 0 || row.MAIL_HISTORY.length !== 1 || !event || event.action !== 'publish'
   || !request || request.orderId !== entry.expectedId || !quota || !quota.active.includes(entry.expectedId) || !notification || entry.storage.size) incomplete++;
 });
 const storedIds = new Set(f.table('mail').keys());
 const unexpected = [...storedIds].filter(id => !expectedIds.has(id)).length;
 let quotaErrors = 0;
 for (const row of f.table('order_quota').values()) {
  const ids = [...f.table('mail').values()].filter(order => order.MAIL_USER_ID === row.userId).map(order => order._id).sort();
  if (JSON.stringify([...row.active].sort()) !== JSON.stringify(ids) || new Set(row.active).size !== row.active.length) quotaErrors++;
 }
 const visibleIds = [];
 let cursor, page = 1;
 do {
  const result = await f.service.getMailList('other', { sortType: 'wait', size: 50, page, ...(cursor ? { cursor } : {}) });
  visibleIds.push(...result.list.map(row => row._id));
  if (!result.hasMore) break;
  cursor = result.nextCursor; page++;
  if (page > 100) throw Error('unexpected list pagination loop');
 } while (true);
 const report = {
  users, clients: entries.length, perUser, imagesPerOrder: images, syntheticCommitDelayMs: commitDelayMs,
  accepted, rejected: outcomes.length - accepted, stored: storedIds.size,
  succeededWithoutClientRetry: outcomes.filter((row, i) => row.status === 'fulfilled' && entries[i].attempts === 1).length,
  ...metrics, transactionConflicts: transactions.conflicts, peakTransactions: transactions.maxActive,
  integrity: { missing, unexpected, wrongOwner, wrongContent, incomplete, quotaErrors,
   events: f.table('order_event').size, requests: f.table('order_request').size, notifications: f.table('notification').size,
   visible: visibleIds.length, uniqueVisible: new Set(visibleIds).size,
   visibleMismatch: [...storedIds].filter(id => !visibleIds.includes(id)).length }, errors
 };
 return report;
}

function verifyReport(report) {
 assert.equal(report.rejected, 0, JSON.stringify(report));
 assert.equal(report.accepted, report.clients);
 assert.equal(report.stored, report.clients);
 assert.ok(report.peakTransactions > 1, 'transactions must actually overlap');
 for (const key of ['missing', 'unexpected', 'wrongOwner', 'wrongContent', 'incomplete', 'quotaErrors', 'visibleMismatch']) assert.equal(report.integrity[key], 0, key);
 for (const key of ['events', 'requests', 'notifications', 'visible', 'uniqueVisible']) assert.equal(report.integrity[key], report.clients, key);
}
module.exports = { runPublishPressure, verifyReport };
