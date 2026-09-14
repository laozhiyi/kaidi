'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { notificationStub } = require('../test-support/notification-client-harness.cjs');
const { harness: adminHarness } = require('../test-support/admin-console-harness.cjs');
const { summarize } = require('../../cloudfunctions/mcloud/project/crun/service/reputation_rules.js');
const mini = path.resolve(__dirname, '../../miniprogram');
const tick = () => new Promise(resolve => setImmediate(resolve));
const event = (dataset = {}, value) => ({ currentTarget: { dataset }, detail: { value } });
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { resolve, reject, promise }; }
function harness(responses = {}, allowed = true) {
  const calls = [], navigation = [], errors = [], cache = new Map(), pages = new Map(), storage = new Map(), timers = new Map();
  let timerId = 0;
  const request = async (route, params = {}) => {
    calls.push({ route, params: structuredClone(params) });
    if (!(route in responses)) throw Error('Unexpected route: ' + route);
    return typeof responses[route] === 'function' ? responses[route](params) : structuredClone(responses[route]);
  };
  const ops = { get: request, command: request, upload: async images => images, error: error => errors.push(error.message) };
  const wx = {
    getStorageSync: key => storage.get(key) || '', setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key),
    navigateTo: data => navigation.push(data.url), switchTab: data => navigation.push(data.url), redirectTo: data => navigation.push(data.url), navigateBack: () => navigation.push('back'),
    showToast() {}, showModal(data) { if (data.success) data.success({ confirm: true }); }, stopPullDownRefresh() {}, setNavigationBarTitle() {}, showLoading() {}, hideLoading() {}
  };
  function load(relative) {
    const file = path.resolve(mini, relative);
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), { module, console, Date, wx,
      setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id),
      Page: page => pages.set(file, page),
      require(name) {
        if (name.endsWith('/operations_biz.js')) return ops;
        if (name.endsWith('/order_sync_biz.js')) return { subscribe: () => () => {} };
        if (name.endsWith('/notification_biz.js')) return notificationStub(request);
        if (name.endsWith('/project_biz.js')) return { initPage() {} };
        if (name.endsWith('/passport_biz.js')) return { loginMustCancelWin: async () => allowed, loginMustBackWin: async () => allowed, getUserId: () => 'rider', isLogin: () => true };
        if (name.endsWith('/page_helper.js')) return { fmtURLByPID: url => '/projects/crun' + url, dataset: (e, key) => e.currentTarget.dataset[key], showSuccToast() {}, showNoneToast() {}, showConfirm: async () => true };
        if (name.endsWith('/cloud_helper.js')) return { callCloudSumbit: async (...args) => ({ data: await request(...args) }) };
        if (name.endsWith('/public_biz.js') || name.endsWith('/admin_biz.js') || name.endsWith('/profile_methods.js')) return {};
        return load(path.relative(mini, path.resolve(path.dirname(file), name)));
      }
    }, { filename: file });
    return module.exports;
  }
  function page(relative) {
    const file = path.resolve(mini, 'projects/crun/pages', relative + '.js'); load(path.relative(mini, file));
    const definition = pages.get(file);
    return { ...definition, data: structuredClone(definition.data), selectComponent: () => null, setData(values, callback) {
      for (const [key, value] of Object.entries(values)) {
        const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.'); let target = this.data;
        for (const part of parts.slice(0, -1)) target = target[part] ||= {};
        target[parts.at(-1)] = value;
      }
      if (callback) callback();
    } };
  }
  return { page, load, responses, calls, navigation, errors, timers, storage };
}

test('favorite synchronization batches requests, discards stale results and stops requests on hidden pages', async () => {
  const pending = deferred();
  const h = harness({ 'fav/order_stats': () => pending.promise });
  const Favorites = h.load('projects/crun/biz/order_fav_biz.js'), applied = [];
  const watcher = Favorites.watch(() => ['one'], rows => applied.push(rows));
  const first = watcher.refresh(); watcher.invalidate(); pending.resolve({ list: [{ id: 'one', count: 0 }] }); await first;
  assert.equal(applied.length, 0);
  h.responses['fav/order_stats'] = params => ({ list: params.ids.map(id => ({ id, count: 3, isFav: true, available: true })) });
  await watcher.refresh(); assert.equal(applied[0][0].count, 3); assert.equal(h.timers.size, 1);
  watcher.stop(); assert.equal(h.timers.size, 0); const count = h.calls.length; await watcher.refresh(); assert.equal(h.calls.length, count);
  const result = await Favorites.stats(Array.from({ length: 105 }, (_, i) => 'id' + i));
  assert.equal(result.length, 105); assert.deepEqual(h.calls.slice(-3).map(call => call.params.ids.length), [50, 50, 5]);
});

test('available-order favorites use explicit desired state, coalesce taps and refresh without overwriting hidden pages', async () => {
  const pending = deferred();
  const h = harness({ 'fav/order_stats': { list: [{ id: 'one', count: 4, isFav: false, available: true }] }, 'fav/update': () => pending.promise });
  const page = h.page('order/index/order_index'); await page.onLoad({}); page.onShow(); await tick();
  page.bindCommListCmpt({ detail: { dataList: { list: [{ _id: 'one', MAIL_OBJ: {}, MAIL_CAN_FAV: true }], total: 1 } } }); await tick();
  assert.equal(page.data.dataList.list[0].MAIL_FAV_CNT, 4);
  const first = page.bindFavoriteTap(event({ id: 'one' })); await tick(); await page.bindFavoriteTap(event({ id: 'one' }));
  assert.equal(h.calls.filter(call => call.route === 'fav/update').length, 1);
  assert.equal(h.calls.find(call => call.route === 'fav/update').params.favorite, true);
  pending.resolve({ id: 'one', count: 5, isFav: 1, available: true }); await first;
  assert.equal(page.data.dataList.list[0].MAIL_IS_FAV, true); assert.equal(page.data.favoriteBusyId, '');
  page.onHide(); assert.equal(h.timers.size, 0);
  page._applyFavoriteStats([{ id: 'one', count: 999, isFav: false }]); assert.equal(page.data.dataList.list[0].MAIL_FAV_CNT, 5);
  page.onShow(); await tick(); page.bindTabTap(event({ idx: 1 })); assert.equal(h.timers.size, 0); page.onUnload();
});

test('hiding an order list cancels the remaining batches of a favorite refresh', async () => {
  const pending = deferred(), h = harness({ 'fav/order_stats': () => pending.promise });
  const Favorites = h.load('projects/crun/biz/order_fav_biz.js');
  const watcher = Favorites.watch(() => Array.from({ length: 120 }, (_, i) => 'id' + i), () => assert.fail('hidden page must not update'));
  const refresh = watcher.refresh(); watcher.stop(); pending.resolve({ list: [] }); await refresh;
  assert.equal(h.calls.length, 1); assert.equal(h.timers.size, 0);
});

test('cancelled login never creates a favorite and failed requests leave the displayed count unchanged', async () => {
  for (const allowed of [false, true]) {
    const h = harness({ 'fav/update': () => { throw Error('network'); } }, allowed), page = h.page('order/index/order_index');
    page._visible = true; page.setData({ dataList: { list: [{ _id: 'one', MAIL_FAV_CNT: 8, MAIL_CAN_FAV: true, MAIL_IS_FAV: false }] } });
    await page.bindFavoriteTap(event({ id: 'one' }));
    assert.equal(h.calls.length, allowed ? 1 : 0); assert.equal(page.data.favoriteBusyId, ''); assert.equal(page.data.dataList.list[0].MAIL_FAV_CNT, 8);
  }
});

test('reputation retries failures, paginates records, and ignores an old response after switching record sources', async () => {
  const summary = summarize([0, 0, 0, 0, 1], [1, 0, 0, 0, 0]);
  const h = harness({ 'reputation/summary': () => { throw Error('offline'); }, 'reputation/records': { list: [], hasMore: false } });
  const page = h.page('my/reputation/my_reputation'); page.onLoad(); await page.onShow();
  assert.equal(page.data.error, true); assert.equal(page.data.summary, null);
  h.responses['reputation/summary'] = summary;
  h.responses['reputation/records'] = params => ({ list: [{ _id: String(params.page), score: 5, points: 4 }], hasMore: params.page === 1 });
  await page.load(); assert.equal(page.data.summary.score, 80); assert.equal(page.data.summary.reviews.pointsText, '+4');
  await page.onReachBottom(); assert.equal(page.data.list.length, 2); assert.equal(page.data.hasMore, false);
  const pending = deferred(); h.responses['reputation/records'] = params => params.source === 'review' ? pending.promise : { list: [{ _id: 'admin', score: 1, points: -4 }], hasMore: false };
  const old = page.load(); await tick(); await page.bindSource(event({ source: 'admin' }));
  pending.resolve({ list: [{ _id: 'stale', score: 5, points: 4 }], hasMore: false }); await old;
  assert.equal(page.data.source, 'admin'); assert.equal(page.data.list[0]._id, 'admin');
  page.onHide(); const length = h.calls.length; await page.load(); assert.equal(h.calls.length, length);
});

test('review submission requires validated context and a selected star, retains a failed draft and locks a successful review', async () => {
  const h = harness({ 'review/context': { canReview: true, reviewed: false, targetName: '小陈', targetRole: '接单人', orderId: 'one' }, 'review/insert': () => { throw Error('network'); } });
  const page = h.page('my/review_add/review_add'); page.onLoad({ orderId: 'one' });
  await page.bindSubmit(); assert.equal(h.calls.length, 0);
  await page.onShow(); await page.bindSubmit(); assert.equal(h.calls.length, 1);
  page.bindScore(event({ score: 4 })); page.bindContent(event({}, '认真负责')); await page.bindSubmit();
  assert.equal(page.data.busy, false); assert.equal(page.data.score, 4); assert.equal(page.data.content, '认真负责');
  h.responses['review/insert'] = { id: 'review' }; await page.bindSubmit();
  assert.equal(page.data.context.canReview, false); assert.equal(page.data.context.reviewed, true); assert.equal(h.navigation.at(-1), 'back');
  const count = h.calls.length; await page.bindSubmit(); page.bindScore(event({ score: 1 })); assert.equal(h.calls.length, count); assert.equal(page.data.score, 4);
});

test('already-reviewed pages display the saved rating read-only, and missing order links never submit', async () => {
  const h = harness({ 'review/context': { canReview: false, reviewed: true, review: { score: 2, content: '已保存' } } });
  const page = h.page('my/review_add/review_add'); page.onLoad({ orderId: 'one' }); await page.onShow();
  page.bindScore(event({ score: 5 })); page.bindContent(event({}, 'overwrite')); await page.bindSubmit();
  assert.equal(page.data.score, 2); assert.equal(page.data.content, '已保存'); assert.equal(h.calls.length, 1);
  const missing = h.page('my/review_add/review_add'); missing.onLoad({}); await missing.onShow(); await missing.bindSubmit();
  assert.match(missing.data.error, /缺少订单/); assert.equal(h.calls.length, 1);
});

test('completed orders expose rating to publishers and riders and reviewed orders open the saved rating', () => {
  const h = harness(), UI = h.load('projects/crun/biz/mail_ui_biz.js');
  for (const role of ['mypost', 'myaccept']) {
    const mail = { _id: 'one', MAIL_STATUS: 9, MAIL_CAN_REVIEW: true, [role]: true, MAIL_OBJ: {} };
    const page = h.page('mail/my_detail/mail_my_detail');
    page.setData({ id: 'one', loading: false, mail, detailUI: UI.detail(mail) }); page.bindPrimaryAction();
    assert.match(h.navigation.at(-1), /review_add\?orderId=one$/);
    assert.equal(UI.detail({ ...mail, MAIL_CAN_REVIEW: false, MAIL_REVIEWED: true }).primaryLabel, '查看我的评价');
  }
  assert.notEqual(UI.detail({ MAIL_STATUS: 9, MAIL_OBJ: {}, MAIL_CAN_REVIEW: true }).primary, 'review');
});

test('order complaints identify either counterpart before submission and block unresolved order information', async () => {
  for (const role of ['mypost', 'myaccept']) {
    const target = { name: '对方同学', role: role === 'mypost' ? '接单人' : '发布者' };
    const h = harness({ 'mail/view': { _id: 'one', [role]: true, MAIL_FEEDBACK_TARGET: target }, 'feedback/insert': { id: 'fb' } });
    const page = h.page('feedback/index/feedback_index'); await page.onLoad({ orderId: 'one' });
    page.bindContentInput(event({}, '请核实服务情况')); await page.bindSubmitTap();
    const call = h.calls.find(item => item.route === 'feedback/insert');
    assert.equal(call.params.type, 'complain'); assert.equal(call.params.orderId, 'one'); assert.ok(call.params.title.includes(target.role));
  }
  const failed = harness({ 'mail/view': () => { throw Error('network'); } }), page = failed.page('feedback/index/feedback_index');
  await page.onLoad({ orderId: 'one' }); page.setData({ content: '请核实', targetIdx: 1 }); await page.bindSubmitTap();
  assert.equal(failed.calls.length, 1); assert.equal(page.data.isSubmit, false);
});

test('administrator star selection is required, sends the current version, and preserves a rejected decision draft', async () => {
  const detail = { _id: 'fb', FB_STATUS: 0, FB_VERSION: 7, FB_CAN_RATE: true, FB_TARGET_NAME: '小陈', FB_TARGET_ROLE: '接单人' };
  let fail = true;
  const h = adminHarness('feedback/detail/admin_feedback_detail.js', route => route === 'admin/feedback_detail' ? detail : fail ? Promise.reject(Error('已被更新')) : {});
  await h.page.onLoad({ id: 'fb' }); h.page.bindNote(event({}, '已核实全部凭证')); h.page.bindRatingAction(event({}, 1));
  await h.page.bindProcess(); assert.equal(h.calls.filter(call => call.command).length, 0);
  h.page.bindReviewScore(event({ score: 2 })); await h.page.bindProcess();
  const call = h.calls.find(item => item.command); assert.equal(call.params.reviewScore, 2); assert.equal(call.params.ratingAction, 'rate'); assert.equal(call.params.version, 7);
  assert.equal(h.page.data.reviewScore, 2); assert.equal(h.page.data.note, '已核实全部凭证');
  fail = false; await h.page.bindProcess(); assert.equal(h.page.data.reviewScore, 0); assert.equal(h.page.data.note, '');
});

test('all added page actions resolve to handlers and the reputation entry sits directly above contacts', () => {
  const h = harness();
  for (const relative of ['my/reputation/my_reputation', 'my/review_add/review_add', 'my/review/my_review', 'my/fav/my_fav', 'mail/detail/mail_detail', 'order/index/order_index']) {
    const page = h.page(relative), markup = fs.readFileSync(path.join(mini, 'projects/crun/pages', relative + '.wxml'), 'utf8');
    for (const match of markup.matchAll(/(?:bind|catch):?[\w-]+\s*=\s*["']([\w]+)["']/g)) assert.equal(typeof page[match[1]], 'function', relative + ': ' + match[1]);
  }
  const my = fs.readFileSync(path.join(mini, 'projects/crun/pages/my/index/my_index.wxml'), 'utf8');
  assert.match(my, /bindMyReputationTap[^\n]*我的信誉分[^\n]*\n\s*<view class="my-link" bindtap="bindProfileContactTap"/);
  const order = fs.readFileSync(path.join(mini, 'projects/crun/pages/order/index/order_index.wxml'), 'utf8');
  assert.ok(!order.includes('fab-publish')); assert.ok(!order.includes('bindPublishTap'));
});
