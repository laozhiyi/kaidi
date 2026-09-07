'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const mini = 'miniprogram/projects/crun/pages/';
const userPage = mini + 'operations/operations.js';
const adminPage = mini + 'admin/operations/admin_operations.js';
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function harness(file, get, options = {}) {
  let definition;
  const calls = [], navigation = [], errors = [], patches = [];
  const wx = {
    setNavigationBarTitle: value => navigation.push(value), navigateTo: value => navigation.push(value),
    pageScrollTo() {}, stopPullDownRefresh() {}, showToast() {}, showModal() {}, previewImage() {}
  };
  const ops = {
    async get(route, params) { calls.push({ route, params }); return get(route, params); },
    async command(route, params) { calls.push({ route, params }); return get(route, params); },
    error: error => errors.push(error.message), subscribe() {}
  };
  vm.runInNewContext(read(file), { console, wx, Page: p => { definition = p; }, require(module) {
    if (module.includes('operations_biz')) return ops;
    if (module.includes('project_biz')) return { initPage() {} };
    if (module.includes('passport_biz')) return { loginMustBackWin: async () => true };
    if (module.includes('admin_biz')) return { isAdmin(page) {
      if (options.denied) return false;
      page.setData({ isAdmin: true, isSuperAdmin: options.superAdmin !== false }); return true;
    } };
    if (module.includes('cloud_helper')) return { callCloudData: ops.get };
    if (module.includes('project_setting')) return { SETUP_CONTENT_ITEMS: [
      { key: 'SETUP_CONTENT_ABOUT', title: '关于我们' }, { key: 'SETUP_CONTENT_CONTACT', title: '联系我们' }
    ] };
    throw new Error('Unexpected dependency: ' + module);
  } }, { filename: file });
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(values, callback) {
    patches.push(values);
    for (const [key, value] of Object.entries(values)) {
      const segments = key.split('.'); let target = this.data;
      for (const segment of segments.slice(0, -1)) target = target[segment] ||= {};
      target[segments.at(-1)] = value;
    }
    if (callback) callback();
  } };
  return { page, calls, navigation, errors, patches };
}
const event = dataset => ({ currentTarget: { dataset } });
const config = { campuses: ['东校区', '西校区'], maxActiveOrders: 3 };

test('all registered pages, components, imports and static navigation resolve after consolidation', () => {
  const result = require('../check-miniprogram-pages.cjs').audit();
  assert.equal(result.pages, 48);
});
test('redundant pages are removed while export and role-specific workflows remain registered', () => {
  const app = JSON.parse(read('miniprogram/app.json'));
  for (const route of ['mail/choose/mail_choose', 'about/static/about_static', 'admin/mail/list/admin_mail_list', 'admin/preview/admin_preview', 'news/cate1/news_cate1']) {
    assert.ok(!app.pages.includes('projects/crun/pages/' + route));
    for (const ext of ['js', 'json', 'wxml', 'wxss']) assert.ok(!fs.existsSync(path.join(root, mini, route + '.' + ext)));
  }
  for (const route of ['admin/mail/export/admin_mail_export', 'feedback/index/feedback_index', 'feedback/detail/feedback_detail', 'admin/campus_service/chat_list/admin_campus_chat_list', 'admin/campus_service/list/admin_campus_service_list']) assert.ok(app.pages.includes('projects/crun/pages/' + route));
  const personal = read(mini + 'my/index/my_index.wxml');
  for (const handler of ['bindFeedbackTap', 'bindCampusServiceTap', 'bindInviteTap', 'bindAboutTap']) assert.equal((personal.match(new RegExp('bindtap="' + handler + '"', 'g')) || []).length, 1);
  assert.equal((read(mini + 'admin/index/home/admin_home.wxml').match(/data-url="[^"]*admin_operations[^"]*"/g) || []).length, 1);
});
test('new-page development settings do not use hot reload or unused-file filtering', () => {
  const config = JSON.parse(read('project.private.config.json'));
  assert.equal(config.setting.compileHotReLoad, false);
  assert.equal(config.setting.ignoreDevUnusedFiles, false);
});
test('redesigned page templates bind only existing handlers', () => {
  for (const route of ['about/index/about_index', 'my/index/my_index', 'admin/index/home/admin_home', 'operations/operations', 'admin/operations/admin_operations', 'feedback/my_list/feedback_my_list']) {
    let page;
    vm.runInNewContext(read(mini + route + '.js'), { Page: p => { page = p; }, require: () => ({}) });
    for (const match of read(mini + route + '.wxml').matchAll(/(?:bind|catch):?[\w-]+\s*=\s*["']([\w]+)["']/g)) assert.equal(typeof page[match[1]], 'function', route + ': ' + match[1]);
  }
});
test('rider entry loads independently of notifications and selects the existing campus', async () => {
  const h = harness(userPage, route => {
    if (route === 'operations/config') return config;
    if (route === 'passport/my_detail') return { USER_RIDER_STATUS: 2, USER_RIDER_CAMPUS: '西校区' };
    throw new Error('Notifications must not be loaded by rider tab');
  });
  h.page.onLoad({ tab: 'rider' }); await h.page.onShow();
  assert.equal(h.page.data.campusIndex, 1); assert.equal(h.page.data.error, false);
  assert.equal(h.navigation[0].title, '骑手资格'); assert.equal(h.calls.length, 2);
});
test('messages paginate without fetching profile or config again, and stop at the last page', async () => {
  const h = harness(userPage, (route, params) => {
    if (route === 'operations/config') return config;
    if (route === 'operations/notifications') return { list: [{ _id: String(params.page), createdAt: 1000 }], hasMore: params.page === 1 };
    throw new Error('Unexpected route');
  });
  h.page.onLoad({ tab: 'invalid' }); await h.page.onShow(); await h.page.bindMore(); await h.page.bindMore();
  assert.equal(h.page.data.tab, 'messages'); assert.equal(h.page.data.page, 2); assert.equal(h.page.data.list.length, 2);
  assert.equal(h.calls.filter(x => x.route === 'operations/config').length, 1);
  assert.equal(h.calls.filter(x => x.route === 'operations/notifications').length, 2);
});
test('switching user tabs ignores older results and unloading ignores pending responses', async () => {
  const pending = deferred();
  const h = harness(userPage, route => route === 'operations/config' ? config : route === 'operations/notifications' ? pending.promise : { USER_RIDER_STATUS: 1 });
  h.page.onLoad(); const initial = h.page.onShow(); await tick();
  await h.page.bindTab(event({ tab: 'rider' })); pending.resolve({ list: [{ _id: 'stale', createdAt: 0 }], hasMore: true }); await initial;
  assert.equal(h.page.data.tab, 'rider'); assert.equal(h.page.data.list.length, 0); assert.equal(h.page.data.user.USER_RIDER_STATUS, 1);
  const wait = deferred(), hidden = harness(userPage, route => route === 'operations/config' ? config : wait.promise);
  hidden.page.onLoad(); const load = hidden.page.onShow(); await tick(); hidden.page.onUnload(); const count = hidden.patches.length;
  wait.resolve({ list: [], hasMore: false }); await load; assert.equal(hidden.patches.length, count);
});
test('reading a message updates its badge immediately and feedback links take priority', async () => {
  const h = harness(userPage, () => ({})); h.page._visible = true;
  h.page.setData({ list: [{ _id: 'notice', read: false, feedbackId: 'fb?1', orderId: 'order' }] });
  await h.page.bindRead(event({ id: 'notice' }));
  assert.equal(h.page.data.list[0].read, true);
  assert.equal(h.navigation[0].url, '/projects/crun/pages/feedback/detail/feedback_detail?id=fb%3F1');
  h.page.setData({ list: [{ _id: 'rider-result', read: false }] }); await h.page.bindRead(event({ id: 'rider-result' }));
  assert.equal(h.page.data.list[0].read, true); assert.equal(h.navigation.length, 1);
});
test('empty-campus rider application and duplicate message clicks do not submit extra requests', async () => {
  const pending = deferred(), h = harness(userPage, () => pending.promise); h.page._visible = true;
  h.page.setData({ config: { campuses: [] }, list: [{ _id: 'n' }] }); await h.page.bindApply(); assert.equal(h.calls.length, 0);
  const readRequest = h.page.bindRead(event({ id: 'n' })); await h.page.bindRead(event({ id: 'n' })); assert.equal(h.calls.length, 1);
  pending.resolve({}); await readRequest;
});
test('admin filtering invalidates in-flight detail on the same tab', async () => {
  const pending = deferred();
  const h = harness(adminPage, route => route === 'admin/operations_order' ? pending.promise : { list: [{ _id: 'old' }], hasMore: false });
  await h.page.onLoad({ tab: 'orders' });
  const detail = h.page.bindDetail(event({ id: 'old' })); await h.page.bindFilter({ detail: { value: '2' } });
  pending.resolve({ _id: 'old', MAIL_STATUS: 0 }); await detail;
  assert.equal(h.page.data.detail, null); assert.equal(h.page.data.detailLoading, false);
  assert.equal(h.calls.filter(x => x.route === 'admin/operations_orders').at(-1).params.status, 1);
});
test('admin detail uses dedicated view and back preserves list and page without refetching', async () => {
  const h = harness(adminPage, route => route === 'admin/operations_order' ? { _id: 'one' } : { list: [{ _id: 'one' }], hasMore: true });
  await h.page.onLoad({ tab: 'orders' }); await h.page.bindDetail(event({ id: 'one' }));
  assert.equal(h.page.data.detail._id, 'one'); const count = h.calls.length;
  await h.page.bindMore(); assert.equal(h.calls.length, count);
  h.page.bindClose(); assert.equal(h.page.data.detail, null); assert.equal(h.page.data.list.length, 1); assert.equal(h.page.data.page, 1);
});
test('configuration preserves decimal drafts, rejects blank inputs and normalizes on save', async () => {
  const h = harness(adminPage, () => config); h.page._visible = true;
  h.page.setData({ tab: 'config', isSuperAdmin: true, config: { ...config }, campusText: '东校区' });
  for (const field of h.page.data.fields) h.page.data.config[field.key] = 1;
  h.page.bindConfigNumber({ currentTarget: { dataset: { key: 'smallPrice' } }, detail: { value: '1.' } }); assert.equal(h.page.data.config.smallPrice, '1.');
  h.page.bindConfigNumber({ currentTarget: { dataset: { key: 'smallPrice' } }, detail: { value: '' } }); await h.page.bindSave(); assert.equal(h.calls.length, 0);
  h.page.bindConfigNumber({ currentTarget: { dataset: { key: 'smallPrice' } }, detail: { value: '1.5' } }); await h.page.bindSave();
  assert.equal(h.calls.find(x => x.route === 'admin/operations_config_save').params.value.smallPrice, 1.5);
});
test('non-super administrators cannot submit configuration or maintenance, denied admins do not load data', async () => {
  const h = harness(adminPage, () => config, { superAdmin: false }); await h.page.onLoad({ tab: 'config' });
  const count = h.calls.length; await h.page.bindSave(); await h.page.bindMaintain(); assert.equal(h.calls.length, count);
  const denied = harness(adminPage, () => { throw new Error('must not load'); }, { denied: true }); await denied.page.onLoad(); assert.equal(denied.calls.length, 0);
});
test('unified about page defaults to editable about content and refresh retains the contact key', async () => {
  const h = harness(mini + 'about/index/about_index.js', () => [{ type: 'text', val: '后台配置内容' }]);
  h.page.onLoad(); await tick(); assert.equal(h.calls[0].params.key, 'SETUP_CONTENT_ABOUT'); assert.equal(h.page.data.about[0].val, '后台配置内容');
  h.page.onLoad({ key: 'SETUP_CONTENT_CONTACT' }); await tick(); await h.page.onPullDownRefresh();
  assert.equal(h.calls.at(-1).params.key, 'SETUP_CONTENT_CONTACT'); assert.equal(h.page.data.title, '联系我们');
});