'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { harness, mini } = require('../test-support/admin-console-harness.cjs');
const { fixture } = require('../test-support/operations-fixture.cjs');
const event = dataset => ({ currentTarget: { dataset } });
const input = (key, value) => ({ currentTarget: { dataset: { key } }, detail: { value } });
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const config = { enabled: true, campuses: ['育才校区', '雁山校区'], smallPrice: 1.5, mediumPrice: 3, largePrice: 5, maxPackages: 20, maxActiveOrders: 3, maxOpenOrders: 10, deliveryMinutes: 120, urgentMinutes: 60, openHour: 8, closeHour: 22, urgentEnabled: false, registrationReview: false, offlineNotice: '线下结算' };
const order = (id, status = 0) => ({ _id: id, MAIL_ID: id, MAIL_STATUS: status, MAIL_OBJ: { title: '快递代取', campus: '育才校区', price: 3 }, MAIL_HISTORY: [] });
const list = (rows, page = 1, total = rows.length) => ({ list: rows, page, size: 20, total, hasMore: page * 20 < total });
const orderPage = 'orders/list/admin_order_list.js';
const detailPage = 'orders/detail/admin_order_detail.js';
const pricePage = 'settings/pricing/admin_pricing_settings.js';

test('every console destination is a registered independent page and primary navigation replaces only its current page', () => {
  const app = JSON.parse(fs.readFileSync(path.join(mini, 'app.json'), 'utf8'));
  const h = harness('projects/crun/cmpts/admin_nav/admin_nav.js');
  for (const url of Object.values(h.UI.ROUTES)) assert.ok(app.pages.includes(url.slice(1)), url);
  h.page.data.active = 'home'; h.page.bindNavigate(event({ key: 'orders' }));
  assert.equal(h.navigation[0].method, 'redirectTo'); assert.equal(h.navigation[0].url, h.UI.ROUTES.orders);
  h.page.bindNavigate(event({ key: 'home' })); assert.equal(h.navigation.length, 1);
});

test('legacy bookmarks redirect to independent pages, including ids and unknown tab names', async () => {
  for (const [tab, key] of [['overview', 'home'], ['orders', 'orders'], ['feedback', 'feedback'], ['config', 'settings'], ['unknown', 'home'], ['constructor', 'home']]) {
    const h = harness('operations/admin_operations.js'); await h.page.onLoad({ tab });
    assert.equal(h.navigation[0].url, h.UI.ROUTES[key]); assert.equal(h.calls.length, 0);
  }
  const h = harness('operations/admin_operations.js'); await h.page.onLoad({ tab: 'orders', id: 'one?x' });
  assert.equal(h.navigation[0].url, h.UI.ROUTES.order + '?id=one%3Fx');
});

test('dashboard loading is independent of optional service configuration and includes actionable destinations', async () => {
  const pending = deferred();
  const h = harness('index/home/admin_home.js', route => route.endsWith('config') ? pending.promise : { total: 12, completed: 4, waiting: 8 });
  const loading = h.page.onLoad(); await tick();
  assert.equal(h.page.data.loading, false); assert.equal(h.page.data.overview.total, 12);
  h.page.bindNavigate(event({ key: 'orders', status: 3 })); assert.match(h.navigation[0].url, /admin_order_list\?status=3$/);
  pending.resolve(config); await loading;
});

test('orders combine independent search, status, campus, overdue and sort filters with real pagination', async () => {
  const h = harness(orderPage, (route, p) => route.endsWith('config') ? config : list([order('p' + p.page)], p.page, 22));
  await h.page.onLoad({ status: '4', overdue: 'true' }); await h.page.onShow();
  assert.equal(h.calls.filter(call => call.route.endsWith('config')).length, 1);
  await h.page.bindCampus({ detail: { value: '2' } }); await h.page.bindSort({ detail: { value: '2' } });
  h.page.bindInput({ detail: { value: '  测试单  ' } }); await h.page.bindSearch(); await h.page.bindMore(); await h.page.bindMore();
  const params = h.calls.at(-1).params;
  assert.equal(params.page, 2); assert.equal(params.status, 4); assert.equal(params.search, '测试单'); assert.equal(params.campus, '雁山校区'); assert.equal(params.sort, 'price_high'); assert.equal(params.overdue, true);
  assert.equal(h.page.data.page, 2); assert.equal(h.page.data.list.length, 2); assert.equal(h.page.data.hasMore, false);
});

test('changing filters invalidates older responses and failures preserve already displayed records', async () => {
  const pending = deferred(); let mode = 'old';
  const h = harness(orderPage, route => route.endsWith('config') ? config : mode === 'old' ? pending.promise : mode === 'failed' ? Promise.reject(Error('网络异常')) : list([order('new', 3)]));
  const first = h.page.onLoad(); mode = 'new'; await h.page.bindStatus(event({ value: 3 }));
  pending.resolve(list([order('old')])); await first; assert.equal(h.page.data.list[0]._id, 'new');
  mode = 'failed'; await h.page.load(true, true); assert.equal(h.page.data.list[0]._id, 'new'); assert.equal(h.page.data.error, '网络异常');
  mode = 'new'; await h.page.bindRetry(); assert.equal(h.page.data.error, '');
});

test('opening details retains list state and refreshing after mutation retains loaded pages, filters and scroll', async () => {
  const h = harness(orderPage, (route, p) => route.endsWith('config') ? config : list([order('p' + p.page)], p.page, 40));
  await h.page.onLoad({ status: '1' }); await h.page.bindMore(); h.page.onPageScroll({ scrollTop: 680 });
  h.page.bindDetail(event({ id: 'one?x' })); assert.match(h.navigation[0].url, /id=one%3Fx$/);
  const count = h.calls.length; h.page.onHide(); await h.page.onShow(); assert.equal(h.calls.length, count);
  h.page.onHide(); h.navigation[0].events.changed(); await h.page.onShow();
  assert.equal(h.page.data.page, 2); assert.equal(h.page.data.status, 1); assert.equal(h.page.data.list.length, 2);
  assert.equal(h.scrolls.at(-1).scrollTop, 680); assert.equal(h.calls.length, count + 2);
});

test('closed pages ignore in-flight list and detail data', async () => {
  for (const file of [orderPage, detailPage]) {
    const pending = deferred();
    const h = harness(file, route => route.endsWith('config') ? config : pending.promise);
    const loading = h.page.onLoad({ id: 'one' }); await tick(); h.page.onUnload(); const count = h.patches.length;
    pending.resolve(file === orderPage ? list([order('one')]) : order('one')); await loading;
    assert.equal(h.patches.length, count);
  }
});

test('detail deep links without ids and missing records terminate loading and provide a list fallback', async () => {
  for (const file of [detailPage, 'feedback/detail/admin_feedback_detail.js', 'user/detail/admin_user_detail.js']) {
    const h = harness(file, () => null); await h.page.onLoad(); assert.equal(h.calls.length, 0); assert.equal(h.page.data.notFound, true);
    await h.page.onLoad({ id: 'missing' }); assert.equal(h.page.data.notFound, true); assert.equal(h.page.data.loading, false);
    h.page.bindBack(); assert.equal(h.navigation.at(-1).method, 'redirectTo');
  }
});

test('picked-up orders support admin intervention, duplicate submits coalesce and failed actions retain the draft', async () => {
  const pending = deferred(); let fail = false;
  const h = harness(detailPage, route => route === 'admin/operations_order' ? order('one', 4) : fail ? Promise.reject(Error('已被更新')) : pending.promise);
  await h.page.onLoad({ id: 'one' }); h.page.bindNote({ detail: { value: '已联系双方核实' } });
  const action = h.page.bindProcess(); await tick(); await h.page.bindProcess(); assert.equal(h.calls.filter(call => call.command).length, 1);
  pending.resolve({}); await action; assert.equal(h.events[0].emit, 'changed'); assert.equal(h.page.data.note, '');
  fail = true; h.page.bindNote({ detail: { value: '保留这个处理说明' } }); await h.page.bindProcess(); assert.equal(h.page.data.note, '保留这个处理说明'); assert.equal(h.page.data.busy, false);
});

test('cancelled confirmations cause no mutations', async () => {
  const h = harness(detailPage, () => order('one', 3), { confirm: false }); await h.page.onLoad({ id: 'one' });
  h.page.bindNote({ detail: { value: '处理说明' } }); await h.page.bindProcess(); assert.equal(h.calls.length, 1); assert.equal(h.page.data.busy, false);
});

test('feedback replies carry the displayed version and preserve drafts on a concurrent-update conflict', async () => {
  const row = { _id: 'fb', FB_VERSION: 7, FB_STATUS: 0, FB_HISTORY: [], FB_ORDER_ID: 'order?one' };
  const h = harness('feedback/detail/admin_feedback_detail.js', route => route.endsWith('detail') ? row : Promise.reject(Error('反馈已被其他管理员更新，请刷新')));
  await h.page.onLoad({ id: 'fb' }); h.page.bindNote({ detail: { value: '已核实，需要继续跟进' } }); h.page.bindAction({ detail: { value: 1 } }); await h.page.bindProcess();
  assert.equal(h.calls.at(-1).params.version, 7); assert.equal(h.calls.at(-1).params.status, 0); assert.equal(h.page.data.note, '已核实，需要继续跟进');
  h.page.bindOrder(); assert.match(h.navigation[0].url, /id=order%3Fone$/);
});

test('configuration keeps decimal input drafts, blocks blank fields and saves only its own section', async () => {
  const h = harness(pricePage, (route, params) => route.endsWith('_save') ? { ...config, ...params.value } : config);
  await h.page.onLoad(); h.page.bindEdit(input('smallPrice', '1.')); assert.equal(h.page.data.config.smallPrice, '1.');
  h.page.bindEdit(input('smallPrice', '')); await h.page.bindSave(); assert.equal(h.calls.length, 1);
  h.page.bindEdit(input('smallPrice', '2.35')); await h.page.bindSave();
  assert.equal(h.calls.at(-1).params.section, 'pricing'); assert.equal(h.calls.at(-1).params.value.smallPrice, 2.35); assert.equal(h.calls.at(-1).params.value.enabled, undefined);
  assert.equal(h.page.data.dirty, false); assert.equal(h.page.data.config.smallPrice, 2.35);
});

test('service settings persist the hours switch through the real config service and ordinary admins cannot change it', async () => {
  const f = fixture(), svc = new (f.load('operation_config_service.js'))();
  Object.assign(f.config, { openHour: 8, closeHour: 22 });
  const respond = (route, params) => route.endsWith('_save') ? svc.saveConfig(params.value, 'admin', params.section) : svc.getConfig();
  const h = harness('settings/service/admin_service_settings.js', respond);
  await h.page.onLoad();
  for (const enabled of [true, false]) {
    h.page.bindEdit(input('enforceBusinessHours', enabled));
    await h.page.bindSave();
    const saved = await svc.getConfig();
    assert.equal(saved.enforceBusinessHours, enabled);
    assert.equal(saved.enabled, true);
    assert.equal(h.page.data.dirty, false);
    assert.equal(h.page.data.config.enforceBusinessHours, enabled);
    const verify = () => f.load('order_rules.js').requireOpen(saved, Date.parse('2026-09-21T23:00:00+08:00'));
    if (enabled) assert.throws(verify, /营业时间/); else assert.doesNotThrow(verify);
  }
  const ordinary = harness('settings/service/admin_service_settings.js', respond, { superAdmin: false });
  await ordinary.page.onLoad();
  ordinary.page.bindEdit(input('enforceBusinessHours', true));
  await ordinary.page.bindSave();
  assert.equal((await svc.getConfig()).enforceBusinessHours, false);
  assert.equal(ordinary.page.data.config.enforceBusinessHours, false);
});

test('refresh cannot discard unsaved configuration and discard restores a separate saved snapshot', async () => {
  const h = harness(pricePage, () => config); await h.page.onLoad(); h.page.bindEdit(input('smallPrice', '4.2'));
  await h.page.onPullDownRefresh(); assert.equal(h.calls.length, 1); assert.equal(h.page.data.config.smallPrice, '4.2');
  await h.page.bindDiscard(); assert.equal(h.page.data.config.smallPrice, 1.5); assert.equal(h.page.data.dirty, false);
});

test('denied admins never read records and ordinary admins cannot mutate settings or run maintenance', async () => {
  for (const file of [orderPage, detailPage, pricePage, 'settings/rules/admin_rules_settings.js', 'monitor/admin_monitor.js']) {
    const denied = harness(file, () => config, { denied: true }); await denied.page.onLoad({ id: 'one' }); assert.equal(denied.calls.length, 0);
  }
  const h = harness(pricePage, () => config, { superAdmin: false }); await h.page.onLoad(); h.page.bindEdit(input('smallPrice', '8')); await h.page.bindSave(); assert.equal(h.calls.length, 1); assert.equal(h.page.data.config.smallPrice, 1.5);
  const monitor = harness('monitor/admin_monitor.js', () => ({}), { superAdmin: false }); await monitor.page.onLoad(); await monitor.page.bindMaintain(); assert.equal(monitor.calls.length, 1);
});

test('export page reads without deleting existing reports and failed generation preserves the previous link', async () => {
  const h = harness('mail/export/admin_mail_export.js', route => route.endsWith('_get') ? { url: 'https://example.invalid/report.xlsx', time: '已生成' } : Promise.reject(Error('请缩小日期范围')));
  await h.page.onLoad(); assert.equal(h.calls[0].params.isDel, 0);
  await h.page.bindExportTap(); assert.equal(h.page.data.reportUrl, 'https://example.invalid/report.xlsx'); assert.equal(h.page.data.busy, false);
  h.page.bindCopy(); assert.equal(h.events[0].copy, h.page.data.reportUrl);
});

test('user lists accept legacy pagination totals and refresh after status changes in their independent detail page', async () => {
  const h = harness('user/list/admin_user_list.js', () => ({ list: [{ _id: 'document-id', USER_MINI_OPENID: 'openid', USER_STATUS: 0 }], total: 21, size: 20, condition: 'encoded-condition' }));
  await h.page.onLoad({ status: '0' }); assert.equal(h.calls[0].params.sortVal, 0); assert.equal(h.page.data.hasMore, true);
  h.page.bindDetail(event({ id: 'openid' })); assert.match(h.navigation[0].url, /admin_user_detail\?id=openid$/);
  h.page.bindExport(); assert.match(h.navigation[1].url, /condition=encoded-condition$/);
});

test('all new templates and shared includes bind real handlers', () => {
  const files = Object.values(harness(orderPage).UI.ROUTES).filter(route => /\/(?:orders|feedback|analytics|settings|monitor|user|mail\/export)\//.test(route));
  for (const route of files) {
    const h = harness(route.slice(1) + '.js');
    let markup = fs.readFileSync(path.join(mini, route + '.wxml'), 'utf8');
    for (const m of markup.matchAll(/<include src="([^"]+)"/g)) markup += fs.readFileSync(path.resolve(mini, route.slice(1), '..', m[1]), 'utf8');
    for (const m of markup.matchAll(/(?:bind|catch):?[\w-]+\s*=\s*["']([\w]+)["']/g)) assert.equal(typeof h.page[m[1]], 'function', route + ': ' + m[1]);
  }
});
