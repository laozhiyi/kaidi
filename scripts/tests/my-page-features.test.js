'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { notificationStub } = require('../test-support/notification-client-harness.cjs');
const root = path.resolve(__dirname, '../..');
const pages = 'miniprogram/projects/crun/pages/';
const computingCollege = '计算机科学与工程学院／软件学院／人工智能学院';
const event = (dataset = {}, value) => ({ currentTarget: { dataset }, detail: { value } });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

test('historical disclaimer does not preselect new terms and opening either policy never changes consent', async () => {
  const h = harness(), page = h.page('my/personal/my_personal.js');
  delete h.user.USER_AGREEMENTS;
  await page.onLoad({});
  assert.equal(page.data.profileDisclaimer, false);
  page.bindViewDisclaimer(); assert.match(h.navigation.at(-1).url, /about_agreement\?key=user$/);
  page.bindViewPrivacy(); assert.match(h.navigation.at(-1).url, /about_agreement\?key=privacy$/);
  assert.equal(page.data.profileDisclaimer, false);
  await page.bindPersonalSubmit();
  assert.equal(page.data.guideField, 'agreement');
  assert.equal(h.calls.filter(x => x.route === 'passport/edit_base').length, 0);
  page.bindDisclaimerTap(); await page.bindPersonalSubmit();
  assert.equal(page.data.guideField, '');
  const saved = h.calls.find(x => x.route === 'passport/edit_base');
  assert.equal(saved.params.agreements.userVersion, '2026-11-27');
  assert.equal(saved.params.agreements.privacyVersion, '2026-11-27');
  assert.equal(saved.params.agreements.accepted, true);
});
test('agreement navigation still locates the checkbox after a profile load failure and retry', async () => {
  const h=harness(),page=h.page('my/personal/my_personal.js');
  delete h.user.USER_AGREEMENTS;
  h.responses['passport/my_detail']=()=>{throw new Error('offline');};
  await page.onLoad({focus:'agreement',retUrl:'back'});
  assert.equal(page._focusAgreement,true);assert.equal(page.data.isLoad,false);
  h.responses['passport/my_detail']=h.user;
  await page._loadDetail();
  assert.equal(page.data.guideField,'agreement');assert.equal(page.data.profileDisclaimer,false);
  assert.equal(page.data.retUrl,'back');assert.equal(page._focusAgreement,false);
});

test('saved current agreement is preselected on the next visit, but unchecking still blocks saving', async () => {
  const h=harness();delete h.user.USER_AGREEMENTS;
  const first=h.page('my/personal/my_personal.js');await first.onLoad({});
  assert.equal(first.data.profileDisclaimer,false);
  first.bindDisclaimerTap();await first.bindPersonalSubmit();
  const saved=h.calls.find(call=>call.route==='passport/edit_base');
  assert.equal(saved.params.agreements.accepted,true);
  // Subsequent profile reads return the consent record persisted by the server.
  h.user.USER_AGREEMENTS={userVersion:saved.params.agreements.userVersion,privacyVersion:saved.params.agreements.privacyVersion,acceptedAt:1};
  const next=h.page('my/personal/my_personal.js');await next.onLoad({});
  assert.equal(next.data.profileDisclaimer,true);
  next.bindDisclaimerTap();const before=h.calls.filter(call=>call.route==='passport/edit_base').length;
  await next.bindPersonalSubmit();
  assert.equal(h.calls.filter(call=>call.route==='passport/edit_base').length,before);
  assert.equal(next.data.guideField,'agreement');assert.match(next.data.saveError,/协议/);
});

test('unchecking previously accepted terms prevents the personal form from uploading or saving', async () => {
  const h=harness(),page=h.page('my/personal/my_personal.js');
  await page.onLoad({});assert.equal(page.data.profileDisclaimer,true);
  page.bindDisclaimerTap();assert.equal(page.data.profileDisclaimer,false);
  const before=h.calls.length;
  await page.bindPersonalSubmit({detail:{value:{nickname:'未授权的新昵称'}}});
  assert.equal(h.calls.length,before);
  assert.match(page.data.saveError,/协议/);assert.equal(page.data.saving,false);
  page.bindDisclaimerTap();assert.equal(page.data.profileDisclaimer,true);
  await page.bindPersonalSubmit({detail:{value:{nickname:'重新同意后保存'}}});
  assert(h.calls.some(x=>x.route==='passport/edit_base' && x.params.name==='重新同意后保存'));
});

function harness(options = {}) {
  const storage = options.storage || new Map(), calls = [], navigation = [], messages = [], modals = [], images = [], modules = new Map(), definitions = new Map();
  let app, token = options.guest ? null : { id: 'poster', sessionToken: 'b'.repeat(64), name: '小周', pic: 'cloud://avatar', status: 1, phoneVerified: true, profileComplete: true }, stopped = 0;
  const user = { USER_AGREEMENTS: {userVersion:'2026-11-27',privacyVersion:'2026-11-27',acceptedAt:1}, USER_NAME: '小周', USER_MOBILE: '13800000000', USER_MOBILE_VERIFIED: true, USER_PROFILE_COMPLETE: true, USER_PIC: 'cloud://avatar', USER_STATUS: 1, USER_FORMS: [
    { mark: 'campus', val: '育才校区' }, { mark: 'sex', val: '男' }, { mark: 'college', val: computingCollege }, { mark: 'sub', val: '软件工程' },
    { mark: 'studentId', val: '20240001' }, { mark: 'studentCard', val: ['cloud://test/student-card.png'] }, { mark: 'disclaimer', val: true },
    { mark: 'contacts', val: [{ name: '甲', phone: '13800000001', isDefault: false }, { name: '乙', phone: '13800000002', isDefault: true }] },
    { mark: 'addresses', val: [{ label: '宿舍', detail: '一栋', isDefault: false }, { label: '学院', detail: '二栋', isDefault: true }] }
  ] };
  const responses = {
    'operations/config': { campuses: ['育才校区', '王城校区', '雁山校区'], phoneLoginEnabled: options.phoneLoginEnabled !== false,
      allowManualRegistration: options.phoneLoginEnabled === false || options.manualRegistration === true, locations:require('../../cloudfunctions/mcloud/project/crun/service/tenant_defaults.js').locations },
    'passport/my_detail': user, 'passport/edit_base': { ok: true }, 'passport/logout': { ok: true },
    'passport/register': { token: { id: 'poster', sessionToken: 'b'.repeat(64), name: '小周', status: 1, phoneVerified: true, profileComplete: true } },
    'invite/accept': { accepted: true }, 'invite/my_code': { code: 'ABCDEF' }, 'invite/my_info': { code: 'QWERTY', bound: false, boundCode: '' },
    'invite/my_qrcode': { code: 'ABCDEF', fileID: 'cloud://qr/ABCDEF.png', url: 'https://cdn.example/qr.png', envVersion: 'release' },
    'invite/my_stat': { total: 0, accepted: 0, used: 0, rewarded: 0, pending: 0 },
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
    showModal: data => { messages.push(data.title); modals.push(data); if (data.success) data.success({ confirm: options.confirm !== false }); if (data.complete) data.complete(); },
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
        if (name.endsWith('/project_setting.js') && !options.usePublicProfileCampus) {
          return { ...load('miniprogram/projects/crun/public/project_setting.js'), PUBLIC_PROFILE_CAMPUS: '' };
        }
        if (name.endsWith('/passport_biz.js')) return passport;
        if (name.endsWith('/cloud_helper.js')) return cloud;
        if (name.endsWith('/page_helper.js')) return pageHelper;
        if (name.endsWith('/validate.js')) return { check: data => data };
        if (name.endsWith('/admin_biz.js')) return { getAdminToken: () => options.admin ? { token: 'admin' } : null, applySession: options.applyAdminSession };
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
  return { page, load, user, responses, calls, navigation, messages, modals, images, uploads, storage, wx, passport,
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

test('My displays the saved avatar and nickname immediately when returning from personal settings', async () => {
  const h = harness({ realPassport: true }), page = h.page('my/index/my_index.js');
  const staleProfile = deferred(), sessionRefresh = deferred();
  page.onLoad();
  h.responses['passport/my_detail'] = () => staleProfile.promise;
  const staleRequest = page._loadUser();
  await tick();

  const saved = { ...h.token, name: '我的新昵称', pic: 'cloud://test/my-new-avatar.jpg' };
  h.passport.setToken(saved);
  h.responses['passport/login'] = () => sessionRefresh.promise;
  h.responses['passport/my_detail'] = null;
  const showing = page.onShow();
  assert.equal(page.data.user.USER_NAME, saved.name);
  assert.equal(page.data.user.USER_PIC, saved.pic);

  staleProfile.resolve({ USER_NAME: '', USER_PIC: '', USER_PROFILE_COMPLETE: false });
  await staleRequest;
  assert.equal(page.data.user.USER_NAME, saved.name);
  assert.equal(page.data.user.USER_PIC, saved.pic);

  sessionRefresh.resolve({ token: saved });
  await showing;
  assert.equal(page.data.user.USER_NAME, saved.name);
  assert.equal(page.data.user.USER_PIC, saved.pic);
  assert.equal(page.data.user.USER_PROFILE_COMPLETE, true);
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

test('the WeChat login button starts a single identity login and continues to personal details', async () => {
  const h = harness({ realPassport: true, phoneLoginEnabled: false }); h.passport.logout();
  h.responses['passport/wechat_identity_login'] = { token: { id: 'poster', sessionToken: 'b'.repeat(64), status: 0, profileComplete: false, phoneVerified: false, allowManualRegistration: true },
    user: { USER_STATUS: 0, USER_NAME: '', USER_PIC: '', USER_PROFILE_COMPLETE: false, USER_MOBILE_VERIFIED: false, allowManualRegistration: true, phoneLoginEnabled: false } };
  const page = h.page('my/reg/my_reg.js'); await page.onLoad(); h.calls.length = 0;
  const first = page.bindOpenWechatProfile();
  await page.bindOpenWechatProfile();
  await first;
  assert.equal(h.calls.filter(call => call.route === 'passport/wechat_identity_login').length, 1);
  assert.equal(page.data.identityLoggingIn, false);
  assert.equal(page.data.loginError, '');
  assert.ok(h.navigation.some(item => item.type === 'redirect' && item.url.endsWith('/my/personal/my_personal')));
  assert.equal(h.calls.filter(call => /passport\/(register|edit_base|wechat_profile)$/.test(call.route)).length, 0);
});

test('a rejected WeChat login keeps the registration page and reports the failure', async () => {
  const h = harness({ realPassport: true, phoneLoginEnabled: false }); h.passport.logout();
  h.responses['passport/wechat_identity_login'] = { token: null, user: null };
  const page = h.page('my/reg/my_reg.js'); await page.onLoad(); h.calls.length = 0;
  await page.bindOpenWechatProfile();
  assert.match(page.data.loginError, /登录未完成/);
  assert.equal(page.data.identityLoggingIn, false);
  assert.equal(h.navigation.length, 0);
  assert.equal(h.passport.isLoggedOut(), true);
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
  // 资料已完整的账号登录成功后直接回到“我的”，不再强制进入个人资料页。
  assert.equal(h.navigation.at(-1).url, '/projects/crun/pages/my/index/my_index');
  assert.equal(h.navigation.at(-1).type, 'tab');
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

test('basic WeChat login remains available when optional campus configuration fails', async () => {
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
  assert.equal(page.data.phoneLoginEnabled, false);
  assert.equal(page.data.loadError, '');
  assert.equal(page.data.hasSession, false);
  assert.equal(h.calls.filter(call => /^passport\//.test(call.route)).length, 0);
  await page.bindWechatAccountLogin();
  assert.equal(page.data.hasSession, true);
  assert.equal(h.passport.getUserId(), 'poster');
  assert.equal(page.data.loginError, '');
  assert.deepEqual(h.calls.filter(call => /^passport\//.test(call.route)).map(call => call.route), ['passport/wechat_identity_login']);
});

test('an expired session shows login immediately and retains the original publish destination', async () => {
  const h = harness({ realPassport: true, phoneLoginEnabled: false });
  const retUrl = '/projects/crun/pages/mail/add/mail_add?serviceType=pickup';
  const params = { retUrl: encodeURIComponent(retUrl), returnToPublish: '1' };
  const expired = () => {
    h.wx.setStorageSync('CACHE_LOGGED_OUT', true);
    h.passport.clearToken();
    throw { code: 2301, msg: '登录已失效' };
  };
  h.responses['passport/my_detail'] = expired;
  const token = h.token;
  await h.page('my/personal/my_personal.js').onLoad(params);
  assert.equal(h.navigation.at(-1).url, '../reg/my_reg?retUrl=' + params.retUrl + '&returnToPublish=1');

  h.passport.setToken(token);
  const page = h.page('my/reg/my_reg.js');
  await page.onLoad(params);
  assert.equal(page.data.isLoad, true);
  assert.equal(page.data.hasSession, false);
  assert.equal(page.data.loadError, '');
  assert.equal(page.data.phoneLoginEnabled, false);

  const pending = { ...token, status: 0, profileComplete: true, profilePhoneRequired: true };
  h.responses['passport/wechat_identity_login'] = { token: pending, user: { ...h.user, USER_STATUS: 0, profilePhoneRequired: true } };
  h.responses['passport/login'] = { token: pending };
  await page.bindWechatAccountLogin();
  assert.equal(h.navigation.at(-1).url, retUrl);
});

test('a pending account returns to publish after saving its profile, but not to an accept action', async () => {
  const h = harness({ realPassport: true, phoneLoginEnabled: false });
  const policy = { profilePhoneRequired: true, phoneLoginEnabled: false, allowManualRegistration: false };
  Object.assign(h.responses['operations/config'], policy);
  Object.assign(h.user, policy, { USER_STATUS: 0, USER_PROFILE_COMPLETE: false });
  h.passport.setToken({ ...h.token, ...policy, status: 0, profileComplete: false });
  h.responses['passport/register'] = { token: { ...h.token, profileComplete: true } };
  const publish = '/projects/crun/pages/mail/add/mail_add';
  const page = h.page('my/personal/my_personal.js');
  await page.onLoad({ retUrl: encodeURIComponent(publish), returnToPublish: '1' });
  await page.bindPersonalSubmit();
  assert.equal(h.navigation.at(-1).url, publish);
  const methods = h.load('miniprogram/projects/crun/pages/my/profile_methods.js');
  methods.finishProfile({ data: { accountStatus: 0, retUrl: '/projects/crun/pages/mail/detail/mail_detail' } });
  assert.equal(h.navigation.at(-1).url, '/projects/crun/pages/my/index/my_index');
});

test('staff invite activation signs in with WeChat before redeeming the invite', async () => {
  let adminSession;
  const h = harness({ guest: true, realPassport: true, applyAdminSession: value => { adminSession = value; return true; } });
  const token = { id: 'poster', sessionToken: 'b'.repeat(64), status: 0, phoneVerified: false, profileComplete: false };
  h.responses['passport/wechat_identity_login'] = { token, user: { USER_STATUS: 0 } };
  h.responses['passport/staff_invite_redeem'] = () => {
    assert.equal(h.token.sessionToken, token.sessionToken);
    return { ok: true, token: { ...token, staff: true, status: 1 }, admin: { role: 'service' } };
  };
  const page = h.page('admin/index/login/admin_login.js');
  page.setData({ inviteCode: 'K3M7QT2X', agreed: true });
  assert.equal(await page.bindInviteActivate(), true);
  assert.deepEqual(h.calls.map(call => call.route), ['passport/wechat_identity_login', 'passport/staff_invite_redeem']);
  assert.equal(adminSession.role, 'service');
  assert.equal(page.data.activateBusy, false);
});

test('a legacy account verifies its read-only contact phone in personal settings without restarting login', async () => {
  const h = harness({ realPassport: true, phoneLoginEnabled: false });
  const policy = { profilePhoneRequired: true, phoneLoginEnabled: false, allowManualRegistration: false };
  Object.assign(h.responses['operations/config'], policy);
  Object.assign(h.user, policy, { USER_MOBILE_VERIFIED: false });
  h.passport.setToken({ ...h.token, ...policy, phoneVerified: false });
  const page = h.page('my/personal/my_personal.js');
  await page.onLoad();
  assert.equal(page.data.isEdit, true);
  assert.equal(page.data.phoneVerified, false);
  page.bindProfileMobileInput(event({}, '13999999999'));
  assert.equal(page.data.formMobile, '13800000000');
  await page.bindPersonalSubmit();
  assert.match(page.data.saveError, /验证联系电话/);
  assert.equal(h.calls.filter(call => call.route === 'passport/edit_base').length, 0);
  page.bindOpenEducationPicker(event({ kind: 'college' }));
  page.bindSelectEducation(event({ value: '外国语学院' }));
  const token = { ...h.token, phoneVerified: true };
  h.responses['passport/verify_profile_phone'] = { token, user: { USER_MOBILE: '13912345678', USER_MOBILE_VERIFIED: true } };
  await page.bindWechatPhone({ detail: { errMsg: 'getPhoneNumber:ok', code: 'phone-proof' } });
  assert.equal(page.data.formMobile, '13912345678');
  assert.equal(page.data.profileCollege, '外国语学院');
  assert.equal(page.data.phoneVerified, true);
  assert.equal(h.token.sessionToken, token.sessionToken);
  assert.equal(h.navigation.length, 0);
  await page.bindWechatPhone({ detail: { errMsg: 'getPhoneNumber:fail user deny' } });
  assert.equal(page.data.formMobile, '13912345678');
  assert.equal(page.data.phoneVerified, true);
  assert.deepEqual(h.calls.filter(call => /passport\/.*(?:login|phone)/.test(call.route)),
    [{ route: 'passport/verify_profile_phone', params: { code: 'phone-proof' } }]);
});

test('profile education selection filters by college and saves a manual major', async () => {
  const h = harness(), page = h.page('my/personal/my_personal.js');
  const savedCollege = h.user.USER_FORMS.find(item => item.mark === 'college');
  savedCollege.val = '软件学院';
  await page.onLoad();
  assert.equal(page.data.profileCollege, computingCollege);
  assert.equal(page.data.profileSub, '软件工程');

  page.bindOpenEducationPicker(event({ kind: 'major' }));
  page.bindEducationSearch(event({}, '软件'));
  assert.deepEqual(Array.from(page.data.educationOptions), ['软件工程']);
  page.bindSelectEducation(event({ value: '英语' }));
  assert.equal(page.data.educationPicker, 'major');

  page.bindOpenEducationPicker(event({ kind: 'college' }));
  page.bindEducationSearch(event({}, '外国语'));
  assert.deepEqual(Array.from(page.data.educationOptions), ['外国语学院']);
  page.bindSelectEducation(event({ value: '外国语学院' }));
  assert.equal(page.data.profileSub, '');
  page.bindOpenEducationPicker(event({ kind: 'major' }));
  assert.equal(page.data.educationOptions.filter(name => name === '英语').length, 1);
  assert.ok(page.data.educationOptions.includes('英语笔译'));
  page.bindEnterMajorManually();
  page.bindProfileFieldInput(event({ field: 'profileSub' }, '  学校新增专业  '));
  await page.bindPersonalSubmit();
  const forms = h.calls.find(call => call.route === 'passport/edit_base').params.forms;
  assert.equal(forms.find(form => form.mark === 'college').val, '外国语学院');
  assert.equal(forms.find(form => form.mark === 'sub').val, '学校新增专业');
});

test('the Yanshan rollout shows other campuses without allowing them to be selected', async () => {
  const h = harness({ usePublicProfileCampus: true });
  h.storage.set('crun-profile-campuses-v4:shared:', {
    savedAt: Date.now(), value: { campuses: ['育才校区', '王城校区', '雁山校区'], locations: { phases: [], pickupStations: [] } }
  });
  h.responses['tenant/catalog'] = {
    schools: [{ schoolId: 'gxnu', name: '广西师范大学' }],
    campuses: [
      { schoolId: 'gxnu', campusId: 'yucai', name: '育才校区', selectable: false },
      { schoolId: 'gxnu', campusId: 'wangcheng', name: '王城校区', selectable: false },
      { schoolId: 'gxnu', campusId: 'yanshan', name: '雁山校区', selectable: true }
    ]
  };
  const page = h.page('my/personal/my_personal.js');
  await page.onLoad();
  assert.equal(page.data.profileCampusFixed, true);
  assert.equal(page.data.campus, '雁山校区');
  assert.deepEqual(Array.from(page.data.campuses), ['雁山校区']);
  await page.bindOpenCampusPicker();
  assert.deepEqual(JSON.parse(JSON.stringify(page.data.campusOptions)), [
    { name: '雁山校区', selectable: true }, { name: '育才校区', selectable: false }, { name: '王城校区', selectable: false }
  ]);
  page.bindSelectCampus(event({ value: '育才校区' }));
  page.bindCampusChange(event({}, '0'));
  assert.equal(page.data.campusPickerVisible, true);
  assert.equal(page.data.campusDraft, '雁山校区');
  page.bindConfirmCampus();
  assert.equal(page.data.campusPickerVisible, false);
  assert.equal(page.data.campus, '雁山校区');
  assert.equal(h.calls.some(call => call.route === 'passport/edit_base'), false);
  await page.onPullDownRefresh();
  assert.deepEqual(Array.from(page.data.campuses), ['雁山校区']);
  await page.bindPersonalSubmit();
  const saved = h.calls.find(call => call.route === 'passport/edit_base');
  assert.equal(saved.params.forms.find(item => item.mark === 'campus').val, '雁山校区');
});

test('delayed legacy configuration cannot enable manual signup from the default login screen', async () => {
  const h = harness({ guest: true, realPassport: true, manualRegistration: true }), config = deferred();
  const configured = structuredClone(h.responses['operations/config']);
  h.responses['operations/config'] = () => config.promise;
  const page = h.page('my/reg/my_reg.js');
  // A fresh page receives the policy after its initial render.
  page.data.phoneLoginEnabled = false;
  const loading = page.onLoad(); await tick();
  assert.equal(page.data.isLoad, false);
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
  // retUrl=back 且资料完整：直接返回上一页，不再进入个人资料页。
  assert.equal(h.navigation.at(-1).type, 'back');
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
  page.bindCampusServiceTap();
  assert.equal(h.navigation.at(-1).url, '/projects/crun/pages/feedback/index/feedback_index', 'closed customer service falls back to feedback');
  assert.equal(page.data.serviceOpen, false);
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
    assert.equal(page.data.formName, h.user.USER_NAME); assert.equal(page.data.profileCollege, computingCollege);
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
  page.bindOpenEducationPicker(event({ kind: 'college' }));
  page.bindSelectEducation(event({ value: computingCollege }));
  page.bindOpenEducationPicker(event({ kind: 'major' }));
  page.bindSelectEducation(event({ value: '软件工程' }));
  page.bindProfileFieldInput(event({ field: 'profileStudentId' }, '20240001'));
  page.bindChooseStudentCard();
  assert.equal(page.data.profileStudentCard[0], 'temp/new');
  page.bindDisclaimerTap();
  page.bindCampusChange(event({}, 0));
  await page.bindSubmitTap();
  assert.equal(page.data.saveError, '');
  // 头像 + 学生证各选一次图片
  assert.equal(h.images.length, 2);
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

test('native privacy errors preserve the avatar and do not silently switch to a different image API', () => {
  const h=harness(),page=h.page('my/personal/my_personal.js');
  page.setData({canChooseWechatAvatar:true,formPic:'cloud://old-avatar',guideField:'avatar',guideMessage:'请选择头像'});
  page.bindAvatarError({detail:{errMsg:'chooseAvatar:fail api scope is not declared in the privacy agreement'}});
  assert.match(page.data.avatarError,/从相册选择或拍照/);assert.equal(page.data.formPic,'cloud://old-avatar');
  assert.equal(page.data.canChooseWechatAvatar,true);assert.equal(h.images.length,0);
  // 微信头像不可用时，用户可主动点下方的相册入口改用 chooseMedia，而不是自动切换。
  const fields=fs.readFileSync(path.join(__dirname,'../../miniprogram/projects/crun/pages/my/personal/wechat_profile_fields.wxml'),'utf8');
  assert.match(fields,/wx:if="\{\{canChooseWechatAvatar\}\}" class="profile-avatar-fallback" bindtap="bindChooseAvatar"/);
  h.wx.chooseMedia=options=>options.success({tempFiles:[{tempFilePath:'temp/new-avatar.jpg'}]});
  page.bindChooseAvatar();assert.equal(page.data.formPic,'temp/new-avatar.jpg');
  assert.equal(page.data.avatarError,'');assert.equal(page.data.guideField,'');
  assert.equal(page._profileDirty,true);assert.equal(page._avatarPicking,false);
});

test('avatar picker ignores duplicate taps and surfaces both native and synchronous picker failures', () => {
  const h=harness(),page=h.page('my/personal/my_personal.js');let picker,count=0;
  page.setData({formPic:'cloud://old-avatar'});
  h.wx.chooseMedia=options=>{count++;picker=options;};
  page.bindChooseAvatar();page.bindChooseAvatar();assert.equal(count,1);
  picker.fail({errMsg:'chooseMedia:fail auth deny'});
  assert.match(page.data.avatarError,/授权/);assert.equal(page._avatarPicking,false);
  assert.equal(page.data.formPic,'cloud://old-avatar');
  h.wx.chooseMedia=()=>{throw Error('picker failed');};page.bindChooseAvatar();
  assert.match(page.data.avatarError,/失败/);assert.equal(page._avatarPicking,false);
});

test('a late avatar choice after logout or unload cannot overwrite the previous account', () => {
  for(const leave of ['logout','unload']){
    const h=harness({realSessionSignals:true}),page=h.page('my/personal/my_personal.js');let picker;
    page.setData({formPic:'cloud://old-avatar'});h.wx.chooseMedia=options=>{picker=options;};page.bindChooseAvatar();
    if(leave==='logout')h.load('miniprogram/helper/cloud_helper.js').invalidateSessionRequests('logout');
    else page._unloaded=true;
    picker.success({tempFiles:[{tempFilePath:'temp/late.jpg'}]});
    assert.equal(page.data.formPic,'cloud://old-avatar');
  }
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
    const page = h.page('my/reg/my_reg.js');
    page.setData({ phoneLoginEnabled: false });
    const loading = page.onLoad({}); await tick();
    assert.equal(page.data.isLoad, false);
    await page.bindOpenWechatProfile();
    assert.deepEqual(h.calls.map(call => call.route), ['operations/config']);
    pending.resolve(config); await loading;
    assert.equal(page.data.isLoad, true);
    assert.equal(page.data.phoneLoginEnabled, true);
    await page.bindWechatLogin({ detail: { errMsg: 'getPhoneNumber:fail no permission', errno: 102 } });
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
  // 资料已完成时回到登录前的业务页面，而不是再次进入个人资料页。
  assert.equal(h.navigation.at(-1).url, '/projects/crun/pages/mail/add/mail_add');
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
  test('phone login is unavailable while refreshing an account profile that ' + (failed ? 'fails' : 'loads'), async () => {
    const h = harness({ guest: true, realPassport: true }), page = h.page('my/reg/my_reg.js');
    h.responses['passport/my_detail'] = null; await page.onLoad({});
    h.passport.setToken({ id: 'poster', sessionToken: 'b'.repeat(64), status: 0, phoneVerified: false, profileComplete: false });
    const pending = deferred(); h.responses['passport/my_detail'] = () => pending.promise;
    const refresh = page.onPullDownRefresh(); await tick();
    h.responses['passport/wechat_login'] = { token: { id: 'poster', sessionToken: 'b'.repeat(64), status: 0, phoneVerified: true, profileComplete: false },
      user: { USER_MOBILE: '13912345678', USER_MOBILE_VERIFIED: true, USER_PROFILE_COMPLETE: false, USER_STATUS: 0, USER_FORMS: [] } };
    await page.bindWechatLogin({ detail: { errMsg: 'getPhoneNumber:ok', code: 'fresh-phone-code' } });
    assert.equal(h.calls.filter(call => call.route === 'passport/wechat_login').length, 0);
    assert.equal(page.data.isLoad, false);
    if (failed) pending.reject(Error('旧请求超时')); else pending.resolve(null);
    await refresh;
    if (failed) {
      assert.match(page.data.loadError, /登录信息加载失败/);
      h.responses['passport/my_detail'] = null;
      await page._loadLoginState();
    }
    await page.bindWechatLogin({ detail: { errMsg: 'getPhoneNumber:ok', code: 'fresh-phone-code' } });
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
  // 小程序码的 scene 可能被编码成参数串，也可能就是码本身；两种都要认。
  assert.equal(invites.parseScene(encodeURIComponent('code=ghijkl')), 'GHIJKL');
  assert.equal(invites.parseScene('mnopqr'), 'MNOPQR');
  assert.equal(invites.parseScene('not-a-code'), '');
  // 已登录的用户进入小程序时，app.js 统一静默绑定一次，成功后清掉暂存。
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.calls.filter(call => call.route === 'invite/accept').length, 1);
  assert.equal(invites.getPendingCode(), '');
  h.responses['invite/accept'] = () => { throw new Error('offline'); };
  h.app.onShow({ query: { scene: encodeURIComponent('code=ghijkl') } }); assert.equal(invites.getPendingCode(), 'GHIJKL');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(invites.getPendingCode(), 'GHIJKL', '网络失败时保留暂存');
  await assert.rejects(invites.acceptPending(), /offline/); assert.equal(invites.getPendingCode(), 'GHIJKL');
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

  // 小程序码是独立加载的：成功时给保存按钮用，失败时只降级这块卡片。
  await tick(); assert.equal(page.data.qr, 'https://cdn.example/qr.png'); assert.equal(page.data.qrError, '');
  h.responses['invite/my_qrcode'] = () => { throw new Error('qr offline'); };
  page._qrCode = ''; await page.loadQr('ABCDEF');
  assert.equal(page.data.qr, ''); assert.equal(page.data.qrLoading, false); assert.match(page.data.qrError, /暂时无法生成/);
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

test('address edits require a configured place or dormitory phase and preserve the existing detail during selection', async () => {
  const h = harness(), page = h.page('my/address/address.js'); await readyProfile(h, page); page.applyUser(page, h.user);
  page.bindEditAddress(event({ index: 1 }));
  assert.equal(page.data.addressDraft.detail, '二栋');
  assert.equal(page.data.addressDraft.label, '');
  page.bindAddressInput(event({ field: 'detail' }, ''));
  await page.bindSaveAddress(); assert.equal(h.calls.length, 0);
  page.bindAddressInput(event({ field: 'detail' }, '二栋'));
  page.bindOpenPlacePicker(); assert.equal(page.data.placePickerVisible, true);
  page.bindSelectPlace(event({ label: '六期' })); assert.equal(page.data.placeDraft, '');
  page.bindConfirmPlace(); assert.equal(page.data.placePickerVisible, false);
  assert.equal(page.data.addressDraft.label, '');
  page.bindOpenPlacePicker();
  page.bindSelectPlace(event({ label: '二期' })); page.bindConfirmPlace();
  assert.equal(page.data.addressDraft.label, '二期');
  assert.equal(page.data.addressDraft.detail, '二栋');
  assert.equal(page.data.placePickerVisible, false);
  await page.bindSaveAddress();
  assert.equal(page.data.addresses[1].label, '二期'); assert.equal(page.data.addresses[1].detail, '二栋');
  assert.equal(h.calls[0].params.forms.find(form => form.mark === 'address').val, '二期 二栋');
});

test('the place picker lists every configured campus location next to the dormitory phases', async () => {
  const h = harness(), page = h.page('my/address/address.js'); await readyProfile(h, page); page.applyUser(page, h.user);
  const groups = page.data.placeGroups;
  assert.equal(groups.length, 2);
  assert.equal(groups[0].key, 'dorm');
  assert.equal(groups[1].key, 'campus');
  assert.equal(groups[0].items.map(item => item.label).join(','), '一期,二期,三期,四期,五期');
  assert.equal(groups[0].items[0].name, '怡园');
  const campus = groups[1].items.map(item => item.label);
  // 5 个宿舍区地点由期数承载，其余地点逐个保留，总数仍等于地点表的条数。
  assert.equal(groups[0].items.length + campus.length, page.data.addressPhaseOptions.length);
  for (const place of ['图书馆', '东大门', '荷园餐厅', '校友林']) assert.ok(campus.includes(place), place);
  for (const dorm of ['雅园', '怡园', '知园']) assert.ok(!campus.includes(dorm), dorm);
  page.bindAddAddress(); page.bindOpenPlacePicker();
  page.bindSelectPlace(event({ label: '图书馆' }));
  page.bindConfirmPlace();
  page.bindAddressInput(event({ field: 'detail' }, '三楼自习区'));
  await page.bindSaveAddress();
  assert.equal(page.data.addresses.at(-1).label, '图书馆');
  assert.equal(page.data.addresses.at(-1).detail, '三楼自习区');
  assert.equal(page.data.addressEditorVisible, false);
  // 地点是选填项：只填详细地址也能保存，清除地点后不再带标签。
  page.bindAddAddress(); page.bindOpenPlacePicker();
  page.bindSelectPlace(event({ label: '二期' }));
  page.bindClearPlace();
  page.bindConfirmPlace();
  assert.equal(page.data.addressDraft.label, '');
  page.bindAddressInput(event({ field: 'detail' }, '图书馆三楼自习区'));
  await page.bindSaveAddress();
  assert.equal(page.data.addresses.at(-1).label, '');
  assert.equal(page.data.addresses.at(-1).detail, '图书馆三楼自习区');
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

test('a failed WeChat detail save keeps the selection and retries without repeating identity login', async () => {
  const { h, page } = await wechatProfilePage({ uploadAvatar: () => 'cloud://test/profile.jpg' });
  page.bindPicTap({ detail: { avatarUrl: 'wxfile://tmp/profile.jpg' } });
  let failing = true;
  h.responses['passport/wechat_profile'] = params => {
    if (failing) throw Error('资料保存暂时失败');
    return { token: { ...h.token, name: params.name, pic: params.pic } };
  };
  await page.bindProfileFormSubmit(event({}, { nickname: '微信昵称' }));
  assert.match(page.data.saveError, /暂时失败/);
  assert.equal(page.data.formName, '微信昵称');
  assert.equal(page.data.formPic, 'cloud://test/profile.jpg');
  assert.equal(h.calls.filter(call => call.route === 'passport/wechat_profile').length, 1);
  failing = false; await page.bindProfileFormSubmit(event({}, { nickname: '微信昵称' }));
  assert.equal(h.calls.filter(call => call.route === 'passport/wechat_identity_login').length, 0);
  assert.equal(h.calls.filter(call => call.route === 'passport/wechat_profile').length, 2);
  assert.equal(h.token.name, '微信昵称');
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

test('a scanned scene or shared query is stashed, and the registration page pre-fills it', async () => {
  const h = harness({ guest: true }); h.load('miniprogram/app.js');
  const invites = h.load('miniprogram/projects/crun/biz/invite_biz.js');
  // 小程序码：options.query.scene 是 URL 编码过的字符串（参数串或码本身）。
  h.app.onShow({ query: { scene: encodeURIComponent('code=abcdef') } });
  assert.equal(invites.getPendingCode(), 'ABCDEF');
  h.storage.delete('crun-pending-invite');
  h.app.onShow({ query: { scene: encodeURIComponent('ghijkl') } });
  assert.equal(invites.getPendingCode(), 'GHIJKL');
  h.storage.delete('crun-pending-invite');
  // 分享卡片：query.inviteCode。
  h.app.onShow({ query: { inviteCode: 'mnopqr' } });
  assert.equal(invites.getPendingCode(), 'MNOPQR');
  // 脏值不进缓存。
  h.storage.delete('crun-pending-invite');
  h.app.onShow({ query: { scene: 'x=1&y=2' } });
  assert.equal(invites.getPendingCode(), '');
  h.app.onShow({ query: { inviteCode: 'mnopqr' } });
  await tick();
  assert.equal(h.calls.filter(call => call.route === 'invite/accept').length, 0, '未注册用户不调绑定，留给注册页');
  const page = h.page('my/reg/my_reg.js');
  await page.onLoad({});
  assert.equal(page.data.inviteCode, 'MNOPQR');
});

test('a registered user who has not bound an inviter is bound once on entry; bound users are left alone', async () => {
  const h = harness(); h.load('miniprogram/app.js');
  const invites = h.load('miniprogram/projects/crun/biz/invite_biz.js');
  h.app.onShow({ query: { scene: encodeURIComponent('abcdef') } });
  await tick();
  const accepts = () => h.calls.filter(call => call.route === 'invite/accept');
  assert.equal(accepts().length, 1);
  assert.equal(accepts()[0].params.code, 'ABCDEF');
  assert.equal(invites.getPendingCode(), '', '处理完清掉本地暂存');
  h.app.onShow({});
  await tick();
  assert.equal(accepts().length, 1, '没有新的邀请码就不再请求');
  // 已经绑定过邀请人：服务端返回 alreadyAccepted，同样清掉暂存且不改变任何东西。
  h.responses['invite/accept'] = { accepted: true, alreadyAccepted: true, inviter: 'other' };
  h.app.onShow({ query: { inviteCode: 'ghijkl' } });
  await tick();
  assert.equal(invites.getPendingCode(), '');
});

test('the profile page shows my code, uppercases input, and a wrong code never fails the profile save', async () => {
  const h = harness(), page = h.page('my/personal/my_personal.js'); await page.onLoad(); await tick();
  assert.equal(page.data.myInviteCode, 'QWERTY');
  assert.equal(page.data.inviteBound, false);
  page.bindCopyMyInviteCode();
  assert.equal(h.storage.get('clipboard'), 'QWERTY');
  page.bindInviteCodeInput(event({}, 'ab-c12 d'));
  assert.equal(page.data.inviteCode, 'ABC12D');

  h.responses['invite/accept'] = { accepted: false, reason: '邀请码无效' };
  h.calls.length = 0; h.modals.length = 0;
  await page.bindSubmitTap(event({}, { nickname: '小周' }));
  assert.deepEqual(h.calls.map(call => call.route), ['passport/edit_base', 'invite/accept']);
  assert.equal(h.calls[1].params.code, 'ABC12D');
  assert.ok(h.messages.includes('保存成功'), '资料照常保存');
  assert.match(h.modals.at(-1).content, /邀请码未绑定：邀请码无效/);

  // 格式错误在提交前拦截，不会发出任何请求。
  page.setData({ inviteCode: 'ABC' }); h.calls.length = 0;
  await page.bindSubmitTap(event({}, { nickname: '小周' }));
  assert.equal(h.calls.length, 0);
  assert.match(page.data.saveError, /6位/);
});

test('an already-bound account sees a read-only inviter code and never sends one', async () => {
  const h = harness(); h.responses['invite/my_info'] = { code: 'QWERTY', bound: true, boundCode: 'ZXCVBN' };
  h.storage.set('crun-pending-invite', { code: 'ABCDEF', savedAt: Date.now() });
  const page = h.page('my/personal/my_personal.js'); await page.onLoad(); await tick();
  assert.equal(page.data.inviteBound, true);
  assert.equal(page.data.inviteBoundCode, 'ZXCVBN');
  assert.equal(h.storage.has('crun-pending-invite'), false, '已绑定时清掉暂存');
  page.setData({ inviteCode: 'ABCDEF' }); h.calls.length = 0;
  await page.bindSubmitTap(event({}, { nickname: '小周' }));
  assert.deepEqual(h.calls.map(call => call.route), ['passport/edit_base']);
  const wxml = fs.readFileSync(path.resolve(root, 'miniprogram/projects/crun/pages/my/personal/personal_form.wxml'), 'utf8');
  assert.match(wxml, /已填写邀请码 {{inviteBoundCode}}/);
  assert.match(wxml, /邀请码（选填）/);
});

test('registration carries the invite code and shows the server reason when binding fails', async () => {
  const h = harness({ guest: true }), page = h.page('my/reg/my_reg.js');
  h.passport.setToken({ id: 'poster', sessionToken: 'b'.repeat(64), status: 0, phoneVerified: true, profileComplete: false });
  await readyProfile(h, page);
  h.responses['passport/register'] = { token: { id: 'poster', sessionToken: 'b'.repeat(64), name: '小周', status: 1, phoneVerified: true, profileComplete: true }, invite: { accepted: false, reason: '邀请码无效' } };
  page.applyUser(page, h.user); page.setData({ inviteCode: 'zzzzzz', retUrl: 'back' });
  await page.bindSubmitTap();
  assert.deepEqual(h.calls.map(call => call.route), ['passport/register']);
  assert.equal(h.calls[0].params.inviteCode, 'ZZZZZZ');
  assert.equal(h.token.id, 'poster', '资料保存成功，登录态建立');
  assert.match(h.modals.at(-1).content, /邀请码无效/);
  assert.equal(h.storage.has('crun-pending-invite'), false);
});
