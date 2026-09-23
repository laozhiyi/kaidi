'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../miniprogram');
const tick = () => new Promise(resolve => setImmediate(resolve));
const clone = value => value === undefined ? undefined : structuredClone(value);
function client({ unselected = false, admin = false } = {}) {
  let userId = 'rider', now = 1000000, timerId = 0;
  const modules = new Map(), definitions = new Map(), calls = [], watchers = [], timers = new Map(), storage = new Map(), events = [], ui = [], network = new Set(), cached = new Set();
  // Persisted selection is kept separately so existing assertions about pending
  // command storage continue to assert exactly that lifecycle.
  let selection = unselected ? null : { schoolId: 'gxnu', campusId: 'yucai', schoolName: '广西师范大学', campusName: '育才校区' };
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const wx = {
    getStorageSync: key => clone(key === 'crun-campus-context' ? selection : storage.get(key)),
    setStorageSync: (key, value) => key === 'crun-campus-context' ? (selection = clone(value)) : storage.set(key, clone(value)),
    removeStorageSync: key => key === 'crun-campus-context' ? (selection = null) : storage.delete(key),
    getStorageInfoSync: () => ({ keys: [...storage.keys(), ...(selection ? ['crun-campus-context'] : [])] }),
    showLoading: args => ui.push(['show', args]), hideLoading: () => ui.push(['hide']),
    showNavigationBarLoading: () => ui.push(['bar']), hideNavigationBarLoading: () => ui.push(['unbar']),
    showModal: args => ui.push(['modal', args]), showToast: args => ui.push(['toast', args]),
    reLaunch: args => ui.push(['relaunch', args]), navigateTo: args => ui.push(['navigate', args]),
    stopPullDownRefresh() {}, setNavigationBarTitle() {},
    onNetworkStatusChange: listener => network.add(listener), offNetworkStatusChange: listener => network.delete(listener),
    cloud: {
      callFunction(args) { calls.push(args); },
      database() { return { collection(name) {
        const info = { name };
        const query = { where(value) { info.where = value; return query; }, limit(value) { info.limit = value; return query; }, watch(callbacks) {
          const watcher = { ...info, ...callbacks, closed: false, close() { this.closed = true; } };
          watchers.push(watcher); return watcher;
        } }; return query;
      } }; }
    }
  };
  function load(relative) {
    const filename = path.resolve(root, relative);
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} }; modules.set(filename, module);
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
      module, wx, Date: Clock, console: { log() {}, error() {}, warn() {} },
      setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, at: now + Math.max(0, delay), delay }); return id; },
      clearTimeout: id => timers.delete(id),
      Page: value => definitions.set(filename, value), Component: value => definitions.set(filename, value),
      require(name) {
        if (name.endsWith('/passport_biz.js')) return { getUserId: () => userId, loginMustCancelWin: async () => true, loginMustBackWin: async () => true };
        if (name.endsWith('/admin_biz.js')) return { getAdminToken: () => admin ? { name: 'review-admin', token: 'test-session' } : null,
          isAdmin(page) { if (admin) page.setData({ isAdmin: true, isSuperAdmin: true }); return admin; },
          setContentDesc: page => load('comm/biz/admin_biz.js').setContentDesc(page) };
        if (name.endsWith('/project_biz.js')) return { initPage() {} };
        if (name.endsWith('/order_fav_biz.js')) return { watch: () => ({ stop() {}, invalidate() {}, refresh: async () => {} }) };
        // Coordinator tests drive signals deterministically; transport polling
        // and cloud scoping have their own tests using the real feed module.
        if (name.endsWith('/order_feed_biz.js')) return {watch(callbacks){const watcher={...callbacks,route:'operations/feed',closed:false,close(){this.closed=true;}};watchers.push(watcher);return watcher;}};
        if (name.endsWith('/public_biz.js')) return { isCacheList: key => cached.has(key), setCacheList: key => cached.add(key), removeCacheList: key => cached.delete(key) };
        if (name.endsWith('/cache_helper.js')) return { get: key => key === 'user' ? { id: userId, sessionToken: crypto.createHash('sha256').update(userId).digest('hex') } : null, remove: key => storage.delete(key) };
        if (name.endsWith('/constants.js')) return { CACHE_TOKEN: 'user', CACHE_ADMIN: 'admin', CACHE_WORK: 'work' };
        if (name.endsWith('/page_helper.js')) return { getPID: () => 'crun', fmtURLByPID: url => '/projects/crun' + url, showConfirm: async () => true, showSuccToast() {},
          getOptions(page, options = {}, key = 'id') { const value = options[key] || options.scene; if (!value) return false; page.setData({ [key]: value }); return true; },
          commListListener(page, event) { page.setData(event.detail); } };
        if (name.endsWith('/md5_lib.js')) return { md5: text => crypto.createHash('md5').update(text).digest('hex') };
        if (name.endsWith('/time_helper.js')) return { time: () => '20260914' };
        if (/data_helper|content_check_helper/.test(name)) return {};
        return load(path.relative(root, path.resolve(path.dirname(filename), name)));
      }
    }, { filename });
    return module.exports;
  }
  function mount(relative, values = {}) {
    const file = path.resolve(root, relative); load(relative);
    const definition = definitions.get(file);
    const properties = Object.fromEntries(Object.entries(definition.properties || {}).map(([key, property]) => [key, clone(property.value)]));
    const instance = { ...definition, ...(definition.methods || {}), data: { ...properties, ...clone(definition.data), ...values }, patches: [],
      setData(patch, callback) {
        this.patches.push(clone(patch));
        for (const [key, value] of Object.entries(patch)) {
          const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.'); let target = this.data;
          for (const part of parts.slice(0, -1)) target = target[part] || (target[part] = {});
          target[parts.at(-1)] = clone(value);
        }
        if (callback) callback();
      },
      triggerEvent(name, detail) { events.push({ name, detail: clone(detail) }); if (instance.listener) instance.listener({ detail }); },
      selectComponent() { return null; }
    };
    if (definition.lifetimes && definition.lifetimes.attached) definition.lifetimes.attached.call(instance);
    return instance;
  }
  return { wx, load, mount, calls, watchers, timers, storage, events, ui, network, cached,
    cloud: load('helper/cloud_helper.js'), ops: () => load('projects/crun/biz/operations_biz.js'), sync: () => load('projects/crun/biz/order_sync_biz.js'),
    setUser(value) { userId = value; },
    respond(index, data, code = 200) { calls[index].success({ result: { code, data } }); },
    fail(index, value = { errMsg: 'network disconnected' }) { calls[index].fail(value); },
    networkChange(isConnected) { for (const listener of network) listener({ isConnected }); },
    async advance(ms) {
      const end = now + ms;
      for (let steps = 0; steps < 1000; steps++) {
        const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) { now = end; await tick(); return; }
        now = next[1].at; timers.delete(next[0]); next[1].fn(); await tick();
      }
      throw Error('Timer loop exceeded test bound');
    }
  };
}
module.exports = { client, tick };
