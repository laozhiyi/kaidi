'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ready = { id: 'student', sessionToken: 'a'.repeat(64), name: '同学', status: 1, phoneVerified: true, profileComplete: true };
function client(initial = null, storage = new Map()) {
  let token = initial;
  const calls = [], modals = [], navigation = [], diagnostics = [], responses = new Map();
  const module = { exports: {} };
  const wx = { showModal: args => modals.push(args), navigateTo: args => navigation.push(args),
    redirectTo: args => navigation.push(args), navigateBack() {}, reLaunch: args => navigation.push(args), showToast() {},
    getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key) };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../miniprogram/comm/biz/passport_biz.js'), 'utf8'), {
    module, wx, console: { info: (...args) => diagnostics.push(args), warn: (...args) => diagnostics.push(args) },
    getCurrentPages: () => [{ route: 'projects/crun/pages/mail/add/mail_add' }],
    require(name) {
      if (name.endsWith('base_biz.js')) return class {};
      if (name.endsWith('cache_helper.js')) return { get: () => token, set: (_, value) => { token = value; }, remove: () => { token = null; } };
      if (name.endsWith('constants.js')) return { CACHE_TOKEN: 'user', CACHE_TOKEN_EXPIRE: 3600, CACHE_LOGGED_OUT: 'logged-out' };
      if (name.endsWith('page_helper.js')) return { fmtURLByPID: url => '/projects/crun' + url, getCurrentPageUrlWithArgs: () => '/projects/crun/pages/mail/add/mail_add' };
      if (name.endsWith('cloud_helper.js')) return { async callCloudSumbit(route, params) {
        calls.push({ route, params }); const response = responses.get(route);
        if (response instanceof Error) throw response;
        return { data: typeof response === 'function' ? await response(params) : response };
      } };
      if (name.endsWith('helper.js')) return { isDefined: value => value !== undefined && value !== null };
      throw Error('Unexpected passport dependency: ' + name);
    }
  });
  return { passport: module.exports, calls, modals, navigation, diagnostics, responses, storage, get token() { return token; } };
}

test('logout keeps silent refresh and business guards signed out across an app restart', async () => {
  const f = client({ ...ready });
  f.passport.logout();
  assert.equal(f.token, null);
  const restarted = client(null, f.storage);
  for (const session of [f, restarted]) {
    session.responses.set('passport/login', { token: { ...ready } });
    assert.equal(await session.passport.loginSilence(), false);
    assert.equal(await session.passport.loginSilenceMust(), false);
    assert.equal(await session.passport.loginMustCancelWin(), false);
    assert.equal(session.passport.getUserId(), '');
    assert.equal(session.calls.length, 0);
    assert.equal(session.modals.length, 1);
  }
});

test('a login response started before logout cannot restore the session', async () => {
  const f = client({ ...ready }); let finish;
  f.responses.set('passport/login', () => new Promise(resolve => { finish = resolve; }));
  const pending = f.passport.loginSilenceMust();
  f.passport.logout();
  finish({ token: { ...ready } });
  assert.equal(await pending, false);
  assert.equal(f.token, null);
});

test('deliberate login restores an existing manual account without registering it again', async () => {
  const f = client({ ...ready });
  f.passport.logout();
  f.responses.set('passport/wechat_identity_login', { token: { ...ready, phoneVerified: false, allowManualRegistration: true }, user: { USER_NAME: '同学', USER_STATUS: 1 } });
  const result = await f.passport.loginByUser();
  assert.equal(result.user.USER_NAME, '同学');
  assert.equal(f.passport.isLoggedOut(), false);
  assert.equal(f.passport.isLogin(), true);
  assert.equal(f.token.phoneVerified, false);
  assert.deepEqual(f.calls.map(call => call.route), ['passport/wechat_identity_login']);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0].params)), {});
});

test('failed deliberate login preserves logout and can be retried', async () => {
  const f = client({ ...ready });
  f.passport.logout();
  f.responses.set('passport/wechat_identity_login', new Error('offline'));
  await assert.rejects(f.passport.loginByUser(), /offline|登录/);
  assert.equal(f.passport.isLoggedOut(), true);
  assert.equal(await f.passport.loginSilenceMust(), false);
  assert.equal(f.calls.length, 1);
  f.responses.set('passport/wechat_identity_login', { token: { ...ready }, user: { USER_STATUS: 1 } });
  assert.equal((await f.passport.loginByUser()).token.id, 'student');
});

test('identity login keeps a new authenticated account even before required business details are completed', async () => {
  const f = client(); f.passport.logout();
  f.responses.set('passport/wechat_identity_login', { token: { ...ready, status: 0, phoneVerified: false, profileComplete: false, allowManualRegistration: true },
    user: { USER_NAME: '', USER_STATUS: 0, USER_MOBILE_VERIFIED: false, USER_PROFILE_COMPLETE: false } });
  const result = await f.passport.loginByUser();
  assert.equal(result.token.id, 'student');
  assert.equal(f.passport.isLoggedOut(), false);
  assert.equal(f.passport.getUserId(), 'student');
  assert.equal(f.passport.isLogin(), false, 'business readiness is still required');
  assert.deepEqual(f.calls.map(call => call.route), ['passport/wechat_identity_login']);
});

test('an explicit identity response cannot restore a session after a later logout', async () => {
  const f = client(); let finish;
  f.responses.set('passport/wechat_identity_login', () => new Promise(resolve => { finish = resolve; }));
  const pending = f.passport.loginByUser();
  await Promise.resolve();
  f.passport.logout();
  assert.equal(typeof finish, 'function');
  finish({ token: { ...ready }, user: { USER_STATUS: 1 } });
  await assert.rejects(pending, /登录/);
  assert.equal(f.passport.isLoggedOut(), true);
  assert.equal(f.token, null);
});

test('incomplete or disabled identity responses never clear a deliberate logout', async () => {
  for (const response of [null, { token: ready }, { token: null, user: {} }, { token: { ...ready, status: 9 }, user: { USER_STATUS: 9 } }]) {
    const f = client(); f.passport.logout();
    f.responses.set('passport/wechat_identity_login', response);
    await assert.rejects(f.passport.loginByUser(), /登录|停用|禁用/);
    assert.equal(f.passport.isLoggedOut(), true);
    assert.equal(f.token, null);
  }
});

test('new phone authorization can log back in after logout', async () => {
  const f = client({ ...ready });
  f.passport.logout();
  f.responses.set('passport/wechat_login', { token: { ...ready }, user: { USER_MOBILE: '13912345678' } });
  await f.passport.loginByWechatPhone({ detail: { errMsg: 'getPhoneNumber:ok', code: 'new-code' } });
  assert.equal(f.passport.isLoggedOut(), false);
  assert.equal(f.passport.isLogin(), true);
});

test('phone authorization started before logout cannot sign the user back in', async () => {
  const f = client({ ...ready }); let finish;
  f.responses.set('passport/wechat_login', () => new Promise(resolve => { finish = resolve; }));
  const pending = f.passport.loginByWechatPhone({ detail: { errMsg: 'getPhoneNumber:ok', code: 'old-code' } });
  f.passport.logout();
  finish({ token: { ...ready }, user: { USER_MOBILE: '13912345678' } });
  await assert.rejects(pending, /登录/);
  assert.equal(f.token, null);
});

for (const overrides of [{ phoneVerified: false }, { profileComplete: false }, { status: 0 }, { status: 8 }, { status: 9 }]) {
  test('cached account ' + JSON.stringify(overrides) + ' cannot pass the business login gate', async () => {
    const f = client({ ...ready, ...overrides });
    assert.equal(await f.passport.loginMustCancelWin(), false);
    assert.equal(f.modals.length, 1);
    assert.equal(f.passport.isLogin(), false);
  });
}

test('legacy cached tokens without a server credential require an explicit login', async () => {
  const f = client({ id: 'student', status: 1 });
  f.responses.set('passport/login', { token: { ...ready, phoneVerified: false } });
  assert.equal(await f.passport.loginSilence(), false);
  assert.equal(f.calls.length, 0);
  assert.equal(f.passport.isLogin(), false);
  assert.equal(f.passport.getToken(), null);
});

test('offline logout is local immediately and retries server revocation after restart', async () => {
  const f = client({ ...ready });
  f.responses.set('passport/logout', () => { throw new Error('offline'); });
  const revoking = f.passport.logoutByUser();
  assert.equal(f.passport.getToken(), null); assert.equal(f.passport.isLoggedOut(), true);
  assert.equal(await revoking, false); assert.ok(f.storage.get('CACHE_PENDING_LOGOUT'));
  const restarted = client(null, f.storage); restarted.responses.set('passport/logout', { ok: true });
  assert.equal(await restarted.passport.flushLogout(), true);
  assert.equal(f.storage.has('CACHE_PENDING_LOGOUT'), false); assert.equal(restarted.passport.isLoggedOut(), true);
});

test('phone authorization sends only the one-time code and retains the incomplete authenticated session', async () => {
  const f = client();
  f.responses.set('passport/wechat_login', { token: { ...ready, status: 0, profileComplete: false }, user: { USER_MOBILE: '13912345678' } });
  await f.passport.loginByWechatPhone({ detail: { errMsg: 'getPhoneNumber:ok', code: 'one-time-code', phoneNumber: 'forged', cloudID: 'unused' } });
  assert.equal(f.calls.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0])), { route: 'passport/wechat_login', params: { code: 'one-time-code' } });
  assert.equal(f.token.phoneVerified, true); assert.equal(f.token.profileComplete, false);
  assert.equal(f.passport.isLogin(), false);
});

test('declined authorization makes no cloud call and preserves an existing session', async () => {
  const f = client({ ...ready });
  await assert.rejects(f.passport.loginByWechatPhone({ detail: { errMsg: 'getPhoneNumber:fail user deny' } }), /授权/);
  assert.equal(f.calls.length, 0); assert.equal(f.token.id, 'student');
});

for (const [detail, reason, message] of [
  [{ errMsg: 'getPhoneNumber:fail user deny' }, 'cancelled', /取消/],
  [{ errMsg: 'getPhoneNumber:fail api scope is not declared in the privacy agreement', errno: 104 }, 'privacy', /隐私/],
  [{ errMsg: 'getPhoneNumber:fail no permission', errno: 102 }, 'permission_denied', /手机号获取权限/],
  [{ errMsg: 'getPhoneNumber:fail', errno: 102 }, 'permission_denied', /手机号获取权限/],
  [{ errMsg: 'getPhoneNumber:fail not support' }, 'unsupported', /更新微信/],
  [{ errMsg: 'getPhoneNumber:ok' }, 'missing_code', /未返回/]
]) {
  test('native phone failure ' + reason + ' has its own explanation without calling the cloud', async () => {
    const f = client({ ...ready });
    await assert.rejects(f.passport.loginByWechatPhone({ detail }), error => error.reason === reason && message.test(error.message));
    assert.equal(f.calls.length, 0);
    assert.equal(f.token.id, 'student');
    assert.equal(f.diagnostics.at(-1)[1].stage, 'native_callback');
    assert.equal(f.diagnostics.at(-1)[1].reason, reason);
  });
}

for (const [errMsg, reason, message] of [
  ['cloud.callFunction:fail -501000 Environment not found', 'environment_missing', /服务配置/],
  ['cloud.callFunction:fail -501000 FunctionName parameter could not be found', 'function_missing', /服务暂不可用/],
  ['cloud.callFunction:fail request timeout', 'timeout', /超时/]
]) {
  test('cloud phone failure ' + reason + ' survives the generic SDK wrapper message', async () => {
    const f = client({ ...ready });
    f.responses.set('passport/wechat_login', () => { throw { msg: '网络连接异常，请稍后重试', errCode: -501000, errMsg }; });
    await assert.rejects(f.passport.loginByWechatPhone({ detail: { errMsg: 'getPhoneNumber:ok', code: 'do-not-retry' } }), message);
    assert.equal(f.calls.length, 1, 'never automatically replay a one-time phone code');
    assert.equal(f.token.id, 'student');
    assert.equal(f.diagnostics.at(-1)[1].stage, 'cloud_failure');
    assert.equal(f.diagnostics.at(-1)[1].reason, reason);
    assert.equal(f.diagnostics.at(-1)[1].errCode, -501000);
  });
}

test('phone diagnostics identify the failing boundary without exposing authorization data', async () => {
  const f = client(), secret = 'do-not-log-this-phone-code', phone = '13912345678';
  const native = { errMsg: 'getPhoneNumber:ok', code: secret, encryptedData: 'private-encrypted-data' };
  f.responses.set('passport/wechat_login', () => { throw { errCode: -1, errMsg: 'internal failure ' + secret + ' ' + phone, token: 'private-token' }; });
  await assert.rejects(f.passport.loginByWechatPhone({ detail: native }));
  assert.deepEqual(f.diagnostics.map(item => item[1].stage), ['native_callback', 'cloud_request', 'cloud_failure']);
  const text = JSON.stringify(f.diagnostics);
  for (const value of [secret, phone, native.encryptedData, 'private-token']) assert.ok(!text.includes(value));
  assert.equal(f.token, null);
});

test('an earlier silent login reply cannot overwrite a completed phone login', async () => {
  const f = client({ ...ready }); let finish;
  f.responses.set('passport/login', () => new Promise(resolve => { finish = resolve; }));
  const old = f.passport.loginSilenceMust();
  f.responses.set('passport/wechat_login', { token: { ...ready }, user: { USER_MOBILE: '13912345678' } });
  await f.passport.loginByWechatPhone({ detail: { errMsg: 'getPhoneNumber:ok', code: 'fresh-code' } });
  finish({ token: null }); await old;
  assert.equal(f.token.id, 'student'); assert.equal(f.passport.isLogin(), true);
});

test('partial accounts are sent to the completion page while keeping the original destination', async () => {
  const f = client({ ...ready, profileComplete: false });
  assert.equal(await f.passport.loginMustBackWin(), false);
  f.modals[0].success({ confirm: true });
  assert.match(f.navigation[0].url, /my\/reg\/my_reg\?retUrl=/);
  assert.ok(f.navigation[0].url.includes(encodeURIComponent('/projects/crun/pages/mail/add/mail_add')));
});

test('server-enabled manual accounts can use features without claiming a verified phone', async () => {
  const manual = { ...ready, phoneVerified: false, allowManualRegistration: true };
  const f = client(manual); f.responses.set('passport/login', { token: manual });
  assert.equal(f.passport.isLogin(), true);
  assert.equal(await f.passport.loginMustCancelWin(), true);
  assert.equal(f.token.phoneVerified, false);
  assert.equal(f.modals.length, 0);
});

for (const status of [0, 8, 9]) {
  test('manual account status ' + status + ' still blocks business access with the correct explanation', async () => {
    const manual = { ...ready, status, phoneVerified: false, allowManualRegistration: true };
    const f = client(manual); f.responses.set('passport/login', { token: manual });
    assert.equal(await f.passport.loginMustCancelWin(), false);
    assert.match(f.modals[0].content, /审核|禁用/);
    assert.equal(f.passport.isLogin(), false);
  });
}

test('manual sessions revalidate the server policy so strict mode takes effect without clearing storage', async () => {
  const f = client({ ...ready, phoneVerified: false, allowManualRegistration: true });
  f.responses.set('passport/login', { token: { ...ready, phoneVerified: false, allowManualRegistration: false } });
  assert.equal(await f.passport.loginMustCancelWin(), false);
  assert.equal(f.calls.length, 1);
  assert.equal(f.token.allowManualRegistration, false);
  assert.equal(f.passport.isLogin(), false);
});
