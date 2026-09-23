'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, A, B, C, tenant } = require('../test-support/tenant-services.cjs');
const APPID = 'wx3d8dc6fb0e764ec7';
const mobile = '13912345678';
const profile = (scope = A) => ({ name: '新同学', mobile, pic: 'cloud://test/avatar.png', forms: [
  { mark: 'sex', val: '女' }, { mark: 'college', val: '计算机学院' },
  { mark: 'sub', val: '软件工程' }, { mark: 'campus', val: scope.campusName }
] });
const readyUser = () => ({ USER_MINI_OPENID: 'new-user', USER_STATUS: 1, USER_NAME: '新同学',
  USER_MOBILE: mobile, USER_MOBILE_VERIFIED: true, USER_PROFILE_COMPLETE: true,
  USER_PIC: 'cloud://test/avatar.png', USER_FORMS: profile().forms });
async function setup(options) {
  // Existing cases cover the retained phone flow; identity cases opt out.
  const f = fixture({ phoneLoginEnabled: true, ...options }); await f.setup();
  f.cloud.getWXContext = () => ({ OPENID: 'new-user', APPID });
  f.phoneCalls = [];
  f.cloud.openapi.phonenumber = { async getPhoneNumber(input) {
    f.phoneCalls.push(input);
    return { errCode: 0, errMsg: 'openapi.phonenumber.getPhoneNumber:ok', phoneInfo: {
      phoneNumber: mobile, purePhoneNumber: mobile, countryCode: '86', watermark: { timestamp: 1789980000, appid: APPID }
    } };
  } };
  f.passport = () => new (f.service('passport_service'))();
  f.row = (scope = A, id = 'new-user') => tenant.run(scope, () => f.table('user').get(f.store.schoolKey('crun', 'user', id)));
  f.putUser = (data = readyUser()) => f.put(A, 'user', tenant.run(A, () => f.store.schoolKey('crun', 'user', 'new-user')), data);
  return f;
}

test('WeChat nickname and avatar save independently and survive later identity login', async () => {
  const f = await setup({ phoneLoginEnabled: false });
  await tenant.run(A, () => f.passport().wechatIdentityLogin('new-user'));
  const owners = f.table('identity_unique').size;
  const saved = await tenant.run(A, () => f.passport().saveWechatProfile('new-user', {
    name: '微信昵称', pic: 'cloud://test/wechat-avatar.jpg', mobile, forms: profile().forms, USER_STATUS: 1, USER_PROFILE_COMPLETE: true
  }));
  assert.equal(saved.token.name, '微信昵称'); assert.equal(saved.token.pic, 'cloud://test/wechat-avatar.jpg');
  assert.equal(saved.token.status, 0); assert.equal(saved.token.profileComplete, false); assert.equal(saved.token.phoneVerified, false);
  assert.equal(f.row().USER_MOBILE, ''); assert.deepEqual(JSON.parse(JSON.stringify(f.row().USER_FORMS)), []);
  assert.equal(f.table('identity_unique').size, owners); assert.equal(f.phoneCalls.length, 0);
  const login = await tenant.run(A, () => f.passport().wechatIdentityLogin('new-user'));
  assert.equal(login.user.USER_NAME, '微信昵称'); assert.equal(login.user.USER_PIC, 'cloud://test/wechat-avatar.jpg');
  await assert.rejects(tenant.run(A, () => new (f.service('mail_service'))()._user('new-user')));
});

test('saving only WeChat details preserves contact data and every review status', async () => {
  const f = await setup({ phoneLoginEnabled: false });
  for (const status of [0, 1, 8]) {
    await f.putUser({ ...readyUser(), USER_STATUS: status });
    const saved = await tenant.run(A, () => f.passport().saveWechatProfile('new-user', { name: '新昵称', pic: 'cloud://test/new.jpg' }));
    assert.equal(saved.token.status, status); assert.equal(saved.token.profileComplete, true);
    assert.equal(f.row().USER_MOBILE, mobile); assert.equal(f.row().USER_MOBILE_VERIFIED, true);
    assert.deepEqual(JSON.parse(JSON.stringify(f.row().USER_FORMS)), profile().forms);
  }
});

test('WeChat detail saving rejects missing, disabled, or concurrently deleted accounts', async () => {
  const f = await setup({ phoneLoginEnabled: false }), input = { name: '微信昵称', pic: 'cloud://test/avatar.jpg' };
  await assert.rejects(tenant.run(A, () => f.passport().saveWechatProfile('new-user', input)), /微信.*登录|账号/);
  assert.equal(f.row(), undefined);
  await f.putUser({ ...readyUser(), USER_STATUS: 9 });
  await assert.rejects(tenant.run(A, () => f.passport().saveWechatProfile('new-user', input)), /停用|禁用/);
  await f.putUser();
  const transaction = f.store.transaction;
  f.store.transaction = async callback => {
    f.table('user').delete(tenant.run(A, () => f.store.schoolKey('crun', 'user', 'new-user')));
    return transaction(callback);
  };
  await assert.rejects(tenant.run(A, () => f.passport().saveWechatProfile('new-user', input)), /登录|账号/);
  assert.equal(f.row(), undefined);
});

test('failed phone exchanges retain only the numeric provider error in diagnostics', async () => {
  const logs = [], f = await setup({ console: { log() {}, info() {}, error() {}, warn: (...args) => logs.push(args) } });
  const secret = 'private-phone-code';
  f.cloud.openapi.phonenumber.getPhoneNumber = async () => {
    throw { errCode: 40029, errMsg: 'invalid code ' + secret, phoneNumber: mobile, openid: 'private-openid' };
  };
  await assert.rejects(tenant.run(A, () => f.passport().wechatLogin('new-user', { code: secret })), /授权失败/);
  assert.equal(f.row(), undefined);
  assert.equal(logs.length, 1);
  assert.equal(logs[0][1].stage, 'phone_exchange_failure');
  assert.equal(logs[0][1].errCode, 40029);
  const text = JSON.stringify(logs);
  for (const value of [secret, mobile, 'private-openid']) assert.ok(!text.includes(value));
});

test('hand-entered registration cannot claim a verified WeChat phone or active account', async () => {
  const f = await setup();
  await assert.rejects(tenant.run(A, () => f.passport().register('new-user', {
    ...profile(), status: 1, mobileVerified: true, USER_MOBILE_VERIFIED: true
  })), /微信|授权/);
  assert.equal(f.row(), undefined);
});

for (const phoneLoginEnabled of [false, true]) {
  test('profile submission cannot create a user even when the old manual flag is enabled: phone=' + phoneLoginEnabled, async () => {
    const f = await setup({ phoneLoginEnabled, allowManualRegistration: true });
    const usersBefore = f.table('user').size, phoneOwnersBefore = f.table('identity_unique').size;
    await assert.rejects(tenant.run(A, () => f.passport().register('new-user', {
      ...profile(), userId: 'forged-user', USER_MINI_OPENID: 'forged-user', mobileVerified: true
    })), /微信.*登录/);
    assert.equal(f.row(), undefined);
    assert.equal(f.table('user').size, usersBefore);
    assert.equal(f.table('identity_unique').size, phoneOwnersBefore);
    assert.equal(f.phoneCalls.length, 0);
  });
}

test('editing a verified profile preserves the verified phone and updates login details', async () => {
  const f = await setup(); await f.putUser();
  const result = await tenant.run(A, () => f.passport().editBase('new-user', { ...profile(), name: '新昵称' }));
  assert.equal(f.row().USER_MOBILE_VERIFIED, true);
  assert.equal(f.row().USER_NAME, '新昵称');
  assert.equal(result.token.phoneVerified, true);
  assert.equal(result.token.profileComplete, true);
});

test('a direct profile edit cannot replace the phone with an unverified number', async () => {
  const f = await setup(); await f.putUser();
  await assert.rejects(tenant.run(A, () => f.passport().editBase('new-user', { ...profile(), mobile: '13987654321' })), /授权|手机号/);
  assert.equal(f.row().USER_MOBILE, mobile);
  assert.equal(f.row().USER_MOBILE_VERIFIED, true);
});

for (const mark of ['sex', 'college', 'sub', 'campus']) {
  test('server requires the registration field ' + mark + ' even when the page is bypassed', async () => {
    const f = await setup(); await f.putUser(); const input = profile();
    input.forms = input.forms.filter(item => item.mark !== mark);
    await assert.rejects(tenant.run(A, () => f.passport().editBase('new-user', input)), /性别|学院|专业|校区|资料/);
    assert.equal(f.row().USER_FORMS.length, 4);
  });
}

test('active status alone does not permit business access with an incomplete or unverified profile', async () => {
  const f = await setup();
  for (const changed of [{ USER_FORMS: [] }, { USER_MOBILE_VERIFIED: false }, { USER_PROFILE_COMPLETE: false }]) {
    await f.putUser({ ...readyUser(), ...changed });
    await assert.rejects(tenant.run(A, () => new (f.service('mail_service'))()._user('new-user')), /微信|资料|补全/);
  }
});

test('order transactions recheck profile readiness after the initial user check', async () => {
  const f = await setup(); await f.putUser();
  await tenant.run(A, async () => {
    const mail = new (f.service('mail_service'))(), user = await mail._user('new-user');
    await f.putUser({ ...readyUser(), USER_MOBILE_VERIFIED: false });
    await assert.rejects(f.store.transaction(tx => mail._actor(tx, { user, userId: 'new-user' })), /微信|资料|补全/);
  });
});

test('WeChat phone login creates one incomplete account and only completed registration enables business', async () => {
  const f = await setup();
  const login = await tenant.run(A, () => f.passport().wechatLogin('new-user', { code: 'one-use-code', mobile: '13987654321' }));
  assert.equal(login.token.id, 'new-user');
  assert.equal(login.token.phoneVerified, true);
  assert.equal(login.token.profileComplete, false);
  assert.equal(login.user.USER_MOBILE, mobile);
  assert.deepEqual(JSON.parse(JSON.stringify(f.phoneCalls)), [{ code: 'one-use-code' }]);
  assert.equal(f.row().USER_MOBILE_VERIFIED, true);
  await assert.rejects(tenant.run(A, () => new (f.service('mail_service'))()._user('new-user')));
  const result = await tenant.run(A, () => f.passport().register('new-user', profile()));
  assert.equal(result.token.status, 1); assert.equal(result.token.profileComplete, true);
  assert.equal((await tenant.run(A, () => new (f.service('mail_service'))()._user('new-user'))).USER_MOBILE, mobile);
  const repeated = await tenant.run(A, () => f.passport().wechatLogin('new-user', { code: 'new-code' }));
  assert.equal(repeated.token.profileComplete, true);
  assert.equal(f.row().USER_NAME, '新同学');
  assert.equal([...f.table('user').values()].filter(row => row.USER_MINI_OPENID === 'new-user').length, 1);
});

test('first profile completion obeys the current school review rule and ignores client status', async () => {
  const f = await setup();
  await tenant.run(A, () => f.passport().wechatLogin('new-user', { code: 'before-policy-change' }));
  f.table('school').get(A.schoolId).registrationReview = true;
  const result = await tenant.run(A, () => f.passport().register('new-user', { ...profile(), status: 1 }));
  assert.equal(result.token.status, 0); assert.equal(result.token.profileComplete, true);
  await assert.rejects(tenant.run(A, () => new (f.service('mail_service'))()._user('new-user')));
});

test('phone ownership is exclusive across campuses of a school and isolated between schools', async () => {
  const f = await setup();
  const results = await Promise.allSettled([
    tenant.run(A, () => f.passport().wechatLogin('new-user', { code: 'a-code' })),
    tenant.run(B, () => f.passport().wechatLogin('second-user', { code: 'b-code' }))
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.match(results.find(result => result.status === 'rejected').reason.message, /登记|绑定/);
  const otherSchool = await tenant.run(C, () => f.passport().wechatLogin('second-user', { code: 'c-code' }));
  assert.equal(otherSchool.token.phoneVerified, true);
});

test('failed, expired, mismatched-app and malformed phone authorizations create no account', async () => {
  for (const response of [
    { errCode: 40029 },
    { errCode: 0, phoneInfo: { purePhoneNumber: mobile, countryCode: '86', watermark: { appid: 'other-app' } } },
    { errCode: 0, phoneInfo: { purePhoneNumber: '123', countryCode: '86', watermark: { appid: APPID } } },
    { errCode: 0, phoneInfo: { purePhoneNumber: mobile, countryCode: '86' } }
  ]) {
    const f = await setup(); f.cloud.openapi.phonenumber.getPhoneNumber = async () => response;
    await assert.rejects(tenant.run(A, () => f.passport().wechatLogin('new-user', { code: 'bad-code' })), /微信|授权|手机号/);
    assert.equal(f.row(), undefined);
  }
  const f = await setup();
  f.cloud.openapi.phonenumber.getPhoneNumber = async () => { throw Object.assign(Error('platform failure'), { errCode: 48001 }); };
  await assert.rejects(tenant.run(A, () => f.passport().wechatLogin('new-user', { code: 'no-permission' })), /微信|授权|手机号/);
  assert.equal(f.row(), undefined);
});

test('authorization cannot revive a disabled account or bypass rejected registration', async () => {
  const f = await setup(); await f.putUser({ ...readyUser(), USER_STATUS: 9 });
  await assert.rejects(tenant.run(A, () => f.passport().wechatLogin('new-user', { code: 'disabled' })), /停用|禁用/);
  assert.equal(f.phoneCalls.length, 0);
  await f.putUser({ ...readyUser(), USER_STATUS: 8 });
  const login = await tenant.run(A, () => f.passport().wechatLogin('new-user', { code: 'rejected' }));
  assert.equal(login.token.status, 8);
  const saved = await tenant.run(A, () => f.passport().editBase('new-user', profile()));
  assert.equal(saved.token.status, 0);
});

test('successful phone rebinding rejects a stale profile save and releases only its own old phone', async () => {
  const f = await setup(); await f.putUser();
  await tenant.run(A, () => f.passport().wechatLogin('new-user', { code: 'verify-original' }));
  const phoneResult = f.cloud.openapi.phonenumber.getPhoneNumber;
  f.cloud.openapi.phonenumber.getPhoneNumber = async input => {
    const result = await phoneResult(input); result.phoneInfo.purePhoneNumber = '13987654321'; result.phoneInfo.phoneNumber = '13987654321'; return result;
  };
  await tenant.run(A, () => f.passport().wechatLogin('new-user', { code: 'bind-new-number' }));
  await assert.rejects(tenant.run(A, () => f.passport().editBase('new-user', profile())), /授权|手机号/);
  assert.equal(f.row().USER_MOBILE, '13987654321');
  assert.equal(f.row().USER_MOBILE_VERIFIED, true);
  assert.equal(tenant.run(A, () => f.table('identity_unique').has(f.store.schoolKey('crun', 'phone', mobile))), false);
});

test('profile completion after WeChat login leaves the phone unverified and permits publishing', async () => {
  const f = await setup({ phoneLoginEnabled: false });
  await tenant.run(A, () => f.passport().wechatIdentityLogin('new-user'));
  const result = await tenant.run(A, () => f.passport().register('new-user', {
    ...profile(), userId: 'forged-user', USER_MINI_OPENID: 'forged-user', mobileVerified: true, USER_MOBILE_VERIFIED: true
  }));
  assert.equal(result.token.id, 'new-user');
  assert.equal(result.token.status, 1);
  assert.equal(result.token.phoneVerified, false);
  assert.equal(result.token.allowManualRegistration, true);
  assert.equal(result.token.profileComplete, true);
  assert.equal(f.row().USER_MOBILE_VERIFIED, false);
  assert.equal(f.row().USER_MINI_OPENID, 'new-user');
  assert.equal(f.phoneCalls.length, 0);
  const detail = await tenant.run(A, () => f.passport().getMyDetail('new-user'));
  assert.equal(detail.allowManualRegistration, true);
  const order = await tenant.run(A, () => new (f.service('mail_service'))().insertMail('new-user', { forms: f.forms(), requestId: 'manual_publish_0001' }));
  assert.equal(f.table('mail').get(order._id).MAIL_USER_ID, 'new-user');
});

test('public configuration advertises only the server-selected manual registration policy', async () => {
  const f = await setup({ allowManualRegistration: true });
  const service = new (f.service('operations_service'))();
  assert.equal((await tenant.run(A, () => service.config('new-user'))).allowManualRegistration, true);
  f.load('config/config.js').ALLOW_MANUAL_REGISTRATION = false;
  assert.equal((await tenant.run(A, () => service.config('new-user'))).allowManualRegistration, false);
});

test('existing unverified profiles can be completed and edited without native authorization', async () => {
  const f = await setup({ allowManualRegistration: true });
  await f.putUser({ ...readyUser(), USER_MOBILE_VERIFIED: false, USER_PROFILE_COMPLETE: false, USER_STATUS: 0 });
  const result = await tenant.run(A, () => f.passport().register('new-user', profile()));
  assert.equal(result.token.status, 1);
  const edited = await tenant.run(A, () => f.passport().editBase('new-user', { ...profile(), name: '手填昵称', mobile: '13987654321' }));
  assert.equal(edited.token.phoneVerified, false);
  assert.equal(f.row().USER_NAME, '手填昵称');
  assert.equal(f.row().USER_MOBILE, '13987654321');
  assert.equal(tenant.run(A, () => f.table('identity_unique').has(f.store.schoolKey('crun', 'phone', mobile))), false);
  assert.equal(f.phoneCalls.length, 0);
});

test('profile completion after WeChat login obeys school review and disabled or rejected account states', async () => {
  const f = await setup({ phoneLoginEnabled: false });
  await tenant.run(A, () => f.passport().wechatIdentityLogin('new-user'));
  f.table('school').get(A.schoolId).registrationReview = true;
  const registered = await tenant.run(A, () => f.passport().register('new-user', { ...profile(), status: 1 }));
  assert.equal(registered.token.status, 0);
  await assert.rejects(tenant.run(A, () => new (f.service('mail_service'))()._user('new-user')));
  f.table('school').get(A.schoolId).registrationReview = false;
  const pending = await tenant.run(A, () => f.passport().editBase('new-user', profile()));
  assert.equal(pending.token.status, 0, 'editing does not silently approve an existing pending account');
  await f.putUser({ ...readyUser(), USER_MOBILE_VERIFIED: false, USER_STATUS: 8 });
  assert.equal((await tenant.run(A, () => f.passport().editBase('new-user', profile()))).token.status, 0);
  await f.putUser({ ...readyUser(), USER_MOBILE_VERIFIED: false, USER_STATUS: 9 });
  await assert.rejects(tenant.run(A, () => f.passport().register('new-user', profile())), /停用|禁用/);
  await assert.rejects(tenant.run(A, () => f.passport().editBase('new-user', profile())), /停用|禁用/);
});

test('profile completion retains required fields and rejects users who have not logged in', async () => {
  const f = await setup({ phoneLoginEnabled: false });
  await assert.rejects(tenant.run(A, () => f.passport().register('', profile())), /登录/);
  await assert.rejects(tenant.run(A, () => f.passport().editBase('new-user', profile())), /登录/);
  await tenant.run(A, () => f.passport().wechatIdentityLogin('new-user'));
  const before = structuredClone(f.row());
  for (const change of [{ mobile: '123' }, { forms: [] }, { pic: '' }, { name: '' }]) {
    await assert.rejects(tenant.run(A, () => f.passport().register('new-user', { ...profile(), ...change })), /手机|资料|性别|头像|昵称/);
    assert.deepEqual(f.row(), before);
  }
});

test('concurrent profile completions enforce school phone ownership for WeChat accounts', async () => {
  const f = await setup({ phoneLoginEnabled: false });
  await tenant.run(A, () => f.passport().wechatIdentityLogin('new-user'));
  await tenant.run(B, () => f.passport().wechatIdentityLogin('second-user'));
  const competing = await Promise.allSettled([
    tenant.run(A, () => f.passport().register('new-user', profile(A))),
    tenant.run(B, () => f.passport().register('second-user', profile(B)))
  ]);
  assert.equal(competing.filter(result => result.status === 'fulfilled').length, 1);
  assert.match(competing.find(result => result.status === 'rejected').reason.message, /登记/);
  await tenant.run(C, () => f.passport().wechatIdentityLogin('second-user'));
  const otherSchool = await tenant.run(C, () => f.passport().register('second-user', profile(C)));
  assert.equal(otherSchool.token.phoneVerified, false);
  const repeated = await Promise.all([
    tenant.run(C, () => f.passport().register('second-user', profile(C))),
    tenant.run(C, () => f.passport().register('second-user', profile(C)))
  ]);
  assert.equal(repeated.length, 2);
  assert.equal([...f.table('user').values()].filter(row => row.schoolId === C.schoolId && row.USER_MINI_OPENID === 'second-user').length, 1);
});

test('profile completion detects legacy phone owners even before the uniqueness index is seeded', async () => {
  const f = await setup({ phoneLoginEnabled: false });
  await tenant.run(A, () => f.passport().wechatIdentityLogin('new-user'));
  await f.put(A, 'user', 'legacy-owner', { ...readyUser(), USER_MINI_OPENID: 'legacy-owner' });
  await assert.rejects(tenant.run(B, () => f.passport().register('new-user', profile(B))), /登记/);
  assert.equal(f.row().USER_MOBILE, '');
  assert.equal(f.row().USER_PROFILE_COMPLETE, false);
});

test('enabling manual registration never lets an already verified phone be replaced by typing', async () => {
  const f = await setup({ allowManualRegistration: true }); await f.putUser();
  await assert.rejects(tenant.run(A, () => f.passport().editBase('new-user', { ...profile(), mobile: '13987654321' })), /授权|手机号/);
  assert.equal(f.row().USER_MOBILE_VERIFIED, true);
  assert.equal(f.row().USER_MOBILE, mobile);
});

test('restoring strict mode blocks manual accounts in login eligibility and in-flight business transactions', async () => {
  const f = await setup({ allowManualRegistration: true });
  await tenant.run(A, () => f.passport().wechatIdentityLogin('new-user'));
  await tenant.run(A, () => f.passport().register('new-user', profile()));
  await tenant.run(A, async () => {
    const mail = new (f.service('mail_service'))(), user = await mail._user('new-user');
    f.load('config/config.js').ALLOW_MANUAL_REGISTRATION = false;
    assert.equal((await f.passport().login('new-user')).token.allowManualRegistration, false);
    assert.equal((await f.passport().getMyDetail('new-user')).allowManualRegistration, false);
    await assert.rejects(mail._user('new-user'), /微信|资料/);
    await assert.rejects(f.store.transaction(tx => mail._actor(tx, { user, userId: 'new-user' })), /微信|资料/);
    await assert.rejects(f.passport().register('another-user', { ...profile(), allowManualRegistration: true }), /微信|授权/);
    await assert.rejects(f.passport().editBase('new-user', profile()), /微信|授权/);
    await f.passport().wechatLogin('new-user', { code: 'now-authorized' });
    assert.equal((await mail._user('new-user')).USER_MOBILE_VERIFIED, true);
  });
});

for (const changed of [{ USER_STATUS: 9 }, { USER_MOBILE: '13987654321', USER_MOBILE_VERIFIED: true }]) {
  test('manual profile saves recheck concurrent account changes ' + JSON.stringify(changed), async () => {
    const f = await setup({ allowManualRegistration: true });
    await f.putUser({ ...readyUser(), USER_MOBILE_VERIFIED: false });
    const Config = f.service('operation_config_service'), getConfig = Config.prototype.getConfig;
    Config.prototype.getConfig = async function () {
      const result = await getConfig.call(this);
      await f.putUser({ ...readyUser(), USER_MOBILE_VERIFIED: false, ...changed });
      return result;
    };
    await assert.rejects(tenant.run(A, () => f.passport().editBase('new-user', profile())), /停用|手机号|授权/);
    for (const [field, value] of Object.entries(changed)) assert.equal(f.row()[field], value);
  });
}

test('identity login creates an account without calling phone services or granting business access', async () => {
  const f = await setup({ phoneLoginEnabled: false, allowManualRegistration: false });
  const result = await tenant.run(A, () => f.passport().wechatIdentityLogin('new-user', {
    userId: 'forged-user', mobile, USER_STATUS: 1, USER_MOBILE_VERIFIED: true
  }));
  assert.equal(result.token.id, 'new-user');
  assert.equal(result.token.phoneVerified, false);
  assert.equal(result.token.profileComplete, false);
  assert.equal(result.token.status, 0);
  assert.equal(result.token.allowManualRegistration, true);
  assert.equal(result.user.USER_MOBILE || '', '');
  assert.equal(f.row().USER_MINI_OPENID, 'new-user');
  assert.equal(f.row().USER_MOBILE_VERIFIED, false);
  assert.equal(f.phoneCalls.length, 0);
  await assert.rejects(tenant.run(A, () => new (f.service('mail_service'))()._user('new-user')));
  const completed = await tenant.run(A, () => f.passport().register('new-user', profile()));
  assert.equal(completed.token.status, 1);
  assert.equal(completed.token.profileComplete, true);
  assert.equal(completed.token.phoneVerified, false);
  assert.equal((await tenant.run(A, () => new (f.service('mail_service'))()._user('new-user'))).USER_MOBILE, mobile);
  assert.equal(f.phoneCalls.length, 0);
});

test('identity login remains idempotent across campuses and keeps schools isolated', async () => {
  const f = await setup({ phoneLoginEnabled: false });
  await Promise.all([A, B, A].map(scope => tenant.run(scope, () => f.passport().wechatIdentityLogin('new-user'))));
  assert.equal([...f.table('user').values()].filter(row => row.schoolId === A.schoolId && row.USER_MINI_OPENID === 'new-user').length, 1);
  await tenant.run(C, () => f.passport().wechatIdentityLogin('new-user'));
  assert.equal([...f.table('user').values()].filter(row => row.USER_MINI_OPENID === 'new-user').length, 2);
  assert.equal(f.phoneCalls.length, 0);
});

test('identity login preserves existing verified and manual profiles and never approves review states', async () => {
  const f = await setup({ phoneLoginEnabled: false });
  for (const verified of [true, false]) for (const status of [1, 0, 8]) {
    const original = { ...readyUser(), USER_MOBILE_VERIFIED: verified, USER_STATUS: status,
      USER_FORMS: [...profile().forms, { mark: 'contacts', val: [{ name: '原联系人', phone: mobile, isDefault: true }] }] };
    await f.putUser(original);
    const result = await tenant.run(A, () => f.passport().wechatIdentityLogin('new-user'));
    assert.equal(result.token.status, status);
    assert.equal(result.token.phoneVerified, verified);
    for (const field of ['USER_NAME', 'USER_MOBILE', 'USER_PIC', 'USER_FORMS', 'USER_STATUS']) {
      assert.deepEqual(JSON.parse(JSON.stringify(f.row()[field])), original[field]);
    }
  }
  await f.putUser({ ...readyUser(), USER_STATUS: 9 });
  await assert.rejects(tenant.run(A, () => f.passport().wechatIdentityLogin('new-user')), /停用|禁用/);
  assert.equal(f.row().USER_STATUS, 9);
  assert.equal(f.phoneCalls.length, 0);
});

test('silent login never creates accounts and explicit identity login requires a trusted identity', async () => {
  const f = await setup({ phoneLoginEnabled: false });
  assert.equal((await tenant.run(A, () => f.passport().login('new-user'))).token, null);
  assert.equal(f.row(), undefined);
  await assert.rejects(tenant.run(A, () => f.passport().wechatIdentityLogin('')), /登录/);
  assert.equal(f.row(), undefined);
});

test('real identity route uses trusted OPENID without phone or profile audit permission', async () => {
  const f = await setup({ phoneLoginEnabled: false, allowManualRegistration: false });
  Object.assign(f.load('config/config.js'), { CLIENT_CHECK_CONTENT: true });
  let audits = 0;
  f.cloud.openapi.security = { async msgSecCheck() { audits++; throw Error('No content audit permission'); } };
  // Requests and the production validator share a realm in a cloud invocation.
  f.load('framework/validate/data_check.js').check = require('../../cloudfunctions/mcloud/framework/validate/data_check.js').check;
  const app = f.load('framework/core/application.js');
  const params = { userId: 'forged-user', OPENID: 'forged-openid', mobile, status: 1, USER_MOBILE_VERIFIED: true };
  const result = await app.app({ route: 'passport/wechat_identity_login', PID: 'crun', scope: A, params }, {});
  assert.equal(result.code, 200, result.msg);
  assert.equal(result.data.token.id, 'crun^^^new-user');
  assert.equal(result.data.token.status, 0);
  assert.equal(result.data.token.phoneLoginEnabled, false);
  assert.equal(result.data.user.USER_MOBILE, '');
  assert.equal(f.row(A, 'crun^^^new-user').USER_MINI_OPENID, 'crun^^^new-user');
  assert.equal(f.row(A, 'forged-user'), undefined);
  assert.equal(f.phoneCalls.length, 0);
  assert.equal(audits, 0);
  const size = f.table('user').size;
  f.cloud.getWXContext = () => ({ APPID });
  const missingIdentity = await app.app({ route: 'passport/wechat_identity_login', PID: 'crun', scope: A, params }, {});
  assert.notEqual(missingIdentity.code, 200);
  assert.equal(f.table('user').size, size);
});

test('disabled phone endpoints make no provider request and public policy permits manual contact details', async () => {
  const f = await setup({ phoneLoginEnabled: false, allowManualRegistration: false });
  let legacyCalls = 0;
  f.cloud.getOpenData = async () => { legacyCalls++; return { list: [{ data: { phoneNumber: mobile } }] }; };
  await assert.rejects(tenant.run(A, () => f.passport().wechatLogin('new-user', { code: 'unused' })), /停用|关闭/);
  await assert.rejects(f.passport().getPhone('unused-cloud-id'), /停用|关闭/);
  assert.equal(f.phoneCalls.length, 0);
  assert.equal(legacyCalls, 0);
  assert.equal(f.row(), undefined);
  const config = await tenant.run(A, () => new (f.service('operations_service'))().config('new-user'));
  assert.equal(config.phoneLoginEnabled, false);
  assert.equal(config.allowManualRegistration, true);
});

test('basic mode can update a verified contact number without falsely preserving verification', async () => {
  const f = await setup({ phoneLoginEnabled: false, allowManualRegistration: false });
  await f.putUser();
  const unchanged = await tenant.run(A, () => f.passport().editBase('new-user', profile()));
  assert.equal(unchanged.token.phoneVerified, true);
  const changed = await tenant.run(A, () => f.passport().editBase('new-user', { ...profile(), mobile: '13987654321' }));
  assert.equal(changed.token.phoneVerified, false);
  assert.equal(changed.token.profileComplete, true);
  assert.equal(f.row().USER_MOBILE, '13987654321');
  assert.equal(f.row().USER_MOBILE_VERIFIED, false);
  assert.equal(tenant.run(A, () => f.table('identity_unique').has(f.store.schoolKey('crun', 'phone', mobile))), false);
  await assert.rejects(tenant.run(A, () => f.passport().editBase('new-user', { ...profile(), mobile: '13800000000' })), /登记/);
  assert.equal(f.phoneCalls.length, 0);
});
