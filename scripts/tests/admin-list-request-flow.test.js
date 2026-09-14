'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { fixture } = require('../test-support/operations-fixture.cjs');
const { harness, root } = require('../test-support/admin-console-harness.cjs');
const { runMiniProgram } = require('../test-support/miniprogram-module.cjs');
const dataCheck = require('../../cloudfunctions/mcloud/framework/validate/data_check.js');
const routes = require('../../cloudfunctions/mcloud/project/crun/public/route.js');
const tap = value => ({ currentTarget: { dataset: { value } } });

// Exercise page requests through the real routes, controllers, validator and
// query services. The platform, administrator session and database use fixtures.
function listFixture() {
  const f = fixture(), controllers = new Map();
  let authorized = true, queries = 0;
  const database = f.store.database(), collection = database.collection;
  database.collection = name => { queries++; return collection(name); };
  class Base {
    constructor(route, userId, event) { this._request = event.params; }
    async isAdmin() { if (!authorized) throw new Error('请重新登录管理员'); }
    validateData(rules) { return dataCheck.check(this._request, rules); }
  }
  async function request(route, params = {}) {
    const [file, method] = routes[route].split('#')[0].split('@');
    if (!controllers.has(file)) controllers.set(file, runMiniProgram(path.join(root, 'cloudfunctions/mcloud/project/crun/controller', file + '.js'), {
      require(name) {
        if (name === './base_project_admin_controller.js') return Base;
        if (name.startsWith('../../service/')) return f.load(name.slice('../../service/'.length));
        if (name.endsWith('/content_check.js')) return {};
        throw new Error('Unexpected controller dependency: ' + name);
      }
    }));
    const Controller = controllers.get(file);
    return new Controller(route, 'admin', { params: JSON.parse(JSON.stringify(params)) })[method]();
  }
  return { ...f, request, page: file => harness(file, request),
    get queries() { return queries; }, deny() { authorized = false; } };
}

const lists = [
  {
    name: 'orders', table: 'mail', route: 'admin/operations_orders', page: 'orders/list/admin_order_list.js',
    field: 'MAIL_STATUS', statuses: [0, 1, 4, 2, 3, 9, 99], invalidStatus: 8,
    record(index, status) { return { MAIL_ID: 'NO-' + index, MAIL_STATUS: status, MAIL_ADD_TIME: 1000 + index,
      MAIL_END_TIME: Date.now() + 3600000, MAIL_OBJ: { title: index === 23 ? '目标[1]' : '快递代取', campus: '育才校区', price: 3 } }; }
  },
  {
    name: 'feedback', table: 'feedback', route: 'admin/feedback_list', page: 'feedback/list/admin_feedback_list.js',
    field: 'FB_STATUS', statuses: [0, 1, 2], invalidStatus: 9,
    record(index, status) { return { FB_STATUS: status, FB_ADD_TIME: 1000 + index, FB_TYPE: 'complain',
      FB_TITLE: index === 23 ? '目标[1]' : '配送投诉', FB_CONTENT: '请协助核实配送情况', FB_USER_NAME: '测试用户' }; }
  }
];

function seed(f, kind) {
  const rows = Array.from({ length: 25 }, (_, index) => ({ _id: kind.table + '-' + index, _pid: 'crun', ...kind.record(index, kind.statuses[index % kind.statuses.length]) }));
  for (const row of rows) f.table(kind.table).set(row._id, row);
  f.table(kind.table).set('foreign', { ...rows[0], _id: 'foreign', _pid: 'another-project' });
  return rows;
}

for (const kind of lists) {
  test(kind.name + ' default all tab loads, paginates, switches back from a status and resets search', async () => {
    const f = listFixture(), rows = seed(f, kind), { page } = f.page(kind.page);
    await page.onLoad();
    assert.equal(page.data.error, '');
    assert.equal(page.data.loading, false);
    assert.equal(page.data.status, -1);
    assert.equal(page.data.total, rows.length);
    assert.equal(page.data.list.length, 20);
    assert.equal(page.data.hasMore, true);
    assert.equal(page.data.list[0]._id, rows.at(-1)._id);
    await page.bindMore();
    assert.equal(page.data.page, 2);
    assert.equal(page.data.hasMore, false);
    assert.deepEqual(Array.from(page.data.list, row => row._id).sort(), rows.map(row => row._id).sort());

    await page.bindStatus(tap('0'));
    assert.equal(page.data.error, '');
    assert.equal(page.data.page, 1);
    assert.equal(page.data.total, rows.filter(row => row[kind.field] === 0).length);
    assert.ok(page.data.list.every(row => row[kind.field] === 0));
    await page.bindStatus(tap('-1'));
    assert.equal(page.data.error, '');
    assert.equal(page.data.status, -1);
    assert.equal(page.data.total, rows.length);
    assert.equal(page.data.list.length, 20);

    page.bindInput({ detail: { value: '目标[1]' } });
    await page.bindSearch();
    assert.equal(page.data.total, 1);
    assert.equal(page.data.list[0]._id, rows[23]._id);
    await page.bindReset();
    assert.equal(page.data.error, '');
    assert.equal(page.data.search, '');
    assert.equal(page.data.status, -1);
    assert.equal(page.data.total, rows.length);
  });

  test(kind.name + ' controller accepts omitted/all filters and every numeric or string status', async () => {
    const f = listFixture(), rows = seed(f, kind);
    for (const status of [undefined, null, -1, '-1', ...kind.statuses, ...kind.statuses.map(String)]) {
      const result = await f.request(kind.route, { status });
      const all = status == null || Number(status) === -1;
      const expected = rows.filter(row => all || row[kind.field] === Number(status));
      assert.equal(result.page, 1);
      assert.equal(result.total, expected.length, 'status=' + status);
      assert.deepEqual(Array.from(result.list, row => row._id), expected.slice().reverse().slice(0, 20).map(row => row._id));
    }
  });

  test(kind.name + ' rejects invalid filters and pagination without querying records', async () => {
    const f = listFixture();
    for (const status of [-2, kind.invalidStatus, 1000, 0.5, '0.5', 'all', '', '  ', true, false, [], {}]) {
      await assert.rejects(f.request(kind.route, { page: 1, status }), undefined, 'status=' + JSON.stringify(status));
    }
    for (const page of [-1, 0, 501, 1.5]) await assert.rejects(f.request(kind.route, { page, status: -1 }));
    assert.equal(f.queries, 0);
  });
}

test('all-status order and feedback queries still require an administrator session', async () => {
  const f = listFixture();
  f.deny();
  for (const kind of lists) await assert.rejects(f.request(kind.route, { page: 1, status: -1 }), /管理员/);
  assert.equal(f.queries, 0);
});
