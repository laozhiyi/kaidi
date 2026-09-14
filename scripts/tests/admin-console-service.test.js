'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { fixture } = require('../test-support/operations-fixture.cjs');

test('admin order queries combine filters, escape search expressions, paginate stably and keep private fields out of lists', async () => {
  const f = fixture(), Service = f.load('operations_service.js'), svc = new Service();
  for (let i = 0; i < 25; i++) f.table('mail').set('order-' + i, { _id: 'order-' + i, _pid: 'crun', MAIL_ID: 'NO-' + i, MAIL_STATUS: 4, MAIL_ADD_TIME: 1000, MAIL_DUE_TIME: 1, MAIL_OBJ: { title: '代取[1]', campus: '育才校区', price: i, code: 'private', tel: '13800000000' } });
  f.table('mail').set('literal', { _id: 'literal', _pid: 'crun', MAIL_STATUS: 4, MAIL_DUE_TIME: 1, MAIL_OBJ: { title: '代取1', campus: '育才校区' } });
  f.table('mail').set('foreign', { ...f.table('mail').get('order-0'), _id: 'foreign', _pid: 'other-project' });
  const filters = { search: '[1]', campus: '育才校区', sort: 'price_high', overdue: true };
  const first = await svc.orders(1, 4, filters), second = await svc.orders(2, 4, filters);
  assert.equal(first.total, 25); assert.equal(first.list.length, 20); assert.equal(second.list.length, 5); assert.equal(second.hasMore, false);
  assert.equal(first.list[0].MAIL_OBJ.price, 24); assert.equal(first.list[0].MAIL_OBJ.code, undefined);
  assert.equal(new Set([...first.list, ...second.list].map(row => row._id)).size, 25);
  assert.equal((await svc.orders(1, 3, filters)).total, 0);
  await assert.rejects(svc.orders(1, 4, { sort: 'constructor' }), /排序/);
});

test('feedback status and literal search filters apply together and user lists remain owner scoped', async () => {
  const f = fixture(), Service = f.load('feedback_service.js'), svc = new Service();
  for (const [id, status, owner, pid] of [['one', 0, 'poster', 'crun'], ['two', 1, 'poster', 'crun'], ['three', 0, 'other', 'crun'], ['foreign', 0, 'poster', 'elsewhere']]) f.table('feedback').set(id, { _id: id, _pid: pid, FB_USER_ID: owner, FB_STATUS: status, FB_TITLE: '问题[1]', FB_ADD_TIME: 123 });
  const results = await svc.getAdminFeedbackList({ page: 1, status: 0, search: '[1]' });
  assert.equal(results.total, 2); assert.ok(results.list.every(row => row.FB_STATUS === 0));
  const own = await svc.getMyFeedbackList('poster', { page: 1 }); assert.equal(own.total, 2); assert.ok(own.list.every(row => row.FB_USER_ID === 'poster'));
  await assert.rejects(svc.getAdminFeedbackList({ page: 1, status: 9 }), /状态/);
});

test('dashboard counts include cancellations, split pickup status, and count today using the Shanghai day boundary', async () => {
  const f = fixture(), svc = new (f.load('operations_service.js'))();
  const now = Date.now(), today = Math.floor((now + 8 * 3600000) / 86400000) * 86400000 - 8 * 3600000;
  for (const [id, status, at] of [['waiting', 0, today], ['picked', 4, today], ['done', 9, today], ['cancelled', 99, today - 1], ['exception', 3, today]]) f.table('mail').set(id, { _id: id, _pid: 'crun', MAIL_STATUS: status, MAIL_ADD_TIME: at, MAIL_OVER_TIME: at, MAIL_DUE_TIME: 1 });
  f.table('mail').set('foreign', { _id: 'foreign', _pid: 'other', MAIL_STATUS: 0, MAIL_ADD_TIME: today });
  const data = await svc.overview(); assert.equal(data.total, 5); assert.equal(data.cancelled, 1); assert.equal(data.picked, 1); assert.equal(data.delivering, 1); assert.equal(data.todayOrders, 4); assert.equal(data.todayCompleted, 1); assert.equal(data.overdue, 2);
});

test('section saves merge inside the transaction so concurrent pages cannot overwrite unrelated configuration', async () => {
  const f = fixture(), svc = new (f.load('operation_config_service.js'))();
  await Promise.all([svc.saveConfig({ smallPrice: 6.25 }, 'admin', 'pricing'), svc.saveConfig({ maxActiveOrders: 7 }, 'admin', 'rules'), svc.saveConfig({ enabled: false }, 'admin', 'service')]);
  const config = await svc.getConfig(); assert.equal(config.smallPrice, 6.25); assert.equal(config.maxActiveOrders, 7); assert.equal(config.enabled, false);
  await assert.rejects(svc.saveConfig({ enabled: true }, 'admin', 'pricing'), /其他分组/);
  assert.equal((await svc.getConfig()).enabled, false);
});

test('admin details include both contacts and picked-up orders can enter and resume exception processing', async () => {
  const f = fixture(), id = await f.publish(), svc = new (f.load('operations_service.js'))();
  await f.service.acceptMail('rider', id, { requestId: f.req('accept') });
  await f.service.pickupMail('rider', id, { requestId: f.req('pickup') });
  await f.service.holdMail('admin', id, { requestId: f.req('hold'), note: '核实取件问题' });
  assert.equal(f.table('mail').get(id).MAIL_STATUS, 3);
  await f.service.resolveMail('admin', id, { requestId: f.req('resume'), note: '问题已核实', resolution: 'resume' });
  assert.equal(f.table('mail').get(id).MAIL_STATUS, 4);
  const detail = await svc.orderDetail(id); assert.equal(detail.poster.id, 'poster'); assert.equal(detail.rider.id, 'rider'); assert.ok(detail.MAIL_OBJ.code);
  f.table('mail').get(id)._pid = 'other'; assert.equal(await svc.orderDetail(id), null);
});

function reportHarness(rows = []) {
  const queries = [], exports = [];
  class Base { getProjectId() { return 'crun'; } AppError(message) { throw new Error(message); } }
  const model = { count: async where => { queries.push(where); return rows.length; }, getList: async (where, fields, order, page, size) => ({ list: rows.slice((page - 1) * size, page * size) }) };
  const module = { exports: {} }, root = path.resolve(__dirname, '../../cloudfunctions/mcloud');
  vm.runInNewContext(fs.readFileSync(path.join(root, 'project/crun/service/admin/admin_report_service.js'), 'utf8'), { module, Date, require(request) {
    if (request.includes('base_project_service')) return Base;
    if (request.includes('_model')) return model;
    if (request.includes('export_util')) return { exportDataExcel: async (key, title, total, data) => { exports.push({ key, title, total, data }); return { total, url: 'https://example.invalid/report.xlsx' }; } };
    if (request.includes('order_rules')) return require(path.join(root, 'project/crun/service/order_rules.js'));
    if (request === 'crypto') return crypto;
    throw new Error(request);
  } });
  return { service: new module.exports(), queries, exports };
}

test('reports enforce the inclusive date window, protect spreadsheet cells and isolate export keys by admin', async () => {
  const h = reportHarness([{ _id: 'o', MAIL_STATUS: 4, MAIL_OBJ: { title: '=HYPERLINK("bad")', campus: '育才', num: 1, price: 3 }, MAIL_ADD_TIME: 1000 }]);
  await h.service.mail({ start: '2026-09-01', end: '2026-09-02', status: 4 }, 'admin-a');
  assert.equal(h.queries[0]._pid, 'crun'); assert.equal(h.queries[0].MAIL_STATUS, 4);
  assert.equal(h.queries[0].MAIL_ADD_TIME[2] - h.queries[0].MAIL_ADD_TIME[1], 2 * 86400000 - 1);
  assert.match(h.exports[0].data[1][3], /^'/); assert.equal(h.exports[0].total, 1);
  assert.notEqual(h.service.key('mail', 'admin-a'), h.service.key('mail', 'admin-b'));
  await assert.rejects(h.service.mail({ start: '2026-02-30', end: '2026-03-01', status: 999 }, 'admin-a'), /日期/);
  await assert.rejects(h.service.mail({ start: '2026-09-03', end: '2026-09-01', status: 999 }, 'admin-a'), /日期/);
});

test('exports fail explicitly above the row limit and user export filters cannot choose a different project', async () => {
  const large = reportHarness(Array(5001).fill({})); await assert.rejects(large.service.users('', 'admin'), /5000/); assert.equal(large.exports.length, 0);
  const h = reportHarness([]);
  await h.service.users(encodeURIComponent(JSON.stringify({ and: { _pid: 'other', USER_STATUS: 0 }, or: [{ USER_NAME: ['like', '陈'] }] })), 'admin');
  assert.equal(h.queries[0].and._pid, 'crun'); assert.equal(h.queries[0].and.USER_STATUS, 0);
  await assert.rejects(h.service.users(encodeURIComponent(JSON.stringify({ or: [{ _pid: ['like', 'other'] }] })), 'admin'), /筛选/);
});

test('reports include records beyond the database single-read cap and include exactly 5000 records', async () => {
  for (const size of [1001, 5000]) {
    const h = reportHarness(Array.from({ length: size }, (_, index) => ({ USER_NAME: '用户' + index, USER_STATUS: 1 })));
    await h.service.users('', 'admin');
    assert.equal(h.exports[0].total, size);
    assert.equal(h.exports[0].data.length, size + 1);
    assert.equal(h.exports[0].data.at(-1)[0], '用户' + (size - 1));
  }
});

test('user status changes resolve mini-program user ids instead of confusing them with document ids', async () => {
  const edited = [], row = { _id: 'document-id', USER_MINI_OPENID: 'openid', USER_STATUS: 0 };
  class Base { AppError(message) { throw new Error(message); } }
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../cloudfunctions/mcloud/project/crun/service/admin/admin_user_service.js'), 'utf8'), { module, require(request) {
    if (request.includes('base_project_admin_service')) return Base;
    if (request.includes('user_model')) return { getOne: async where => where.USER_MINI_OPENID === row.USER_MINI_OPENID ? row : null, edit: async (where, data) => edited.push({ where, data }) };
    return {};
  } });
  const svc = new module.exports(); await svc.statusUser('openid', 1, '已核实');
  assert.equal(edited[0].where._id, 'document-id'); assert.equal(edited[0].data.USER_STATUS, 1);
  await assert.rejects(svc.statusUser('openid', 8, ''), /原因/);
});
