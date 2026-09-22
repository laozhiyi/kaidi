'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { notificationStub } = require('../test-support/notification-client-harness.cjs');
const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const mini = 'miniprogram/projects/crun/pages/';
const userPage = mini + 'operations/operations.js';
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function harness(file, get, options = {}) {
  let definition;
  const calls = [], navigation = [], errors = [], patches = [];
  const wx = {
    setNavigationBarTitle: value => navigation.push(value), navigateTo: value => { navigation.push(value); if (value.complete) value.complete(); },
    pageScrollTo() {}, stopPullDownRefresh() {}, showToast() {}, showModal(value) { if (value.success) value.success({ confirm: true }); }, previewImage() {}
  };
  const ops = {
    async get(route, params) { calls.push({ route, params }); return get(route, params); },
    async command(route, params) { calls.push({ route, params }); return get(route, params); },
    error: error => errors.push(error.message), subscribe() {}
  };
  vm.runInNewContext(read(file), { console, wx, Page: p => { definition = p; }, require(module) {
    if (module.includes('operations_biz')) return ops;
    if (module.includes('notification_biz')) return notificationStub(ops.get);
    if (module.includes('project_biz')) return { initPage() {} };
    if (module.includes('passport_biz')) return { loginMustBackWin: async () => true };
    if (module.includes('admin_biz')) return { isAdmin(page) {
      if (options.denied) return false;
      page.setData({ isAdmin: true, isSuperAdmin: options.superAdmin !== false }); return true;
    } };
    if (module.includes('cloud_helper')) return { callCloudData: ops.get, callCloudSumbit: async (...args) => ({ data: await ops.get(...args) }) };
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
  assert.equal(result.pages, JSON.parse(read('miniprogram/app.json')).pages.length);
});
test('redundant pages are removed while export and role-specific workflows remain registered', () => {
  const app = JSON.parse(read('miniprogram/app.json'));
  for (const route of ['mail/choose/mail_choose', 'about/static/about_static', 'admin/mail/list/admin_mail_list', 'admin/preview/admin_preview', 'news/cate1/news_cate1']) {
    assert.ok(!app.pages.includes('projects/crun/pages/' + route));
    for (const ext of ['js', 'json', 'wxml', 'wxss']) assert.ok(!fs.existsSync(path.join(root, mini, route + '.' + ext)));
  }
  for (const route of ['admin/mail/export/admin_mail_export', 'feedback/index/feedback_index', 'feedback/detail/feedback_detail', 'admin/campus_service/chat_list/admin_campus_chat_list', 'admin/campus_service/list/admin_campus_service_list']) assert.ok(app.pages.includes('projects/crun/pages/' + route));
  const personal = read(mini + 'my/index/my_index.wxml');
  for (const handler of ['bindCampusServiceTap', 'bindInviteTap', 'bindAboutTap']) assert.equal((personal.match(new RegExp('bindtap="' + handler + '"', 'g')) || []).length, 1);
  assert.ok((personal.match(/bindtap="bindFeedbackTap"/g) || []).length >= 1);
  for (const key of ['orders', 'feedback', 'analytics', 'settings']) assert.ok(read(mini + 'admin/index/home/admin_home.wxml').includes('data-key="' + key + '"'));
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
test('messages paginate without fetching profile or config again, and stop at the last page', async () => {
  const h = harness(userPage, (route, params) => {
    if (route === 'operations/config') return config;
    if (route === 'operations/notifications') return { list: [{ _id: String(params.page), createdAt: 1000 }], hasMore: params.page === 1 };
    throw new Error('Unexpected route');
  });
  h.page.onLoad({ tab: 'invalid' }); await h.page.onShow(); await h.page.bindMore(); await h.page.bindMore();
  assert.equal(h.page.data.unreadOnly, false); assert.equal(h.page.data.page, 2); assert.equal(h.page.data.list.length, 2);
  assert.equal(h.calls.filter(x => x.route === 'operations/config').length, 1);
  assert.equal(h.calls.filter(x => x.route === 'operations/notifications').length, 2);
});
test('unloading ignores pending notification responses', async () => {
  const wait = deferred(), h = harness(userPage, route => route === 'operations/config' ? config : wait.promise);
  h.page.onLoad(); const load = h.page.onShow(); await tick(); h.page.onUnload(); const count = h.patches.length;
  wait.resolve({ list: [], hasMore: false }); await load; assert.equal(h.patches.length, count);
});
test('linked messages wait for destination acknowledgement and feedback links take priority', async () => {
  const h = harness(userPage, () => ({})); h.page._visible = true;
  h.page.setData({ list: [{ _id: 'notice', read: false, feedbackId: 'fb?1', orderId: 'order' }] });
  await h.page.bindRead(event({ id: 'notice' }));
  assert.equal(h.page.data.list[0].read, false);
  assert.equal(h.calls.length, 0);
  assert.equal(h.navigation[0].url, '/projects/crun/pages/feedback/detail/feedback_detail?id=fb%3F1&notificationId=notice');
  h.page.setData({ list: [{ _id: 'operations-result', read: false }] }); await h.page.bindRead(event({ id: 'operations-result' }));
  assert.equal(h.page.data.list[0].read, true); assert.equal(h.navigation.length, 1);
});
test('duplicate message clicks do not submit extra requests', async () => {
  const pending = deferred(), h = harness(userPage, () => pending.promise); h.page._visible = true;
  h.page.setData({ list: [{ _id: 'n' }] }); const readRequest = h.page.bindRead(event({ id: 'n' })); await h.page.bindRead(event({ id: 'n' })); assert.equal(h.calls.length, 1);
  pending.resolve({}); await readRequest;
});
// Independent admin pages, navigation, drafts and permissions are covered in admin-console.test.js.

test('unified about page defaults to editable about content and refresh retains the contact key', async () => {
  const h = harness(mini + 'about/index/about_index.js', () => [{ type: 'text', val: '后台配置内容' }]);
  h.page.onLoad(); await tick(); assert.equal(h.calls[0].params.key, 'SETUP_CONTENT_ABOUT'); assert.equal(h.page.data.about[0].val, '后台配置内容');
  h.page.onLoad({ key: 'SETUP_CONTENT_CONTACT' }); await tick(); await h.page.onPullDownRefresh();
  assert.equal(h.calls.at(-1).params.key, 'SETUP_CONTENT_CONTACT'); assert.equal(h.page.data.title, '联系我们');
});
