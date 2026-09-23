'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { notificationStub } = require('../test-support/notification-client-harness.cjs');
const root = path.resolve(__dirname, '../..');
const pages = 'miniprogram/projects/crun/pages/';
const event = (dataset = {}, value) => ({ currentTarget: { dataset }, detail: { value } });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness(options = {}) {
  const storage = options.storage || new Map(), calls = [], navigation = [], messages = [], images = [], modules = new Map(), definitions = new Map();
  let app, token = options.guest ? null : { id: 'poster', sessionToken: 'b'.repeat(64), name: '小周', pic: 'cloud://avatar', status: 1, phoneVerified: true, profileComplete: true }, stopped = 0;
  const user = { USER_NAME: '小周', USER_MOBILE: '13800000000', USER_MOBILE_VERIFIED: true, USER_PROFILE_COMPLETE: true, USER_PIC: 'cloud://avatar', USER_STATUS: 1, USER_FORMS: [
    { mark: 'campus', val: '育才校区' }, { mark: 'sex', val: '男' }, { mark: 'college', val: '计算机学院' }, { mark: 'sub', val: '软件工程' },
    { mark: 'contacts', val: [{ name: '甲', phone: '13800000001', isDefault: false }, { name: '乙', phone: '13800000002', isDefault: true }] },
    { mark: 'addresses', val: [{ label: '宿舍', detail: '一栋', isDefault: false }, { label: '学院', detail: '二栋', isDefault: true }] }
  ] };
  const responses = {
    'operations/config': { campuses: ['育才校区', '王城校区', '雁山校区'], phoneLoginEnabled: options.phoneLoginEnabled !== false,
      allowManualRegistration: options.phoneLoginEnabled === false || options.manualRegistration === true, locations:require('../../cloudfunctions/mcloud/project/crun/service/tenant_defaults.js').locations },
    'passport/my_detail': user, 'passport/edit_base': { ok: true }, 'passport/logout': { ok: true },
    'passport/register': { token: { id: 'poster', sessionToken: 'b'.repeat(64), name: '小周', status: 1, phoneVerified: true, profileComplete: true } },
    'invite/accept': { accepted: true }, 'invite/my_code': { code: 'ABCDEF' },
    'invite/my_stat': { total: 0, accepted: 0, pending: 0, reward: 0 },
    'invite/my_list': { list: [], hasMore: false },
    'fav/my_list': { list: [], total: 0, hasMore: false }, 'fav/del': { effect: 1 },
    'review/my_list': { list: [], hasMore: false }, 'feedback/my_list': { list: [], hasMore: false },
    'operations/notifications': { list: [], hasMore: false }, 'operations/read': { ok: true }, 'feedback/insert': { id: 'feedback' }
  };
  const request = async (route, params = {}) => {
    calls.push({ route, params: structuredClone(params) });
    const response = responses[route];
    if (response === undefined) throw new Error('Unexpected route: ' + route);
    return typeof response === 'function' ? response(params) : structuredClone(response);
  };
  const navigate = type => data => { navigation.push({ type, ...data }); if (data && data.complete) data.complete(); };
  const wx = {
    canIUse: () => true,
    getStorageSync: key => storage.get(key) || '', setStorageSync: (key, value) => storage.set(key, structuredClone(value)),
    removeStorageSync: key => storage.delete(key), getStorageInfoSync: () => ({ keys: Array.from(storage.keys()) }),
    navigateTo: navigate('navigate'), redirectTo: navigate('redirect'), switchTab: navigate('tab'), navigateBack: navigate('back'),
    reLaunch: navigate('relaunch'), showToast: data => messages.push(data.title), hideKeyboard() {},
    stopPullDownRefresh: () => { stopped++; }, setNavigationBarTitle() {}, showLoading() {}, hideLoading() {},
    showModal: data => { messages.push(data.title); if (data.success) data.success({ confirm: options.confirm !== false }); if (data.complete) data.complete(); },
    chooseImage: data => { images.push(data); data.success({ tempFilePaths: ['temp/new'] }); },
    previewImage: data => images.push(data), setClipboardData: data => { storage.set('clipboard', data.data); if (data.success) data.success(); }
  };
  let passport = {
    getUserId: () => token && token.id || '', getToken: () => token, getUserName: () => token && token.name || '', isLoggedOut: () => false,
    isProfileReady: value => !!(value && (value.phoneVerified || value.allowManualRegistration) && value.profileComplete),
    isLogin: () => !!(token && token.status === 1 && (token.phoneVerified || token.allowManualRegistration) && token.profileComplete), setToken: value => { token = value; }, clearToken: () => { token = null; },
    loginMustBackWin: async () => options.allowed !== false, loginMustCancelWin: async () => options.allowed !== false,
    loginSilenceMust: async () => !!token, flushLogout: async () => true,
    async loginByWechatPhone(e) {
      if (!e.detail.code) throw Error('请授权微信手机号');
      const result = await request('passport/wechat_login', { code: e.detail.code }); token = result.token; return result;
    }
  };
  const ops = { get: request, command: request, pendingCommand: () => null, upload: async paths => paths.map(file => 'cloud://' + file),
    error: error => messages.push(error.message), subscribe: async () => 'subscribed', clearUploadCache() {} };
  const pageHelper = { dataset: (e, key) => e.currentTarget.dataset[key], showNoneToast: value => messages.push(value),
    showSuccToast: (value, delay, callback) => { messages.push(value); if (callback) callback(); },
    showModal: value => messages.push(value), url: e => wx.navigateTo({ url: e.currentTarget.dataset.url }),
    fmtURLByPID: url => '/projects/crun' + url, getCurrentPageUrlWithArgs: () => '/projects/crun/pages/mail/add/mail_add' };
  const uploads = [];
  const cloud = { callCloudData: request, callCloudSumbit: async (...args) => ({ data: await request(...args) }),
    transTempPicOne: async (...args) => { uploads.push(args); return options.uploadAvatar ? options.uploadAvatar(...args) : args[0]; }, transTempPics: async value => value };
  function load(relative) {
    const filename = path.resolve(root, relative);
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} }; modules.set(filename, module);
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
      module, console, wx, Date, setTimeout, clearTimeout, getCurrentPages: () => [{}, {}],
      Page: definition => definitions.set(filename, definition), App: definition => { app = definition; },
      require(name) {
        if (name.endsWith('/operations_biz.js')) return ops;
        if (name.endsWith('/notification_biz.js')) return notificationStub(request);
        if (name.endsWith('/project_biz.js')) return { initPage() {} };
        if (name.endsWith('/passport_biz.js')) return passport;
        if (name.endsWith('/cloud_helper.js')) return cloud;
        if (name.endsWith('/page_helper.js')) return pageHelper;
        if (name.endsWith('/validate.js')) return { check: data => data };
        if (name.endsWith('/admin_biz.js')) return { getAdminToken: () => options.admin ? { token: 'admin' } : null };
        return load(path.resolve(path.dirname(filename), name));
      }
    }, { filename });
    return module.exports;
  }
  function page(relative) {
    const filename = path.resolve(root, pages + relative);
    load(filename);
    const definition = definitions.get(filename);
    // Legacy scenarios intentionally retain the phone flow; basic-login cases disable it.
    return { ...definition, data: { ...structuredClone(definition.data), phoneLoginEnabled: options.phoneLoginEnabled !== false }, setData(values, callback) {
      for (const [key, value] of Object.entries(values)) {
        const parts = key.split('.'); let target = this.data;
        for (const part of parts.slice(0, -1)) target = target[part] ||= {};
        target[parts.at(-1)] = value;
      }
      if (callback) callback();
    } };
  }
  if (options.realSessionSignals) {
    const signals = load('miniprogram/helper/cloud_helper.js');
    for (const method of ['getSessionEpoch', 'onSessionChange', 'invalidateSessionRequests']) cloud[method] = signals[method];
  }
  if (options.realPassport) {
    passport = load('miniprogram/comm/biz/passport_biz.js');
    if (token) passport.setToken(token);
  }
  return { page, load, user, responses, calls, navigation, messages, images, uploads, storage, wx, passport,
    get app() { return app; }, get token() { return passport.getToken(); }, get stopped() { return stopped; } };
}

async function readyProfile(h, page) {
  await h.load('miniprogram/projects/crun/pages/my/profile_methods.js').loadCampuses(page);
  // These tests exercise edits after successful page initialization.
  h.calls.length = 0;
}

test('an authenticated account with incomplete contact details stays on My without a forced profile wizard', async () => {
  const h = harness({ phoneLoginEnabled: false }), page = h.page('my/index/my_index.js');
  h.user.USER_PROFILE_COMPLETE = false; h.user.USER_STATUS = 0; h.user.allowManualRegistration = true;
  page._visible = true;
  await page._loadUser();
  assert.equal(page.data.user.USER_NAME, '小周');
  assert.equal(h.navigation.length, 0);
});

test('incomplete accounts can open personal settings and reach logout without being redirected', async () => {
  const h = harness({ phoneLoginEnabled: false }), page = h.page('my/personal/my_personal.js');
  h.user.USER_PROFILE_COMPLETE = false; h.user.USER_STATUS = 0; h.user.allowManualRegistration = true;
  await page.onLoad();
  assert.equal(page.data.isLoad, true); assert.equal(page.data.hasSession, true);
  assert.equal(h.navigation.length, 0);
});

test('My exposes logout immediately, clears identity caches, and revokes the session', async () => {
  const h = harness({ realPassport: true, phoneLoginEnabled: false }), page = h.page('my/index/my_index.js');
  h.responses['passport/logout'] = { ok: true };
  h.storage.set('crun-profile-user-v1:poster:old-campus', { value: h.user });
  h.storage.set('ORDER-MAIL-MINE_LIST', { list: [{ contact: '私有订单' }] });
  page.setData({ user: h.user });
  assert.equal(typeof page.bindLogoutTap, 'function');
  await page.bindLogoutTap(); await tick();
  assert.equal(h.passport.getToken(), null);
  assert.equal(h.storage.has('crun-profile-user-v1:poster:old-campus'), false);
  assert.equal(h.storage.has('ORDER-MAIL-MINE_LIST'), false);
  assert.equal(page.data.user, null);
  assert.ok(h.navigation.some(item => item.type === 'relaunch' && item.url.endsWith('/my/index/my_index')));
});

test('cancellation succeeds only after the server accepts it and then signs out immediately', async () => {
  const h = harness({ realPassport: true, phoneLoginEnabled: false }), page = h.page('my/index/my_index.js');
  const pending = deferred(), now = Date.now();
  h.responses['passport/cancel'] = () => pending.promise;
  page.setData({ user: h.user });
  assert.equal(typeof page.bindCancelAccountTap, 'function');
  const task = page.bindCancelAccountTap(); await tick();
  assert.ok(h.passport.getToken(), 'account stays available until cancellation is confirmed');
  pending.resolve({ requestedAt: now, cancelAt: now + 7200000 });
  await task; await tick();
  assert.equal(h.passport.getToken(), null); assert.equal(page.data.user, null);
  assert.equal(h.storage.get('CACHE_CANCELLATION').cancelAt, now + 7200000);
});

test('unfinished-order rejection leaves the user logged in and reports the server reason', async () => {
  const h = harness({ realPassport: true, phoneLoginEnabled: false }), page = h.page('my/index/my_index.js');
  h.responses['passport/cancel'] = () => { throw new Error('还有未完成的发单或接单'); };
  assert.equal(typeof page.bindCancelAccountTap, 'function');
  await page.bindCancelAccountTap(); await tick();
  assert.ok(h.passport.getToken());
  assert.ok(h.messages.some(message => /未完成/.test(message)));
  assert.equal(h.navigation.length, 0);
});

test('confirming the login sheet saves the native nickname and avatar then opens personal details', async () => {
  const h = harness({ realPassport: true, guest: true, phoneLoginEnabled: false, uploadAvatar: () => 'cloud://test/new-avatar.jpg' });
  const page = h.page('my/reg/my_reg.js'); await page.onLoad();
  page.bindOpenWechatProfile();
  page.bindPicTap({ detail: { avatarUrl: 'wxfile://tmp/avatar.jpg' } });
  page.setData({ formName: '失焦前缓存' });
  h.responses['passport/wechat_identity_login'] = { token: { id: 'poster', sessionToken: 'b'.repeat(64), status: 0, profileComplete: false, phoneVerified: false, allowManualRegistration: true },
    user: { USER_STATUS: 0, USER_NAME: '', USER_PIC: '', USER_PROFILE_COMPLETE: false, USER_MOBILE_VERIFIED: false, allowManualRegistration: true, phoneLoginEnabled: false } };
  h.responses['passport/wechat_profile'] = { token: { id: 'poster', sessionToken: 'b'.repeat(64), name: '微信最终昵称', pic: 'cloud://test/new-avatar.jpg', status: 0, profileComplete: false, phoneVerified: false, allowManualRegistration: true } };
  await page.bindConfirmWechatProfile({ detail: { value: { nickname: '微信最终昵称' } } });
  const save = h.calls.find(call => call.route === 'passport/wechat_profile');
  assert.ok(save); assert.equal(save.params.name, '微信最终昵称');
  assert.equal(save.params.pic, 'cloud://test/new-avatar.jpg');
  assert.ok(h.navigation.some(item => item.type === 'redirect' && item.url.endsWith('/my/personal/my_personal')));
  assert.equal(h.calls.filter(call => /passport\/(register|edit_base|wechat_login)$/.test(call.route)).length, 0);
});

test('the WeChat login button opens one profile sheet; cancelling it makes no login request', async () => {
  const h = harness({ realPassport: true, phoneLoginEnabled: false }); h.passport.logout();
  const page = h.page('my/reg/my_reg.js'); await page.onLoad(); h.calls.length = 0;
  page.bindOpenWechatProfile(); page.bindOpenWechatProfile();
  assert.equal(page.data.wechatProfileVisible, true);
  page.bindPicTap({ detail: { avatarUrl: 'wxfile://tmp/avatar.jpg' } });
  assert.equal(page.data.formPic, 'wxfile://tmp/avatar.jpg', 'the native avatar chooser works after an explicit logout');
  page.bindCloseWechatProfile();
  assert.equal(page.data.wechatProfileVisible, false); assert.equal(h.calls.length, 0);
  assert.equal(h.passport.isLoggedOut(), true); assert.equal(h.navigation.length, 0);
});

test('the login sheet requires both native fields and uses the final submitted nickname', async () => {
  const h = harness({ realPassport: true, guest: true, phoneLoginEnabled: false }), page = h.page('my/reg/my_reg.js');
  await page.onLoad(); page.bindOpenWechatProfile(); h.calls.length = 0;
  await page.bindConfirmWechatProfile(event({}, { nickname: '同学' }));
  assert.match(page.data.loginError, /头像/);
  page.bindPicTap({ detail: { avatarUrl: 'wxfile://tmp/avatar.jpg' } });
  page.setData({ formName: '旧昵称' });
  await page.bindConfirmWechatProfile(event({}, { nickname: '' }));
  assert.match(page.data.loginError, /昵称/); assert.equal(h.calls.length, 0); assert.equal(h.navigation.length, 0);
});

test('cancelling personal logout preserves the session and unsaved profile', async () => {
  const h = harness({ realPassport: true, confirm: false }), page = h.page('my/personal/my_personal.js');
  await page.onLoad();
  page.bindProfileNameInput(event({}, '未保存的昵称'));
  const previous = structuredClone(h.token), calls = h.calls.length;
  page.bindLogoutTap();
  assert.deepEqual(h.token, previous);
  assert.equal(page.data.formName, '未保存的昵称');
  assert.equal(page.data.loggingOut, false);
  assert.equal(h.calls.length, calls);
  assert.equal(h.navigation.length, 0);
});

test('personal logout clears local identity and profile while the my page stays signed out', async () => {
  const h = harness({ realPassport: true }), page = h.page('my/personal/my_personal.js');
  await page.onLoad();
  const methods = h.load(pages + 'my/profile_methods.js');
  assert.ok(methods.getCachedProfileUser());
  h.storage.set('crun-draft-example', { title: '保留草稿' });
  h.calls.length = 0;
  page.bindLogoutTap();
  assert.equal(h.token, null);
  assert.equal(methods.getCachedProfileUser(), null);
  assert.ok(!Array.from(h.storage.keys()).some(key => key.startsWith('crun-profile-user-v1:')));
  assert.equal(h.storage.has('crun-draft-example'), false);
  assert.equal(h.navigation.at(-1).type, 'relaunch');
  assert.equal(h.navigation.at(-1).url, '/projects/crun/pages/my/index/my_index');
  const my = h.page('my/index/my_index.js');
  my.onLoad(); await my.onShow(); await my.onPullDownRefresh(); my.onHide();
  assert.equal(my.data.user, null);
  assert.equal(my.data.isLogin, false);
  assert.ok(!h.calls.some(call => /^passport\//.test(call.route) && call.route !== 'passport/logout'));
});

test('personal logout is available when profile loading fails offline', async () => {
  const h = harness({ realPassport: true }), page = h.page('my/personal/my_personal.js');
  h.responses['passport/my_detail'] = () => { throw new Error('offline'); };
  await page.onLoad();
  assert.ok(page.data.loadError);
  assert.equal(page.data.hasSession, true);
  page.bindLogoutTap();
  assert.equal(h.passport.isLogin(), false);
  assert.equal(h.navigation.at(-1).type, 'relaunch');
});

test('logout waits for profile writes and opens only one confirmation at a time', () => {
  const h = harness({ realPassport: true }), page = h.page('my/personal/my_personal.js');
  const dialogs = [];
  h.wx.showModal = dialog => dialogs.push(dialog);
  for (const field of ['saving', 'phoneAuthorizing']) {
    page.setData({ [field]: true }); page.bindLogoutTap(); page.setData({ [field]: false });
  }
  assert.equal(dialogs.length, 0);
  page.bindLogoutTap(); page.bindLogoutTap();
  assert.equal(dialogs.length, 1);
  dialogs[0].success({ confirm: false });
  assert.equal(h.passport.isLogin(), true);
  page.bindLogoutTap(); assert.equal(dialogs.length, 2);
});

test('a profile reply arriving after logout cannot reopen a login page or expose the old user', async () => {
  const h = harness({ realPassport: true }), page = h.page('my/personal/my_personal.js'), pending = deferred();
  await page.onLoad();
  h.responses['passport/my_detail'] = () => pending.promise;
  const loading = page._loadDetail();
  page.bindLogoutTap();
  pending.resolve(h.user); await loading;
  assert.equal(page.data.user, null);
  assert.equal(h.navigation.length, 1);
  assert.equal(h.navigation[0].type, 'relaunch');
});

test('profile save and phone authorization cannot start while logout confirmation is open', async () => {
  const h = harness({ realPassport: true }), page = h.page('my/personal/my_personal.js');
  await page.onLoad();
  h.wx.showModal = () => {};
  h.responses['passport/wechat_login'] = { token: { ...h.token }, user: h.user };
  page.bindLogoutTap(); h.calls.length = 0;
  await page.bindSubmitTap();
  await page.bindWechatPhone({ detail: { errMsg: 'getPhoneNumber:ok', code: 'queued-code' } });
  assert.deepEqual(h.calls.map(call => call.route), []);
  assert.equal(h.navigation.length, 0);
});

test('opening and refreshing login after logout stays signed out until the explicit WeChat button is tapped', async () => {
  const h = harness({ realPassport: true, phoneLoginEnabled: false });
  h.user.USER_MOBILE_VERIFIED = false; h.user.allowManualRegistration = true;
  h.responses['passport/login'] = { token: { id: 'poster', sessionToken: 'b'.repeat(64), name: '小周', status: 1, phoneVerified: false, allowManualRegistration: true, profileComplete: true } };
  h.responses['passport/wechat_identity_login'] = { ...h.responses['passport/login'], user: h.user };
  h.passport.logout();
  const page = h.page('my/reg/my_reg.js');
  await page.onLoad();
  await page.onPullDownRefresh();
  assert.equal(h.passport.isLoggedOut(), true);
  assert.equal(page.data.hasSession, false);
  assert.equal(page.data.isLoad, true);
  assert.equal(h.navigation.length, 0);
  assert.equal(h.calls.filter(call => /^passport\//.test(call.route)).length, 0);
  await page.bindWechatAccountLogin();
  assert.equal(h.passport.isLogin(), true);
  assert.equal(page.data.formName, '小周');
  assert.equal(page.data.formMobile, '13800000000');
  assert.equal(page.data.contacts[1].name, '乙');
  assert.equal(page.data.hasSession, true);
  assert.equal(h.navigation.at(-1).url, '/projects/crun/pages/my/personal/my_personal');
  assert.ok(!h.calls.some(call => call.route === 'passport/register'));
});

test('an explicit login failure retains logout and retries only on another button tap', async () => {
  const h = harness({ realPassport: true, phoneLoginEnabled: false });
  h.passport.logout();
  h.responses['passport/wechat_identity_login'] = () => { throw new Error('offline'); };
  const page = h.page('my/reg/my_reg.js'); await page.onLoad();
  assert.equal(page.data.loginError, '');
  await page.bindWechatAccountLogin();
  assert.ok(page.data.loginError);
  assert.equal(h.passport.isLoggedOut(), true);
  assert.ok(!h.calls.some(call => call.route === 'passport/my_detail'));
  h.responses['passport/wechat_identity_login'] = { token: { id: 'poster', sessionToken: 'b'.repeat(64), status: 1, phoneVerified: true, profileComplete: true }, user: h.user };
  await page._loadDetail();
  assert.equal(h.passport.isLoggedOut(), true);
  assert.equal(h.calls.filter(call => call.route === 'passport/wechat_identity_login').length, 1);
  await page.bindWechatAccountLogin();
  assert.equal(h.passport.isLogin(), true);
  assert.equal(page.data.loginError, '');
});

test('basic WeChat login accepts a new account without native phone capability', async () => {
  const h = harness({ guest: true, realPassport: true, phoneLoginEnabled: false });
  h.wx.canIUse = capability => !capability.includes('getPhoneNumber');
  const account = { USER_NAME: '', USER_MOBILE: '', USER_PIC: '', USER_FORMS: [], USER_STATUS: 0,
    USER_MOBILE_VERIFIED: false, USER_PROFILE_COMPLETE: false, allowManualRegistration: true, phoneLoginEnabled: false };
  h.responses['passport/wechat_identity_login'] = { token: { id: 'poster', sessionToken: 'b'.repeat(64), status: 0, phoneVerified: false, profileComplete: false, allowManualRegistration: true }, user: account };
  const page = h.page('my/reg/my_reg.js'); await page.onLoad();
  assert.equal(h.calls.filter(call => /^passport\//.test(call.route)).length, 0);
  await page.bindWechatAccountLogin();
  assert.equal(h.passport.getUserId(), 'poster');
  assert.equal(page.data.hasSession, true);
  assert.equal(page.data.formMobile, '');
  assert.equal(page.data.phoneVerified, false);
  assert.equal(page.data.accountStatus, 0);
  assert.equal(h.navigation.length, 1);
  assert.equal(h.navigation[0].url, '/projects/crun/pages/my/personal/my_personal');
  assert.deepEqual(h.calls.filter(call => /^passport\//.test(call.route)).map(call => call.route), ['passport/wechat_identity_login']);
});

test('optional campus configuration failure does not block explicit basic login', async () => {
  const h = harness({ guest: true, realPassport: true, phoneLoginEnabled: false });
  h.responses['operations/config'] = () => { throw Error('校区加载失败'); };
  h.responses['passport/wechat_identity_login'] = {
    token: { id: 'poster', sessionToken: 'b'.repeat(64), status: 0, phoneVerified: false, profileComplete: false, allowManualRegistration: true },
    user: { USER_NAME: '', USER_MOBILE: '', USER_PIC: '', USER_FORMS: [], USER_STATUS: 0,
      USER_MOBILE_VERIFIED: false, USER_PROFILE_COMPLETE: false, allowManualRegistration: true, phoneLoginEnabled: false }
  };
  h.passport.logout();
  const page = h.page('my/reg/my_reg.js'); await page.onLoad();
  assert.equal(page.data.isLoad, true);
  assert.equal(page.data.hasSession, false);
  assert.ok(page.data.campusError);
  assert.equal(h.calls.filter(call => /^passport\//.test(call.route)).length, 0);
  await page.bindWechatAccountLogin();
  assert.equal(page.data.hasSession, true);
  assert.equal(h.passport.getUserId(), 'poster');
  assert.equal(page.data.loginError, '');
  assert.deepEqual(h.calls.filter(call => /^passport\//.test(call.route)).map(call => call.route), ['passport/wechat_identity_login']);
});

test('delayed legacy configuration cannot enable manual signup from the default login screen', async () => {
  const h = harness({ guest: true, realPassport: true, manualRegistration: true }), config = deferred();
  const configured = structuredClone(h.responses['operations/config']);
  h.responses['operations/config'] = () => config.promise;
  const page = h.page('my/reg/my_reg.js');
  // A fresh production page defaults to basic login before fetching policy.
  page.data.phoneLoginEnabled = false;
  const loading = page.onLoad(); await tick();
  assert.equal(page.data.isLoad, true);
  assert.equal(h.calls.filter(call => /^passport\//.test(call.route)).length, 0);
  config.resolve(configured); await loading;
  assert.notEqual(page.data.manualRegistration, true);
  assert.equal(page.data.hasSession, false);
  assert.deepEqual(Array.from(page.data.genderOptions || []), ['男', '女']);
  assert.equal(page.data.formName, '');
  assert.equal(page.data.formMobile, '');
  await page.bindSubmitTap();
  assert.match(page.data.saveError, /微信.*登录/);
  assert.equal(h.calls.filter(call => /^passport\//.test(call.route)).length, 0);
});

test('basic login coalesces taps and does not let refresh or late replies undo the login', async () => {
  const h = harness({ realPassport: true, phoneLoginEnabled: false }), response = deferred();
  h.passport.logout();
  h.responses['passport/wechat_identity_login'] = () => response.promise;
  const page = h.page('my/reg/my_reg.js'); await page.onLoad({ retUrl: 'back' });
  const first = page.bindWechatAccountLogin();
  await page.bindWechatAccountLogin(); await page._loadDetail();
  assert.equal(h.calls.filter(call => call.route === 'passport/wechat_identity_login').length, 1);
  assert.equal(page.data.identityLoggingIn, true);
  response.resolve({ token: { id: 'poster', sessionToken: 'b'.repeat(64), status: 1, phoneVerified: true, profileComplete: true }, user: h.user });
  await first;
  assert.equal(page.data.identityLoggingIn, false);
  assert.equal(h.navigation.at(-1).url, '/projects/crun/pages/my/personal/my_personal?retUrl=back');
});

test('disabled native phone handlers never request the provider from login or personal pages', async () => {
  const h = harness({ realPassport: true, phoneLoginEnabled: false });
  h.responses['passport/wechat_login'] = { token: h.token, user: h.user };
  const reg = h.page('my/reg/my_reg.js'), personal = h.page('my/personal/my_personal.js');
  const native = { detail: { errMsg: 'getPhoneNumber:ok', code: 'must-not-send' } };
  await reg.bindWechatLogin(native); await personal.bindWechatPhone(native);
  assert.equal(h.calls.length, 0);
});

test('basic mode permits editing a formerly verified contact number without authorizing a phone', async () => {
  const h = harness({ realPassport: true, phoneLoginEnabled: false }), page = h.page('my/personal/my_personal.js');
  await page.onLoad();
  page.bindProfileMobileInput(event({}, '13912345678'));
  assert.equal(page.data.formMobile, '13912345678');
  h.responses['passport/edit_base'] = { token: { ...h.token, phoneVerified: false, allowManualRegistration: true } };
  await page.bindSubmitTap();
  assert.equal(h.calls.find(call => call.route === 'passport/edit_base').params.mobile, '13912345678');
  assert.equal(h.passport.getToken().phoneVerified, false);
  assert.ok(!h.calls.some(call => call.route === 'passport/wechat_login'));
});

test('custom campus selection previews a choice, cancels cleanly, and commits only a valid option', async () => {
  const h = harness(), page = h.page('my/personal/my_personal.js');
  await readyProfile(h, page);
  page.applyUser(page, h.user);
  page.bindOpenCampusPicker(); page.bindSelectCampus(event({ value: '王城校区' }));
  assert.equal(page.data.campus, '育才校区');
  page.applyUser(page, { ...h.user, USER_NAME: '后台刷新' });
  assert.equal(page.data.campusPickerVisible, true);
  page.bindCloseCampusPicker(); assert.equal(page.data.campus, '育才校区');
  page.bindOpenCampusPicker(); page.bindSelectCampus(event({ value: '不存在的校区' }));
  assert.equal(page.data.campusDraft, '育才校区');
  page.bindSelectCampus(event({ value: '王城校区' })); page.bindConfirmCampus();
  assert.equal(page.data.campus, '王城校区'); assert.equal(page.data.campusIndex, 1); assert.equal(page.data.campusPickerVisible, false);
  page.applyUser(page, h.user); assert.equal(page.data.campus, '王城校区');
  assert.ok(!/<picker\b/.test(fs.readFileSync(path.join(root, pages, 'my/personal/personal_form.wxml'), 'utf8')));
});

test('saving personal information persists the selected campus and preserves other saved fields', async () => {
  const h = harness(), page = h.page('my/personal/my_personal.js');
  await readyProfile(h, page);
  h.user.USER_FORMS.push({ mark: 'payPic', type: 'image', val: ['cloud://existing'] });
  page.applyUser(page, h.user); page.bindOpenCampusPicker(); page.bindSelectCampus(event({ value: '雁山校区' })); page.bindConfirmCampus();
  await page.bindSubmitTap();
  const saved = h.calls.find(call => call.route === 'passport/edit_base').params;
  assert.equal(saved.forms.find(item => item.mark === 'campus').val, '雁山校区');
  assert.deepEqual(saved.forms.find(item => item.mark === 'payPic').val, ['cloud://existing']);
  assert.equal(h.navigation.at(-1).type, 'tab');
  assert.equal(page.data.saving, false);
});

test('editing cached personal information is not overwritten by a background response', () => {
  const h = harness(), page = h.page('my/personal/my_personal.js'); page.applyUser(page, h.user);
  page.bindProfileNameInput(event({}, '新姓名')); page.applyUser(page, h.user);
  assert.equal(page.data.formName, '新姓名');
});

for (const [kind, label, draft] of [
  ['contact', 'Contact', { name: '乙的新姓名', phone: '13800000003' }],
  ['address', 'Address', { label: '三期', detail: '三栋' }]
]) {
  test(kind + ' editor retains drafts on save failure and preserves the default flag after retry', async () => {
    const h = harness(), page = h.page('my/' + kind + '/' + kind + '.js'); await readyProfile(h, page); page.applyUser(page, h.user);
    page['bindEdit' + label](event({ index: 1 })); page.setData({ [kind + 'Draft']: draft });
    h.responses['passport/edit_base'] = () => { throw new Error('网络中断'); };
    assert.equal(await page['bindSave' + label](), false);
    assert.equal(page.data[kind + 'EditorVisible'], true);
    assert.equal(page.data.collectionSaving, false);
    h.responses['passport/edit_base'] = { ok: true };
    assert.equal(await page['bindSave' + label](), true);
    assert.equal(page.data[kind + 'EditorVisible'], false);
    const list = kind === 'contact' ? page.data.contacts : page.data.addresses;
    assert.equal(list[1].isDefault, true);
    page['bindAdd' + label](); page['bindCancel' + label]();
    assert.equal(page.data[kind + 'EditorVisible'], false);
    assert.equal(h.calls.filter(call => call.route === 'passport/edit_base').length, 2);
  });
}

test('collection saves coalesce repeated taps and do not discard an editor before the request completes', async () => {
  const h = harness(), page = h.page('my/contact/contact.js'); page.applyUser(page, h.user);
  page.bindEditContact(event({ index: 0 })); const pending = deferred(); h.responses['passport/edit_base'] = () => pending.promise;
  const first = page.bindSaveContact(); await page.bindSaveContact(); page.bindCancelContact();
  assert.equal(page.data.contactEditorVisible, true); assert.equal(h.calls.length, 1);
  pending.resolve({ ok: true }); await first; assert.equal(page.data.contactEditorVisible, false);
});

test('deleting a preceding contact keeps the current edit attached to the same person', async () => {
  const h = harness(), page = h.page('my/contact/contact.js'); page.applyUser(page, h.user);
  page.bindEditContact(event({ index: 1 }));
  await page.bindDeleteContact(event({ index: 0 }));
  assert.equal(page.data.editingContactIndex, 0);
  page.bindContactInput(event({ field: 'name' }, '乙的新姓名')); await page.bindSaveContact();
  assert.equal(page.data.contacts.length, 1); assert.equal(page.data.contacts[0].name, '乙的新姓名');
});

test('every personal-center entry reaches its intended destination and private entries respect login cancellation', async () => {
  const routes = {
    bindMyFeedbackTap: 'feedback/my_list/feedback_my_list', bindMyReviewTap: 'my/review/my_review', bindMyFavTap: 'my/fav/my_fav',
    bindMessagesTap: 'operations/operations', bindFeedbackTap: 'feedback/index/feedback_index', bindInviteTap: 'invite/index/invite_index',
    bindProfileContactTap: 'my/contact/contact', bindProfileAddressTap: 'my/address/address'
  };
  const h = harness(), page = h.page('my/index/my_index.js');
  for (const [handler, route] of Object.entries(routes)) { await page[handler](); assert.equal(h.navigation.at(-1).url, '/projects/crun/pages/' + route); }
  page.bindCampusServiceTap(); assert.match(h.navigation.at(-1).url, /campus_service_list$/);
  page.bindAboutTap(); assert.match(h.navigation.at(-1).url, /about_index$/);
  const denied = harness({ allowed: false }), guest = denied.page('my/index/my_index.js');
  for (const handler of Object.keys(routes)) await guest[handler]();
  assert.equal(denied.navigation.length, 0);
});

test('settings clears cached profile data while keeping login, drafts and pending requests', async () => {
  const h = harness(), page = h.page('my/index/my_index.js'), methods = h.load(pages + 'my/profile_methods.js');
  const preserved = ['CACHE_TOKEN', 'CACHE_TOKEN_deadtime', 'ADMIN_TOKEN', 'crun-home-quick-drafts:poster', 'crun-pending:poster:feedback/insert:new', 'crun-pending-invite'];
  for (const key of preserved) h.storage.set(key, { saved: true });
  await methods.getProfileUser(); await methods.getProfileUser();
  assert.equal(h.calls.length, 1);
  page.bindSetTap(); assert.equal(page.data.settingsVisible, true); page.bindClearCacheTap();
  assert.equal(page.data.settingsVisible, false);
  for (const key of preserved) assert.deepEqual(h.storage.get(key), { saved: true }, key);
  assert.equal(h.storage.has('crun-profile-user-v1:poster'), false);
  await methods.getProfileUser(); assert.equal(h.calls.length, 2);
  page.bindAdminTap(); assert.match(h.navigation.at(-1).url, /admin_login$/);
  const admin = harness({ admin: true }), adminPage = admin.page('my/index/my_index.js'); adminPage.bindAdminTap();
  assert.match(admin.navigation.at(-1).url, /admin_home$/);
});

test('clearing caches prevents older requests from restoring stale profile and campus entries', async () => {
  const h = harness(), page = h.page('my/personal/my_personal.js'), profile = deferred(), campuses = deferred();
  h.responses['passport/my_detail'] = () => profile.promise; h.responses['operations/config'] = () => campuses.promise;
  const oldProfile = page.getProfileUser(), oldCampuses = page.loadCampuses(page);
  page.clearLocalCaches();
  profile.resolve(h.user); campuses.resolve({ campuses: ['育才校区'] });
  await Promise.all([oldProfile, oldCampuses]);
  assert.equal(h.storage.has('crun-profile-user-v1:poster'), false);
  assert.equal(h.storage.has('crun-profile-campuses-v1:shared'), false);
});

test('profile completion keeps the returned login token, binds the invitation, and returns to the requesting page', async () => {
  const h = harness({ guest: true }), page = h.page('my/reg/my_reg.js');
  h.passport.setToken({ id: 'poster', sessionToken: 'b'.repeat(64), status: 0, phoneVerified: true, profileComplete: false });
  await readyProfile(h, page);
  page.applyUser(page, h.user); page.setData({ inviteCode: 'abcdef', retUrl: 'back' });
  await page.bindSubmitTap();
  assert.equal(h.token.id, 'poster');
  assert.deepEqual(h.calls.map(call => call.route), ['passport/register', 'invite/accept']);
  assert.equal(h.calls[1].params.code, 'ABCDEF');
  assert.equal(h.navigation.at(-1).type, 'back');
});

test('profile completion requiring review does not grant an active login token', async () => {
  const h = harness({ guest: true }), page = h.page('my/reg/my_reg.js'); await readyProfile(h, page); page.applyUser(page, h.user);
  h.passport.setToken({ id: 'poster', sessionToken: 'b'.repeat(64), status: 0, phoneVerified: true, profileComplete: false });
  h.responses['passport/register'] = { token: { id: 'poster', sessionToken: 'b'.repeat(64), status: 0, phoneVerified: true, profileComplete: true } };
  await page.bindSubmitTap(); assert.equal(h.token.status, 0); assert.ok(h.messages.includes('资料已提交，等待审核'));
  assert.equal(h.navigation.at(-1).url, '/projects/crun/pages/my/index/my_index');
});

for (const message of ['「学院」未通过微信文字审核，请修改该字段后重试', '微信文字审核服务暂无调用权限，请联系管理员检查服务配置（错误码：48001）']) {
  test('profile completion displays the specific audit error and retains the editable draft: ' + message, async () => {
    const h = harness({ guest: true }), page = h.page('my/reg/my_reg.js');
    h.passport.setToken({ id: 'poster', sessionToken: 'b'.repeat(64), status: 0, phoneVerified: true, profileComplete: false });
    await readyProfile(h, page); page.applyUser(page, h.user);
    h.responses['passport/register'] = () => { throw { code: 1600, msg: message }; };
    await page.bindSubmitTap();
    assert.equal(page.data.saveError, message); assert.ok(h.messages.includes(message));
    assert.equal(page.data.formName, h.user.USER_NAME); assert.equal(page.data.profileCollege, '计算机学院');
    assert.equal(page.data.saving, false); assert.equal(h.navigation.length, 0); assert.equal(h.token.profileComplete, false);
  });
}

const manualToken = { id: 'poster', sessionToken: 'b'.repeat(64), name: '手填昵称', status: 1, phoneVerified: false, profileComplete: true, allowManualRegistration: true };
test('unsupported profile capabilities still allow profile completion after explicit WeChat login', async () => {
  const h = harness({ guest: true, realPassport: true, phoneLoginEnabled: false });
  h.wx.canIUse = () => false;
  h.wx.chooseMedia = () => assert.fail('an unavailable modern image picker must fall back to chooseImage');
  h.responses['passport/my_detail'] = null;
  h.responses['passport/register'] = { token: manualToken };
  h.responses['passport/login'] = { token: manualToken };
  h.responses['passport/wechat_identity_login'] = { token: { ...manualToken, status: 0, profileComplete: false, phoneLoginEnabled: false },
    user: { USER_NAME: '', USER_MOBILE: '', USER_PIC: '', USER_FORMS: [], USER_STATUS: 0,
      USER_PROFILE_COMPLETE: false, USER_MOBILE_VERIFIED: false, allowManualRegistration: true, phoneLoginEnabled: false } };
  const page = h.page('my/reg/my_reg.js'); await page.onLoad({ retUrl: 'back' });
  assert.equal(page.data.allowManualRegistration, true);
  assert.equal(page.data.hasSession, false);
  await page.bindWechatAccountLogin();
  assert.equal(page.data.hasSession, true);
  assert.equal(page.data.canUseWechatNickname, false);
  assert.equal(page.data.canChooseWechatAvatar, false);
  page.bindProfileNameInput(event({}, '手填昵称'));
  page.bindProfileMobileInput(event({}, '13912345678'));
  assert.equal(typeof page.bindChooseAvatar, 'function');
  page.bindChooseAvatar();
  page.bindGenderTap(event({ value: '女' }));
  page.bindProfileFieldInput(event({ field: 'profileCollege' }, '计算机学院'));
  page.bindProfileFieldInput(event({ field: 'profileSub' }, '软件工程'));
  page.bindCampusChange(event({}, 0));
  await page.bindSubmitTap();
  assert.equal(page.data.saveError, '');
  assert.equal(h.images.length, 1);
  assert.equal(h.calls.find(call => call.route === 'passport/register').params.mobile, '13912345678');
  assert.equal(h.calls.filter(call => /wechat_login|passport\/phone/.test(call.route)).length, 0);
  assert.equal(h.token.phoneVerified, false);
  assert.equal(await h.passport.loginMustCancelWin(), true);
  assert.equal(h.navigation.at(-1).type, 'back');
});

test('manual avatar selection supports the modern picker and keeps the current image on cancellation', () => {
  const h = harness({ manualRegistration: true }), page = h.page('my/personal/my_personal.js');
  let picker;
  h.wx.chooseMedia = options => { picker = options; options.success({ tempFiles: [{ tempFilePath: 'temp/manual-avatar.jpg' }] }); };
  assert.equal(typeof page.bindChooseAvatar, 'function'); page.bindChooseAvatar();
  assert.equal(page.data.formPic, 'temp/manual-avatar.jpg');
  assert.equal(picker.count, 1);
  assert.equal(h.images.length, 0);
  h.wx.chooseMedia = options => options.fail({ errMsg: 'chooseMedia:fail cancel' });
  page.bindChooseAvatar();
  assert.equal(page.data.formPic, 'temp/manual-avatar.jpg');
  assert.equal(h.messages.length, 0);
});

test('retired manual entry cannot submit a profile before WeChat login', async () => {
  const h = harness({ guest: true, manualRegistration: true }); h.responses['passport/my_detail'] = null;
  const page = h.page('my/reg/my_reg.js'); await page.onLoad({});
  page.setData({ formName: '手填昵称', formMobile: '13912345678', formPic: 'cloud://avatar',
    campus: '育才校区', profileSex: '女', profileCollege: '计算机学院', profileSub: '软件工程' });
  await page.bindSubmitTap();
  assert.match(page.data.saveError, /微信.*登录/);
  assert.equal(page.data.hasSession, false);
  assert.equal(page.data.phoneVerified, false);
  assert.equal(h.calls.filter(call => /^passport\/(?:register|wechat_login)$/.test(call.route)).length, 0);
});

for (const detail of [{ errMsg: 'getPhoneNumber:fail', errno: 102 }, { errMsg: 'getPhoneNumber:fail not support' }]) {
  test('unavailable phone authorization never falls back to manual signup: ' + JSON.stringify(detail), async () => {
    const h = harness({ guest: true, realPassport: true, manualRegistration: true }); h.responses['passport/my_detail'] = null;
    const page = h.page('my/reg/my_reg.js'); await page.onLoad({});
    page.bindProfileNameInput(event({}, '保留草稿')); page.bindProfileMobileInput(event({}, '13912345678'));
    await page.bindWechatLogin({ detail });
    assert.notEqual(page.data.manualRegistration, true);
    assert.equal(page.data.hasSession, false);
    assert.equal(page.data.phoneAuthorizing, false);
    assert.equal(page.data.phoneVerified, false);
    assert.equal(page.data.formName, '保留草稿');
    assert.equal(page.data.formMobile, '13912345678');
    assert.doesNotMatch(page.data.loginError, /手动/);
    assert.ok(page.data.loginError);
    assert.equal(h.calls.filter(call => call.route === 'passport/wechat_login').length, 0);
  });
}

test('strict mode and old configurations do not offer manual registration after native failures', async () => {
  const h = harness({ guest: true, realPassport: true }); h.responses['passport/my_detail'] = null;
  const page = h.page('my/reg/my_reg.js'); await page.onLoad({});
  await page.bindWechatLogin({ detail: { errMsg: 'getPhoneNumber:fail', errno: 102 } });
  assert.notEqual(page.data.manualRegistration, true);
  assert.equal(page.data.hasSession, false);
  assert.equal(page.data.phoneVerified, false);
  assert.match(page.data.loginError, /权限|管理员/);
  await page.bindSubmitTap();
  assert.equal(h.calls.filter(call => call.route === 'passport/register').length, 0);
});

for (const allowed of [true, false]) {
  test('delayed server policy cannot enable manual signup after a phone failure: legacy allowed=' + allowed, async () => {
    const h = harness({ guest: true, realPassport: true, manualRegistration: allowed });
    const pending = deferred(), config = h.responses['operations/config'];
    h.responses['operations/config'] = () => pending.promise; h.responses['passport/my_detail'] = null;
    const page = h.page('my/reg/my_reg.js'), loading = page.onLoad({}); await tick();
    assert.equal(page.data.isLoad, true);
    assert.equal(page.data.allowManualRegistration, false);
    await page.bindWechatLogin({ detail: { errMsg: 'getPhoneNumber:fail no permission', errno: 102 } });
    assert.notEqual(page.data.manualRegistration, true);
    pending.resolve(config); await loading;
    assert.notEqual(page.data.manualRegistration, true);
    assert.equal(page.data.hasSession, false);
    assert.equal(page.data.phoneVerified, false);
    assert.match(page.data.loginError, /权限|管理员/);
    assert.equal(h.calls.filter(call => call.route === 'passport/wechat_login').length, 0);
  });
}

test('manual registration policy survives shared cache reads and is revoked by fresh configuration', async () => {
  const h = harness({ guest: true, manualRegistration: true });
  const first = h.page('my/reg/my_reg.js'); await readyProfile(h, first);
  const second = h.page('my/reg/my_reg.js'); await readyProfile(h, second);
  assert.equal(second.data.allowManualRegistration, true);
  h.responses['operations/config'].allowManualRegistration = false;
  await second.loadCampuses(second, true);
  assert.equal(second.data.allowManualRegistration, false);
});

test('manual accounts remain on their personal pages instead of looping back to phone authorization', async () => {
  const h = harness({ realPassport: true, manualRegistration: true });
  Object.assign(h.user, { USER_MOBILE_VERIFIED: false, allowManualRegistration: true });
  h.passport.setToken(manualToken); h.responses['passport/login'] = { token: manualToken };
  const page = h.page('my/personal/my_personal.js'); await page.onLoad();
  assert.equal(page.data.isLoad, true);
  assert.equal(page.data.phoneVerified, false);
  assert.equal(page.data.allowManualRegistration, true);
  const center = h.page('my/index/my_index.js'); center.onLoad(); await center.onShow();
  assert.equal(h.navigation.length, 0);
  assert.equal(center.data.user.allowManualRegistration, true);
  center.onUnload();
});

test('WeChat profile completion recovers a lost save response before returning to the original feature', async () => {
  const h = harness({ guest: true, realPassport: true, phoneLoginEnabled: false });
  Object.assign(h.user, { USER_MOBILE_VERIFIED: false, allowManualRegistration: true });
  h.passport.setToken({ ...manualToken, profileComplete: false, status: 0 });
  const page = h.page('my/reg/my_reg.js'); await readyProfile(h, page);
  page.applyUser(page, { ...h.user, USER_PROFILE_COMPLETE: false });
  page.setData({ retUrl: '/projects/crun/pages/mail/add/mail_add' });
  h.responses['passport/register'] = () => { throw Error('回包丢失'); };
  await page.bindSubmitTap();
  assert.match(page.data.saveError, /回包丢失/);
  assert.equal(h.token.profileComplete, false);
  h.responses['passport/login'] = { token: manualToken };
  await page._loadDetail();
  assert.equal(h.passport.isLogin(), true);
  assert.equal(h.navigation.at(-1).url, '/projects/crun/pages/my/personal/my_personal?retUrl=' + encodeURIComponent('/projects/crun/pages/mail/add/mail_add'));
});

test('a phone authorization retry keeps drafts and applies the verified phone', async () => {
  const h = harness({ guest: true, realPassport: true, manualRegistration: true }); h.responses['passport/my_detail'] = null;
  const page = h.page('my/reg/my_reg.js'); await page.onLoad({});
  page.bindProfileNameInput(event({}, '保留昵称')); page.bindProfileMobileInput(event({}, '13912345678'));
  await page.bindWechatLogin({ detail: { errMsg: 'getPhoneNumber:fail no permission', errno: 102 } });
  assert.match(page.data.loginError, /权限|管理员/);
  assert.equal(page.data.hasSession, false);
  h.responses['passport/wechat_login'] = { token: { ...manualToken, phoneVerified: true, profileComplete: false },
    user: { USER_MOBILE: '13987654321', USER_MOBILE_VERIFIED: true, USER_PROFILE_COMPLETE: false, USER_FORMS: [], allowManualRegistration: true } };
  await page.bindWechatLogin({ detail: { errMsg: 'getPhoneNumber:ok', code: 'late-native-code' } });
  assert.equal(page.data.phoneVerified, true);
  assert.equal(page.data.hasSession, true);
  assert.equal(page.data.loginError, '');
  assert.equal(page.data.formMobile, '13987654321');
  assert.equal(page.data.formName, '保留昵称');
});

test('new registration shows WeChat login first and resumes an incomplete authorized profile', async () => {
  const h = harness({ guest: true }), page = h.page('my/reg/my_reg.js');
  h.responses['passport/my_detail'] = null;
  await page.onLoad({ retUrl: 'back' });
  assert.equal(page.data.phoneVerified, false);
  assert.equal(page.data.isLoad, true);
  h.responses['passport/wechat_login'] = { token: { id: 'poster', sessionToken: 'b'.repeat(64), status: 0, phoneVerified: true, profileComplete: false },
    user: { USER_MOBILE: '13912345678', USER_MOBILE_VERIFIED: true, USER_PROFILE_COMPLETE: false, USER_STATUS: 0, USER_FORMS: [] } };
  await page.bindWechatLogin({ detail: { errMsg: 'getPhoneNumber:ok', code: 'phone-code' } });
  assert.equal(page.data.phoneVerified, true); assert.equal(page.data.formMobile, '13912345678');
  assert.equal(h.navigation.length, 0);
  await page.bindSubmitTap();
  assert.equal(h.calls.filter(call => call.route === 'passport/register').length, 0);
  assert.ok(page.data.saveError);
  h.responses['passport/my_detail'] = h.responses['passport/wechat_login'].user;
  const resumed = h.page('my/reg/my_reg.js'); await resumed.onLoad({});
  assert.equal(resumed.data.phoneVerified, true); assert.equal(h.navigation.length, 0);
});

test('an empty cloud success envelope is a guest and never forces a spurious completion redirect', async () => {
  const h = harness({ guest: true }); h.responses['passport/my_detail'] = {};
  const methods = h.load('miniprogram/projects/crun/pages/my/profile_methods.js');
  assert.equal(await methods.getProfileUser({}, true), null);
  const page = h.page('my/index/my_index.js'); page._visible = true; await page._loadUser();
  assert.equal(page.data.user, null); assert.equal(h.navigation.length, 0);
});

test('denied authorization and duplicate taps never bypass the WeChat login stage', async () => {
  const h = harness({ guest: true }), page = h.page('my/reg/my_reg.js');
  h.responses['passport/my_detail'] = null; await page.onLoad({});
  await page.bindWechatLogin({ detail: { errMsg: 'getPhoneNumber:fail user deny' } });
  assert.equal(page.data.phoneVerified, false); assert.equal(page.data.phoneAuthorizing, false);
  assert.equal(h.calls.filter(call => call.route === 'passport/wechat_login').length, 0);
  const pending = deferred(); h.responses['passport/wechat_login'] = () => pending.promise;
  const event = { detail: { errMsg: 'getPhoneNumber:ok', code: 'one-code' } };
  const first = page.bindWechatLogin(event); await page.bindWechatLogin(event);
  assert.equal(h.calls.filter(call => call.route === 'passport/wechat_login').length, 1);
  pending.reject(Error('授权服务暂不可用')); await first;
  assert.equal(page.data.phoneVerified, false); assert.equal(page.data.phoneAuthorizing, false);
  assert.match(page.data.loginError, /授权服务/);
});

test('registration visibly explains native phone capability failures and releases the button', async () => {
  const h = harness({ guest: true, realPassport: true }), page = h.page('my/reg/my_reg.js');
  h.responses['passport/my_detail'] = null; await page.onLoad({});
  await page.bindWechatLogin({ detail: { errMsg: 'getPhoneNumber:fail no permission', errno: 102 } });
  assert.equal(page.data.phoneAuthorizing, false);
  assert.equal(page.data.phoneVerified, false);
  assert.equal(h.calls.filter(call => call.route === 'passport/wechat_login').length, 0);
  assert.match(page.data.loginError, /暂不可用|管理员/);
  assert.equal(h.messages.at(-1), page.data.loginError, 'a visible toast accompanies the persistent inline error');
});

test('registration exposes cloud setup failures and can succeed after a fresh authorization', async () => {
  const h = harness({ guest: true, realPassport: true }), page = h.page('my/reg/my_reg.js');
  h.responses['passport/my_detail'] = null; await page.onLoad({});
  h.responses['passport/wechat_login'] = () => { throw { msg: '网络连接异常，请稍后重试', errMsg: 'cloud.callFunction:fail -501000 Environment not found' }; };
  await page.bindWechatLogin({ detail: { errMsg: 'getPhoneNumber:ok', code: 'failed-code' } });
  assert.equal(page.data.phoneAuthorizing, false); assert.equal(page.data.phoneVerified, false);
  assert.match(page.data.loginError, /服务配置/);
  assert.equal(h.messages.at(-1), page.data.loginError);
  h.responses['passport/wechat_login'] = { token: { id: 'poster', sessionToken: 'b'.repeat(64), status: 0, phoneVerified: true, profileComplete: false },
    user: { USER_MOBILE: '13912345678', USER_MOBILE_VERIFIED: true, USER_PROFILE_COMPLETE: false, USER_STATUS: 0, USER_FORMS: [] } };
  await page.bindWechatLogin({ detail: { errMsg: 'getPhoneNumber:ok', code: 'fresh-code' } });
  assert.equal(page.data.phoneVerified, true); assert.equal(page.data.loginError, '');
  assert.equal(h.calls.filter(call => call.route === 'passport/wechat_login').length, 2);
  assert.equal(page.data.phoneAuthorizing, false);
});

test('phone reauthorization preserves an unsaved nickname and requires server-confirmed data', async () => {
  const h = harness(), page = h.page('my/personal/my_personal.js');
  page.applyUser(page, h.user); page.bindProfileNameInput(event({}, '修改中的昵称'));
  h.responses['passport/wechat_login'] = { token: { id: 'poster', sessionToken: 'b'.repeat(64), status: 1, phoneVerified: true, profileComplete: true },
    user: { ...h.user, USER_MOBILE: '13912345678' } };
  await page.bindWechatPhone({ detail: { errMsg: 'getPhoneNumber:ok', code: 'new-phone-code' } });
  assert.equal(page.data.formName, '修改中的昵称'); assert.equal(page.data.formMobile, '13912345678');
  assert.equal(page.data.phoneVerified, true);
});

test('a completed registration with a lost response refreshes the session before returning to the business page', async () => {
  const h = harness({ guest: true, realPassport: true }), page = h.page('my/reg/my_reg.js');
  h.passport.setToken({ id: 'poster', sessionToken: 'b'.repeat(64), status: 0, phoneVerified: true, profileComplete: false });
  await readyProfile(h, page);
  page.applyUser(page, { ...h.user, USER_STATUS: 0, USER_PROFILE_COMPLETE: false });
  const destination = '/projects/crun/pages/mail/add/mail_add';
  page.setData({ retUrl: destination });
  h.responses['passport/register'] = () => { throw Error('保存成功，但回包丢失'); };
  await page.bindSubmitTap();
  assert.equal(h.token.profileComplete, false); assert.equal(h.navigation.length, 0);
  h.responses['passport/login'] = { token: { id: 'poster', sessionToken: 'b'.repeat(64), status: 1, phoneVerified: true, profileComplete: true } };
  await page._loadDetail();
  assert.equal(h.token.profileComplete, true);
  assert.equal(await h.passport.loginMustBackWin(), true);
  assert.equal(h.navigation.at(-1).url, destination);
});

test('a failed session refresh after profile completion stays retryable instead of reopening a blocked feature', async () => {
  const h = harness({ guest: true, realPassport: true }), page = h.page('my/reg/my_reg.js');
  h.passport.setToken({ id: 'poster', sessionToken: 'b'.repeat(64), status: 0, phoneVerified: true, profileComplete: false });
  page.setData({ retUrl: '/projects/crun/pages/mail/add/mail_add' });
  h.responses['passport/login'] = () => { throw Error('暂时离线'); };
  await page._loadDetail();
  assert.equal(h.navigation.length, 0); assert.ok(page.data.loadError);
  h.responses['passport/login'] = { token: { id: 'poster', sessionToken: 'b'.repeat(64), status: 0, phoneVerified: true, profileComplete: true } };
  await page._loadDetail();
  assert.equal(h.token.profileComplete, true);
  assert.equal(h.passport.isLogin(), false, 'pending review must remain restricted');
  assert.equal(h.navigation.at(-1).url, '/projects/crun/pages/my/index/my_index');
});

for (const failed of [false, true]) {
  test('an older account profile ' + (failed ? 'failure' : 'response') + ' cannot overwrite a successful phone login', async () => {
    const h = harness({ guest: true, realPassport: true }), page = h.page('my/reg/my_reg.js');
    h.responses['passport/my_detail'] = null; await page.onLoad({});
    h.passport.setToken({ id: 'poster', sessionToken: 'b'.repeat(64), status: 0, phoneVerified: false, profileComplete: false });
    const pending = deferred(); h.responses['passport/my_detail'] = () => pending.promise;
    const refresh = page.onPullDownRefresh();
    h.responses['passport/wechat_login'] = { token: { id: 'poster', sessionToken: 'b'.repeat(64), status: 0, phoneVerified: true, profileComplete: false },
      user: { USER_MOBILE: '13912345678', USER_MOBILE_VERIFIED: true, USER_PROFILE_COMPLETE: false, USER_STATUS: 0, USER_FORMS: [] } };
    await page.bindWechatLogin({ detail: { errMsg: 'getPhoneNumber:ok', code: 'fresh-phone-code' } });
    if (failed) pending.reject(Error('旧请求超时')); else pending.resolve(null);
    await refresh;
    assert.equal(page.data.phoneVerified, true); assert.equal(page.data.formMobile, '13912345678');
    assert.equal(page.data.loadError, ''); assert.equal(h.token.phoneVerified, true);
    assert.equal(h.navigation.length, 0);
  });
}

test('favorite mutations ignore repeated taps while login or saving is in flight', async () => {
  const h = harness(), page = h.page('my/fav/my_fav.js'), pending = deferred();
  const favorites = h.load('miniprogram/comm/biz/fav_biz.js');
  h.responses['fav/update'] = () => pending.promise;
  const first = favorites.updateFav(page, 'notice', 0, 'news', '公告');
  await favorites.updateFav(page, 'notice', 0, 'news', '公告'); await tick();
  assert.equal(h.calls.filter(call => call.route === 'fav/update').length, 1);
  pending.resolve({ isFav: 1 }); await first; assert.equal(page.data.isFav, 1);
});

test('feedback detail can retry a failed request and formats returned timestamps', async () => {
  const h = harness(), page = h.page('feedback/detail/feedback_detail.js'); page.onLoad({ id: 'feedback' });
  h.responses['feedback/my_detail'] = () => { throw new Error('offline'); };
  await page.onShow(); assert.equal(page.data.error, true); assert.equal(page.data.loading, false);
  h.responses['feedback/my_detail'] = { _id: 'feedback', FB_STATUS: 1, FB_ADD_TIME: Date.UTC(2026, 8, 14), FB_REPLY_TIME: 0 };
  await page._loadDetail(); assert.equal(page.data.error, false); assert.equal(page.data.detail.FB_ADD_TIME, '2026-09-14 08:00');
});

test('invitation links survive a warm app launch and network failure, then clear after a successful bind', async () => {
  const h = harness(); h.load('miniprogram/app.js'); h.app.onShow({ query: { inviteCode: 'abcdef' } });
  const invites = h.load('miniprogram/projects/crun/biz/invite_biz.js'); assert.equal(invites.getPendingCode(), 'ABCDEF');
  h.responses['invite/accept'] = () => { throw new Error('offline'); };
  await assert.rejects(invites.acceptPending(), /offline/); assert.equal(invites.getPendingCode(), 'ABCDEF');
  h.responses['invite/accept'] = { accepted: true }; await invites.acceptPending(); assert.equal(invites.getPendingCode(), '');
});

test('invite records paginate without recreating codes and sharing carries the current code', async () => {
  const h = harness(), page = h.page('invite/index/invite_index.js');
  h.responses['invite/my_list'] = params => ({ list: [{ _id: String(params.page) }], hasMore: params.page === 1 });
  page.onLoad(); await page.onShow(); await page.bindMore(); await page.bindMore();
  assert.deepEqual(Array.from(page.data.list, row => row._id), ['1', '2']);
  assert.equal(h.calls.filter(call => call.route === 'invite/my_code').length, 1);
  assert.equal(h.calls.filter(call => call.route === 'invite/my_list').length, 2);
  assert.match(page.onShareAppMessage().path, /inviteCode=ABCDEF$/); page.bindCopyCode(); assert.equal(h.storage.get('clipboard'), 'ABCDEF');
});

test('favorites can search, open and remove records, and retain data on a failed removal', async () => {
  const h = harness(), page = h.page('my/fav/my_fav.js');
  const row = { _id: 'fav', FAV_OID: 'notice', FAV_PATH: '/projects/crun/pages/news/detail/news_detail?id=notice' };
  h.responses['fav/my_list'] = { list: [row], total: 1, hasMore: false };
  await page.onShow(); page.bindOpen(event({ id: 'fav' })); assert.equal(h.navigation.at(-1).url, row.FAV_PATH);
  page.bindKeywordInput(event({}, '公告')); await page.bindSearch(); assert.equal(h.calls.at(-1).params.search, '公告');
  h.responses['fav/del'] = () => { throw new Error('remove failed'); }; await page.bindDelete(event({ id: 'fav' }));
  assert.equal(page.data.list.length, 1); assert.equal(page.data.deletingId, '');
  h.responses['fav/del'] = { effect: 1 }; h.responses['fav/my_list'] = { list: [], total: 0, hasMore: false };
  await page.bindDelete(event({ id: 'fav' })); assert.equal(page.data.list.length, 0);
});

test('sent and received reviews have independent pages, queries and late-response lifecycles', async () => {
  const h = harness(), sent = h.page('my/review/my_review.js'), received = h.page('my/review_received/my_review_received.js');
  const pending = deferred();
  h.responses['review/my_list'] = params => params.direction === 'sent' ? pending.promise : { list: [{ _id: 'received', REVIEW_SCORE: 5 }], hasMore: false };
  const first = sent.onShow(); await tick();
  sent.bindDirection(event({ direction: 'received' }));
  assert.match(h.navigation.at(-1).url, /review_received\/my_review_received$/);
  sent.onHide(); await received.onShow();
  pending.resolve({ list: [{ _id: 'sent', REVIEW_SCORE: 3 }], hasMore: false }); await first;
  assert.equal(sent.data.list.length, 0);
  assert.equal(received.data.direction, 'received'); assert.equal(received.data.list[0]._id, 'received');
  assert.deepEqual(h.calls.map(call => call.params.direction), ['sent', 'received']);
});

test('address edits require one of the five phases and preserve the existing detail during selection', async () => {
  const h = harness(), page = h.page('my/address/address.js'); await readyProfile(h, page); page.applyUser(page, h.user);
  page.bindEditAddress(event({ index: 1 }));
  assert.equal(page.data.addressDraft.detail, '二栋');
  await page.bindSaveAddress(); assert.equal(h.calls.length, 0);
  page.bindAddressPhase(event({ phase: '奥林苑' })); assert.equal(page.data.addressDraft.label, '');
  page.bindAddressPhase(event({ phase: '五期' })); assert.equal(page.data.addressDraft.detail, '二栋');
  await page.bindSaveAddress();
  assert.equal(page.data.addresses[1].label, '五期'); assert.equal(page.data.addresses[1].detail, '二栋');
  assert.equal(h.calls[0].params.forms.find(form => form.mark === 'address').val, '五期 二栋');
});

test('feedback prevents duplicate clicks, preserves a failed draft and retries its original content', async () => {
  const h = harness(), page = h.page('feedback/index/feedback_index.js'), pending = deferred(); await page.onLoad({});
  page.bindTargetTap(event({ idx: 1 })); page.bindContentInput(event({}, '请协助核实配送情况'));
  h.responses['feedback/insert'] = () => pending.promise;
  const first = page.bindSubmitTap(); await tick();
  await page.bindSubmitTap(); page.bindContentInput(event({}, '提交时误触输入'));
  assert.equal(h.calls.filter(call => call.route === 'feedback/insert').length, 1);
  pending.reject(new Error('网络中断')); await first;
  assert.equal(page.data.content, '请协助核实配送情况'); assert.equal(page.data.isSubmit, false); assert.match(page.data.submitError, /网络中断/);
  h.responses['feedback/insert'] = { id: 'saved-feedback' }; await page.bindSubmitTap(); await page.bindSubmitTap();
  const calls = h.calls.filter(call => call.route === 'feedback/insert');
  assert.equal(calls.length, 2); assert.deepEqual(calls[0].params, calls[1].params);
});

test('both review lists retain display fields only and offer no completed-order navigation', async () => {
  for (const file of ['my/review/my_review.js', 'my/review_received/my_review_received.js']) {
    const h = harness(), page = h.page(file);
    h.responses['review/my_list'] = { list: [{ _id: 'review', REVIEW_NAME: '林同学', REVIEW_PIC: 'cloud://public-avatar', REVIEW_SCORE: 4, REVIEW_CONTENT: '沟通及时\n谢谢帮忙',
      REVIEW_ORDER_ID: 'private-order', REVIEW_ADD_TIME_TEXT: 'private-time', REVIEW_FROM_USER_ID: 'private-account', REVIEW_FROM_ROLE: '发布者', USER_MOBILE: 'private-phone' }], hasMore: false };
    await page.onShow();
    assert.deepEqual({ ...page.data.list[0] }, { _id: 'review', name: '林同学', avatar: 'cloud://public-avatar', score: 4, content: '沟通及时\n谢谢帮忙', stars: '★★★★☆' });
    assert.equal(page.bindOrderTap, undefined); assert.equal(page.bindCompletedOrders, undefined);
    assert.equal(h.navigation.length, 0); assert.equal(h.storage.has('crun-order-tab'), false);
  }
  const template = fs.readFileSync(path.join(root, pages, 'my/review/review_list.wxml'), 'utf8');
  assert.doesNotMatch(template, /REVIEW_ORDER_ID|REVIEW_ADD_TIME|bindOrderTap|bindCompletedOrders|查看.*订单/);
});

test('review lists preserve legacy names and recover missing avatars without clearing a refreshed image', async () => {
  for (const [file, name] of [['my/review/my_review.js', '被评价人'], ['my/review_received/my_review_received.js', '评价人']]) {
    const h = harness(), page = h.page(file);
    h.responses['review/my_list'] = { list: [{ _id: 'review', REVIEW_FROM_NAME: '评价人', REVIEW_TO_NAME: '被评价人', REVIEW_SCORE: 5 }], hasMore: false };
    await page.onShow();
    assert.equal(page.data.list[0].name, name); assert.equal(page.data.list[0].avatar, ''); assert.equal(page.data.list[0].content, '');
    h.responses['review/my_list'].list[0].REVIEW_PIC = 'cloud://new-avatar';
    await page.load();
    page.bindAvatarError(event({ id: 'review', src: 'cloud://old-avatar' }));
    assert.equal(page.data.list[0].avatar, 'cloud://new-avatar');
    page.bindAvatarError(event({ id: 'review', src: 'cloud://new-avatar' }));
    assert.equal(page.data.list[0].avatar, ''); assert.equal(page.data.list[0].stars, '★★★★★');
  }
});

test('feedback image controls enforce the supported six-image limit and submit functional feedback as a suggestion', async () => {
  const h = harness(), page = h.page('feedback/index/feedback_index.js'); await page.onLoad({});
  page.setData({ img: ['a', 'b', 'c', 'd', 'e'] }); page.bindChooseImage(); assert.equal(h.images[0].count, 1);
  page.bindChooseImage(); assert.equal(h.images.length, 1); assert.equal(page.data.img.length, 6);
  page.bindTargetTap(event({ idx: 3 })); page.bindContentInput(event({}, '希望增加提醒功能')); await page.bindSubmitTap();
  const saved = h.calls.find(call => call.route === 'feedback/insert').params;
  assert.equal(saved.type, 'suggest'); assert.equal(saved.img.length, 6); assert.equal(page.data.isSubmit, false);
});

test('messages remain available when optional subscription configuration hangs and malformed dates are tolerated', async () => {
  const h = harness(), page = h.page('operations/operations.js'), pending = deferred();
  h.responses['operations/config'] = () => pending.promise;
  h.responses['operations/notifications'] = { list: [{ _id: 'notice', title: '通知', createdAt: 'invalid', orderId: 'order?1' }], hasMore: false };
  page.onLoad(); await page.onShow(); assert.equal(page.data.list.length, 1); assert.equal(page.data.loading, false); assert.equal(page.data.list[0].time, '时间未知');
  await page.bindRead(event({ id: 'notice' })); assert.notEqual(page.data.list[0].read, true); assert.match(h.navigation.at(-1).url, /order%3F1&notificationId=notice$/);
  pending.resolve({ templateId: 'notification' }); await tick(); await page.bindSubscribe(); assert.ok(h.messages.includes('订阅成功'));
});

async function wechatProfilePage(options = {}) {
  const h = harness({ guest: true, realPassport: true, phoneLoginEnabled: false, ...options });
  const token = { id: 'poster', sessionToken: 'b'.repeat(64), status: 0, name: '', pic: '', phoneVerified: false, profileComplete: false, allowManualRegistration: true };
  Object.assign(h.user, { USER_NAME: '', USER_PIC: '', USER_MOBILE: '', USER_MOBILE_VERIFIED: false, USER_PROFILE_COMPLETE: false, USER_STATUS: 0, USER_FORMS: [], allowManualRegistration: true });
  h.passport.setToken(token);
  h.responses['passport/wechat_profile'] = params => ({ token: { ...token, name: params.name, pic: params.pic } });
  // A profile retry uses the active login sheet after identity login succeeded.
  const page = h.page('my/reg/my_reg.js');
  await readyProfile(h, page); page.applyUser(page, h.user);
  page.setData({ isLoad: true, hasSession: true, wechatProfileVisible: true }); h.calls.length = 0;
  return { h, page };
}

test('native nickname submission saves the selected avatar without contact or school details', async () => {
  const { h, page } = await wechatProfilePage({ uploadAvatar: async () => 'cloud://test/chosen-avatar.jpg' });
  page.bindPicTap({ detail: { avatarUrl: 'wxfile://tmp/chosen-avatar.jpg' } });
  page.bindProfileNameInput(event({}, '输入事件里的旧昵称'));
  await page.bindProfileFormSubmit(event({}, { nickname: '微信昵称' }));
  assert.deepEqual(h.calls, [{ route: 'passport/wechat_profile', params: { name: '微信昵称', pic: 'cloud://test/chosen-avatar.jpg' } }]);
  assert.equal(h.uploads[0][0], 'wxfile://tmp/chosen-avatar.jpg');
  assert.equal(h.token.name, '微信昵称'); assert.equal(h.token.pic, 'cloud://test/chosen-avatar.jpg');
  assert.equal(h.token.profileComplete, false); assert.equal(h.token.phoneVerified, false);
  assert.equal(h.navigation.at(-1).url, '/projects/crun/pages/my/index/my_index');
});

test('a nickname cleared by the native form never falls back to the old nickname', async () => {
  const { h, page } = await wechatProfilePage();
  page.setData({ formName: '旧昵称', formPic: 'cloud://test/avatar.jpg' });
  await page.bindProfileFormSubmit(event({}, { nickname: '' }));
  assert.equal(page.data.formName, ''); assert.equal(h.calls.length, 0); assert.equal(h.uploads.length, 0);
  assert.match(page.data.saveError, /昵称/); assert.equal(h.navigation.length, 0);
});

test('avatar upload failure keeps the selection and permits an explicit retry', async () => {
  let fail = true;
  const { h, page } = await wechatProfilePage({ uploadAvatar: async () => { if (fail) throw Error('上传失败'); return 'cloud://test/retry.jpg'; } });
  page.bindPicTap({ detail: { avatarUrl: 'wxfile://tmp/retry.jpg' } });
  await page.bindProfileFormSubmit(event({}, { nickname: '保留昵称' }));
  assert.match(page.data.saveError, /上传失败/); assert.equal(page.data.formPic, 'wxfile://tmp/retry.jpg');
  assert.equal(page.data.formName, '保留昵称'); assert.equal(page.data.saving, false); assert.equal(h.calls.length, 0);
  fail = false; await page.bindProfileFormSubmit(event({}, { nickname: '保留昵称' }));
  assert.equal(h.token.pic, 'cloud://test/retry.jpg'); assert.equal(h.calls.length, 1);
});

test('saving WeChat details ignores duplicate submits and late avatar selections', async () => {
  const pending = deferred(), { h, page } = await wechatProfilePage({ uploadAvatar: () => pending.promise });
  page.bindPicTap({ detail: { avatarUrl: 'wxfile://tmp/first.jpg' } });
  const saving = page.bindProfileFormSubmit(event({}, { nickname: '第一次昵称' }));
  await tick();
  page.bindPicTap({ detail: { avatarUrl: 'wxfile://tmp/late.jpg' } });
  await page.bindProfileFormSubmit(event({}, { nickname: '误触昵称' }));
  assert.equal(page.data.formPic, 'wxfile://tmp/first.jpg'); assert.equal(h.uploads.length, 1);
  pending.resolve('cloud://test/first.jpg'); await saving;
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].params.name, '第一次昵称');
});

for (const phase of ['upload', 'response']) test('WeChat detail saving cannot restore a logged-out session after ' + phase, async () => {
  const pending = deferred(), { h, page } = await wechatProfilePage({ uploadAvatar: () => phase === 'upload' ? pending.promise : Promise.resolve('cloud://test/avatar.jpg') });
  page.setData({ formPic: 'wxfile://tmp/avatar.jpg' });
  if (phase === 'response') h.responses['passport/wechat_profile'] = () => pending.promise;
  const saving = page.bindProfileFormSubmit(event({}, { nickname: '微信昵称' })); await tick();
  h.passport.logout();
  pending.resolve(phase === 'upload' ? 'cloud://test/avatar.jpg' : { token: { id: 'poster', sessionToken: 'b'.repeat(64), name: '微信昵称', pic: 'cloud://test/avatar.jpg', status: 0, profileComplete: false, phoneVerified: false } });
  await saving;
  assert.equal(h.token, null); assert.equal(h.passport.isLoggedOut(), true); assert.equal(h.navigation.length, 0);
  assert.equal(h.calls.length, phase === 'upload' ? 0 : 1);
});

for (const phase of ['upload', 'response']) test('an old profile save cannot cross logout and relogin with the same identity after ' + phase, async () => {
  const pending = deferred(), { h, page } = await wechatProfilePage({ uploadAvatar: () => phase === 'upload' ? pending.promise : Promise.resolve('cloud://test/avatar.jpg') });
  page.setData({ formPic: 'wxfile://tmp/avatar.jpg' });
  if (phase === 'response') h.responses['passport/wechat_profile'] = () => pending.promise;
  const saving = page.bindSaveWechatProfile(event({}, { nickname: '旧会话昵称' })); await tick();
  h.passport.logout();
  h.responses['passport/wechat_identity_login'] = { token: { id: 'poster', sessionToken: 'c'.repeat(64), name: '新会话昵称', status: 0, profileComplete: false, phoneVerified: false }, user: h.user };
  await h.passport.loginByUser();
  pending.resolve(phase === 'upload' ? 'cloud://test/avatar.jpg' : { token: { id: 'poster', sessionToken: 'b'.repeat(64), name: '旧会话昵称', pic: 'cloud://test/avatar.jpg', status: 0, profileComplete: false, phoneVerified: false } });
  await saving;
  assert.equal(h.token.name, '新会话昵称'); assert.equal(h.token.sessionToken, 'c'.repeat(64));
  assert.equal(h.navigation.length, 0);
  assert.equal(h.calls.filter(call => call.route === 'passport/wechat_profile').length, phase === 'upload' ? 0 : 1);
});

test('full profile saving also uses the current native nickname form value', async () => {
  const h = harness(), page = h.page('my/personal/my_personal.js'); await page.onLoad();
  h.calls.length = 0;
  await page.bindSubmitTap(event({}, { nickname: '微信选定昵称' }));
  assert.equal(h.calls.find(call => call.route === 'passport/edit_base').params.name, '微信选定昵称');
});

for (const full of [false, true]) test((full ? 'full' : 'avatar') + ' profile upload cannot cross a same-identity credential rotation without logout', async () => {
  const pending = deferred();
  let h, page;
  if (full) {
    h = harness({ realPassport: true, realSessionSignals: true, phoneLoginEnabled: false, uploadAvatar: () => pending.promise });
    page = h.page('my/personal/my_personal.js'); await page.onLoad();
  } else ({ h, page } = await wechatProfilePage({ realSessionSignals: true, uploadAvatar: () => pending.promise }));
  page.setData({ formPic: 'wxfile://tmp/old-avatar.jpg' }); h.calls.length = 0;
  const saving = (full ? page.bindSubmitTap : page.bindSaveWechatProfile).call(page, event({}, { nickname: '旧资料昵称' }));
  await tick(); assert.equal(h.uploads.length, 1);
  const epoch = h.passport.logoutEpoch(), newToken = { ...h.token, sessionToken: 'c'.repeat(64), name: '新资料昵称' };
  h.responses['passport/wechat_identity_login'] = { token: newToken, user: h.user };
  await h.passport.loginByUser(); assert.equal(h.passport.logoutEpoch(), epoch, 'there was no logout');
  pending.resolve('cloud://test/old-avatar.jpg'); await saving;
  assert.equal(h.calls.filter(call => ['passport/wechat_profile', 'passport/edit_base'].includes(call.route)).length, 0);
  assert.equal(h.token.sessionToken, newToken.sessionToken); assert.equal(h.token.name, newToken.name);
  assert.equal(page.data.saving, false);
});

test('the login sheet retries a failed profile save without repeating successful identity login', async () => {
  const h = harness({ guest: true, realPassport: true, realSessionSignals: true, phoneLoginEnabled: false, uploadAvatar: () => 'cloud://test/profile.jpg' });
  const page = h.page('my/reg/my_reg.js'); await page.onLoad(); page.bindOpenWechatProfile();
  page.bindPicTap({ detail: { avatarUrl: 'wxfile://tmp/profile.jpg' } });
  const token = { id: 'poster', sessionToken: 'b'.repeat(64), status: 0, phoneVerified: false, profileComplete: false, allowManualRegistration: true };
  h.responses['passport/wechat_identity_login'] = { token, user: { USER_STATUS: 0, USER_NAME: '', USER_PIC: '', USER_FORMS: [], allowManualRegistration: true } };
  let failing = true;
  h.responses['passport/wechat_profile'] = params => {
    if (failing) throw Error('资料保存暂时失败');
    return { token: { ...token, name: params.name, pic: params.pic } };
  };
  await page.bindConfirmWechatProfile(event({}, { nickname: '微信昵称' }));
  assert.match(page.data.saveError, /暂时失败/); assert.equal(page.data.formName, '微信昵称');
  assert.equal(page.data.formPic, 'cloud://test/profile.jpg'); assert.equal(page.data.wechatProfileVisible, true);
  assert.equal(h.navigation.length, 0);
  failing = false; await page.bindConfirmWechatProfile(event({}, { nickname: '微信昵称' }));
  assert.equal(h.calls.filter(call => call.route === 'passport/wechat_identity_login').length, 1);
  assert.equal(h.calls.filter(call => call.route === 'passport/wechat_profile').length, 2);
  assert.ok(h.navigation.at(-1).url.endsWith('/my/personal/my_personal'));
});

test('opening contact completion preserves the selected nickname and avatar', async () => {
  const { h, page } = await wechatProfilePage();
  page.setData({ formName: '保留昵称', formPic: 'wxfile://tmp/keep.jpg' });
  page.bindCompleteProfile();
  assert.equal(page.data.showContactProfile, true); assert.equal(page.data.formName, '保留昵称');
  assert.equal(page.data.formPic, 'wxfile://tmp/keep.jpg'); assert.equal(h.calls.length, 0);
});

test('shared profile templates and all personal-center pages bind existing event handlers', () => {
  const h = harness();
  const targets = ['my/index/my_index', 'my/personal/my_personal', 'my/reg/my_reg', 'my/contact/contact', 'my/address/address', 'my/fav/my_fav', 'my/review/my_review', 'invite/index/invite_index'];
  function inspect(template, page, seen = new Set()) {
    if (seen.has(template)) return; seen.add(template);
    const source = fs.readFileSync(template, 'utf8');
    for (const match of source.matchAll(/(?:bind|catch):?[\w-]+\s*=\s*["']([\w]+)["']/g)) assert.equal(typeof page[match[1]], 'function', template + ': ' + match[1]);
    for (const match of source.matchAll(/<include\s+src=["']([^"']+)["']/g)) inspect(path.resolve(path.dirname(template), match[1]), page, seen);
  }
  for (const target of targets) inspect(path.join(root, pages, target + '.wxml'), h.page(target + '.js'));
});
