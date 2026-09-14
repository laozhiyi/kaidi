'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const copy = value => value === undefined ? undefined : structuredClone(value);
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function harness() {
  let userId = 'poster', timerId = 0;
  const modules = new Map(), definitions = new Map(), calls = [], timers = new Map(), navigation = [], modals = [], toasts = [], renders = [];
  const summary = { unreadCount: 3, newsUnread: 1, personalUnread: 2, signature: 'one',
    featuredNews: { _id: 'news', key: 'news:news', newsId: 'news', kind: 'news', title: '校区公告', read: false } };
  const responses = {
    'operations/summary': summary, 'news/featured': { featuredNews: summary.featuredNews },
    'operations/read': { ok: true }, 'operations/read_all': { ok: true },
    'operations/config': { templateId: 'orders', paymentMode: 'offline' },
    'operations/notifications': { list: [], hasMore: false },
    'news/view': { _id: 'news', NEWS_TITLE: '校区公告', NEWS_CONTENT: [{ type: 'text', val: '正文' }], NEWS_PIC: [] },
    'mail/view': { _id: 'order', MAIL_STATUS: 1, MAIL_HISTORY: [], mypost: true },
    'feedback/my_detail': { _id: 'feedback', FB_STATUS: 1, FB_CONTENT: '说明', FB_REPLY: '处理结果' },
    'reputation/summary': { score: 80, reviews: { points: 0, average: null }, admin: { points: 0, average: null } },
    'reputation/records': { list: [], hasMore: false },
    'passport/my_detail': { USER_NAME: '用户', USER_STATUS: 1 }, 'home/list': { cnt: 4, list: [] }
  };
  const options = { deferRender: false, navigationFails: false, deferModal: false };
  const request = async (route, params = {}) => {
    calls.push({ route, params: copy(params) });
    if (!Object.prototype.hasOwnProperty.call(responses, route)) throw new Error('Unexpected route: ' + route);
    const result = responses[route]; return typeof result === 'function' ? result(params) : copy(result);
  };
  const wx = {
    setNavigationBarTitle() {}, stopPullDownRefresh() {}, showToast: value => toasts.push(value),
    navigateTo(value) { navigation.push(value); if (options.navigationFails) { if (value.fail) value.fail(); } else if (value.success) value.success(); if (value.complete) value.complete(); },
    showModal(value) { modals.push(value); if (!options.deferModal && value.success) value.success({ confirm: true }); },
    switchTab: value => navigation.push(value), removeStorageSync() {}, setStorageSync() {}, getStorageSync() { return ''; }
  };
  const passport = { getUserId: () => userId, isLogin: () => !!userId, getToken: () => ({ id: userId, name: userId }),
    loginMustBackWin: async () => !!userId, loginMustCancelWin: async () => !!userId, loginSilenceMust: async () => !!userId };
  const ops = { get: request, command: request, error: error => toasts.push({ title: error.message }), subscribe: async () => 'subscribed' };
  function load(relative) {
    const filename = path.resolve(root, relative);
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} }; modules.set(filename, module);
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
      console, module, wx, Date, getCurrentPages: () => [{ route: 'projects/crun/pages/default/index/default_index' }],
      setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id; }, clearTimeout: id => timers.delete(id),
      clearInterval() {}, Page: definition => definitions.set(filename, definition), Component: definition => definitions.set(filename, definition),
      require(name) {
        if (name.endsWith('/operations_biz.js')) return ops;
        if (name.endsWith('/passport_biz.js')) return passport;
        if (name.endsWith('/project_biz.js')) return { initPage() {} };
        if (name.endsWith('/mail_ui_biz.js')) return { detail: () => ({}) };
        if (name.endsWith('/profile_methods.js')) return {};
        if (name.endsWith('/invite_biz.js')) return { acceptPending: async () => {} };
        if (name.endsWith('/admin_biz.js')) return {};
        if (name.endsWith('/cloud_helper.js')) return { callCloudData: request, callCloudSumbit: async (...args) => ({ data: await request(...args) }) };
        if (name.endsWith('/page_helper.js')) return { getOptions(page, value = {}) { page.setData({ id: value.id || '' }); return !!value.id; }, showTopBtn() {}, url() {} };
        return load(path.resolve(path.dirname(filename), name));
      }
    }, { filename });
    return module.exports;
  }
  function page(relative) {
    const filename = relative === 'custom-tab-bar/index' ? 'miniprogram/' + relative + '.js' : 'miniprogram/projects/crun/pages/' + relative + '.js';
    load(filename);
    const definition = definitions.get(path.resolve(root, filename));
    return { ...definition, ...(definition.methods || {}), data: copy(definition.data), selectComponent() { return null; },
      setData(values, callback) { Object.assign(this.data, copy(values)); if (callback) options.deferRender ? renders.push(callback) : callback(); } };
  }
  return { load, page, calls, responses, summary, timers, navigation, modals, toasts, renders, options, wx,
    notifications: () => load('miniprogram/projects/crun/biz/notification_biz.js'), setUser: value => { userId = value; },
    async fireTimer() { const [id, timer] = timers.entries().next().value; timers.delete(id); timer.fn(); await tick(); },
    render() { for (const callback of renders.splice(0)) callback(); } };
}
// Existing page suites isolate their original feature; notification behavior is exercised by the real module above.
function notificationStub(request = async () => ({})) {
  const api = harness().notifications();
  return { messageUrl: api.messageUrl, subscribe: () => () => {}, refresh: async () => ({}), pause() {}, resume() {},
    markRead: (id, kind = 'notification') => request('operations/read', { id, kind }),
    markAllRead: () => request('operations/read_all') };
}
module.exports = { harness, tick, deferred, notificationStub };
