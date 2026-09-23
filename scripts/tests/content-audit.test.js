'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { runMiniProgram } = require('../test-support/miniprogram-module.cjs');
const { fixture, A, B, tenant } = require('../test-support/tenant-services.cjs');
const { harness } = require('../test-support/admin-console-harness.cjs');
const AppError = require('../../cloudfunctions/mcloud/framework/core/app_error.js');
const pass = () => ({ errCode: 0, result: { suggest: 'pass' } });
const copy = value => JSON.parse(JSON.stringify(value));

function auditFixture() {
  const state = { calls: [], logs: [], response: pass, openid: 'trusted-user' };
  const config = { CLIENT_CHECK_CONTENT: true, ADMIN_CHECK_CONTENT: true };
  const cloud = { getWXContext: () => ({ OPENID: state.openid }), openapi: { security: {
    async msgSecCheck(input) { state.calls.push(input); return state.response(input); }
  } } };
  const api = runMiniProgram(path.resolve(__dirname, '../../cloudfunctions/mcloud/framework/validate/content_check.js'), {
    Buffer, console: { warn: (...args) => state.logs.push(args) }, require(name) {
      if (name.endsWith('app_error.js')) return AppError;
      if (name.endsWith('cloud_base.js')) return { getCloud: () => cloud };
      if (name.endsWith('config.js')) return config;
      throw Error('Unexpected audit dependency: ' + name);
    }
  });
  return { api, state, config };
}

test('text audit preserves field boundaries, labels, trusted identity and the profile scene', async () => {
  const f = auditFixture();
  await f.api.checkTextMultiClient({ 昵称: '小同学', 学院: '计算机学院' }, { scene: 1, byField: true });
  assert.deepEqual(f.state.calls.map(item => item.content), ['小同学', '计算机学院']);
  assert.ok(f.state.calls.every(item => item.openid === 'trusted-user' && item.version === 2 && item.scene === 1));
  f.state.response = () => ({ errCode: 0, result: { suggest: 'risky' } });
  await assert.rejects(f.api.checkTextMultiClient({ 专业: '待修改内容' }), /专业.*未通过.*微信.*审核/);
});

for (const result of [pass(), { errcode: 0, result: { suggest: 'pass' } }, { errCode: '0', result: { suggest: 'pass' } }]) {
  test('text audit accepts a documented pass with error-code representation ' + JSON.stringify(result), async () => {
    const f = auditFixture(); f.state.response = () => result;
    await f.api.checkText('普通文字');
  });
}

for (const [code, expected] of [[48001, /权限|配置/], [40003, /身份/], [45009, /繁忙|频繁/]]) {
  for (const thrown of [true, false]) {
    test('provider failure ' + code + ' (' + (thrown ? 'exception' : 'response') + ') is not a content violation', async () => {
      const f = auditFixture();
      f.state.response = () => {
        const response = { errCode: code, errMsg: 'private submitted text 13912345678' };
        if (thrown) throw response;
        return response;
      };
      await assert.rejects(f.api.checkTextMultiAdmin({ 结算说明: '普通结算说明' }), error => {
        assert.match(error.message, expected);
        assert.doesNotMatch(error.message, /内容不合适|未通过|private|13912345678/);
        return true;
      });
      assert.equal(f.state.logs.length, 1);
      assert.equal(f.state.logs[0][1].errCode, code);
      assert.doesNotMatch(JSON.stringify(f.state.logs), /private|13912345678|普通结算说明/);
    });
  }
}

test('timeouts and missing identity have accurate errors and never report inappropriate text', async () => {
  const f = auditFixture();
  f.state.response = () => { throw Object.assign(Error('request timeout with private contents'), { code: 'ETIMEDOUT' }); };
  await assert.rejects(f.api.checkText('文字'), /超时/);
  f.state.openid = '';
  await assert.rejects(f.api.checkText('文字'), /身份|重新进入/);
  assert.equal(f.state.calls.length, 1, 'do not invoke v2 auditing without a trusted OPENID');
});

for (const result of [undefined, null, {}, { errCode: 0 }, { errCode: 0, result: { suggest: 'unknown' } }]) {
  test('malformed audit response is a service failure: ' + JSON.stringify(result), async () => {
    const f = auditFixture(); f.state.response = () => result;
    await assert.rejects(f.api.checkTextMultiClient({ 昵称: '小同学' }), /审核服务.*(?:异常|不可用)/);
  });
}

test('legacy rejection and review responses identify the field without inventing offending words', async () => {
  const f = auditFixture();
  f.state.response = () => { throw { errCode: 87014 }; };
  await assert.rejects(f.api.checkTextMultiAdmin({ 结算说明: '结算文字' }), /结算说明.*未通过/);
  f.state.response = () => ({ errCode: 0, result: { suggest: 'review' } });
  await assert.rejects(f.api.checkTextMultiClient({ 学院: '学院文字' }), /学院.*复核/);
});

test('empty and numeric inputs need no audit; all selected text is size checked before requesting', async () => {
  const f = auditFixture();
  await f.api.checkTextMulti({ enabled: false, amount: 2.5, ignored: null, empty: '  ' });
  assert.equal(f.state.calls.length, 0);
  await assert.rejects(f.api.checkTextMulti({ 甲: 'x'.repeat(12001), 乙: 'y'.repeat(12000) }), /过长/);
  assert.equal(f.state.calls.length, 0);
  f.state.response = input => ({ errCode: 0, result: { suggest: input.content === 'z' ? 'risky' : 'pass' } });
  await assert.rejects(f.api.checkTextMulti({ 结算说明: 'x'.repeat(3600) + 'z' }), /结算说明/);
  assert.deepEqual(f.state.calls.map(item => item.content.length), [1800, 1800, 1]);
});

test('the existing explicit development switch still controls text checks', async () => {
  const f = auditFixture(); f.config.CLIENT_CHECK_CONTENT = false; f.config.ADMIN_CHECK_CONTENT = false;
  f.state.response = () => { throw Error('must not call'); };
  await f.api.checkTextMultiClient({ 昵称: '文字' });
  await f.api.checkTextMultiAdmin({ 结算说明: '文字' });
  assert.equal(f.state.calls.length, 0);
});

test('existing unlabelled callers retain a single batched request for short multi-field input', async () => {
  const f = auditFixture();
  await f.api.checkTextMultiClient({ title: '标题', content: '正文', requestId: 'request-identifier' });
  assert.equal(f.state.calls.length, 1);
  for (const text of ['标题', '正文', 'request-identifier']) assert.ok(f.state.calls[0].content.includes(text));
});

test('long Unicode fields remain valid text when split for auditing', async () => {
  const f = auditFixture(), text = '字'.repeat(1799) + '😀后续';
  await f.api.checkTextMulti({ 说明: text });
  assert.equal(f.state.calls.map(item => item.content).join(''), text);
  assert.ok(f.state.calls.every(item => item.content.length <= 1800 && Buffer.from(item.content).toString() === item.content));
});

function profile(f) {
  return { name: '新同学', mobile: '13912345678', pic: f && f.avatar ? f.avatar('avatar.png') : 'cloud://test/avatar.png', forms: [
    { mark: 'sex', title: '性别', type: 'select', val: '女' },
    { mark: 'college', title: '学院', type: 'text', val: '计算机学院' },
    { mark: 'sub', title: '专业', type: 'text', val: '软件工程' },
    { mark: 'campus', title: '所在校区', type: 'select', val: A.campusName },
    { mark: 'payPic', title: '支付凭证', type: 'image', val: ['cloud://test/payment.png'] }
  ] };
}

async function routeFixture() {
  const f = fixture({ allowManualRegistration: true, credentialsOnly: true }); await f.setup();
  Object.assign(f.load('config/config.js'), { CLIENT_CHECK_CONTENT: true, ADMIN_CHECK_CONTENT: true });
  f.cloud.getWXContext = () => ({ OPENID: 'audit-user', APPID: 'wx3d8dc6fb0e764ec7' });
  f.auditCalls = []; f.auditResponse = pass;
  f.cloud.openapi.security = { async msgSecCheck(input) { f.auditCalls.push(input); return f.auditResponse(input); } };
  f.table('admin').set('legacy-admin', { _id: 'legacy-admin', _pid: 'crun', ADMIN_TYPE: 1, ADMIN_STATUS: 1,
    ADMIN_TOKEN: 'audit-admin-token', ADMIN_TOKEN_USER: 'crun^^^audit-user', ADMIN_TOKEN_TIME: Date.now() });
  // The legacy object validator compares constructors. Use its unchanged source
  // in the same realm as the JSON request, as a real cloud invocation does.
  f.load('framework/validate/data_check.js').check = require('../../cloudfunctions/mcloud/framework/validate/data_check.js').check;
  const app = f.load('framework/core/application.js');
  f.call = (route, params, token = route.startsWith('admin/') ? 'audit-admin-token' : f.userToken || '') => app.app({ route, PID: 'crun', scope: A, params: copy(params), token }, {});
  f.configRow = () => f.table('operation_config').get(tenant.run(A, () => f.store.scopeKey('crun', 'config')));
  f.userRow = () => f.table('user').get(tenant.run(A, () => f.store.schoolKey('crun', 'user', 'crun^^^audit-user')));
  return f;
}

async function profileFixture() {
  const f = await routeFixture();
  const login = await f.call('passport/wechat_identity_login', {});
  assert.equal(login.code, 200, login.msg);
  f.userToken = login.data.token.sessionToken;
  f.avatar = name => 'cloud://test/private/audit-user/' + login.data.token.mediaGeneration + '/' + name;
  f.userBefore = copy(f.userRow());
  return f;
}

test('the WeChat details route audits the nickname and updates only the trusted account', async () => {
  const f = await profileFixture();
  const result = await f.call('passport/wechat_profile', { name: '微信昵称', pic: f.avatar('wechat.jpg'),
    userId: 'poster', USER_STATUS: 1, mobile: '13912345678', forms: profile(f).forms });
  assert.equal(result.code, 200, result.msg);
  assert.deepEqual(f.auditCalls.map(item => item.content), ['微信昵称']);
  assert.equal(f.auditCalls[0].scene, 1); assert.equal(f.auditCalls[0].openid, 'audit-user');
  assert.equal(result.data.token.id, 'crun^^^audit-user'); assert.equal(result.data.token.profileComplete, false);
  assert.equal(f.userRow().USER_NAME, '微信昵称'); assert.equal(f.userRow().USER_MOBILE, '');
  assert.equal(f.userRow().USER_STATUS, 0);
  const other = f.table('user').get(tenant.run(A, () => f.store.schoolKey('crun', 'user', 'poster')));
  assert.equal(other.USER_NAME, 'poster');
});

test('rejected nickname content leaves the stored WeChat details unchanged', async () => {
  const f = await profileFixture(); f.auditResponse = () => ({ errCode: 0, result: { suggest: 'risky' } });
  const result = await f.call('passport/wechat_profile', { name: '待修改昵称', pic: f.avatar('wechat.jpg') });
  assert.notEqual(result.code, 200);
  assert.deepEqual(copy(f.userRow()), f.userBefore); assert.equal(f.auditCalls.length, 1);
});

test('real WeChat profile completion audits only human text and stores an unverified contact number', async () => {
  const f = await profileFixture(), result = await f.call('passport/register', profile(f));
  assert.equal(result.code, 200, result.msg);
  assert.deepEqual(f.auditCalls.map(item => item.content), ['新同学', '计算机学院', '软件工程']);
  assert.ok(f.auditCalls.every(item => item.scene === 1 && item.openid === 'audit-user'));
  assert.equal(result.data.token.profileComplete, true); assert.equal(result.data.token.phoneVerified, false);
  assert.equal(f.userRow().USER_MOBILE, '13912345678');
});

test('profile audit selects contact names and address text without their phones or form metadata', async () => {
  const f = await profileFixture(), input = profile(f);
  input.forms.push({ mark: 'contacts', title: '常用联系人', type: 'json', val: [{ name: '张同学', phone: '13987654321', isDefault: true }] },
    { mark: 'addresses', title: '常用地址', type: 'json', val: JSON.stringify([{ label: '宿舍', detail: '一期1栋101', isDefault: true }]) });
  const result = await f.call('passport/register', input);
  assert.equal(result.code, 200, result.msg);
  const text = f.auditCalls.map(item => item.content).join('\n');
  for (const value of ['张同学', '宿舍', '一期1栋101']) assert.ok(text.includes(value));
  assert.doesNotMatch(text, /13987654321|13912345678|cloud:\/\/|isDefault|"mark"|"title"|"type"/);
});

test('additional legacy contact text cannot disappear behind a boolean or another field', async () => {
  const f = await profileFixture(), input = profile(f);
  input.forms.push({ mark: 'contacts', type: 'json', val: [{ name: '张同学', note: '需要检查的附加说明', isDefault: true }] });
  f.auditResponse = item => ({ errCode: 0, result: { suggest: item.content.includes('需要检查的附加说明') ? 'risky' : 'pass' } });
  const result = await f.call('passport/register', input);
  assert.equal(result.code, 1600); assert.match(result.msg, /常用联系人.*未通过/); assert.deepEqual(copy(f.userRow()), f.userBefore);
});

test('unknown legacy form marks get safe field labels and still audit their actual values', async () => {
  const f = await profileFixture(), input = profile(f);
  input.forms.push({ mark: 'constructor', title: '旧版补充资料', val: '需要检查的附加说明' });
  f.auditResponse = item => ({ errCode: 0, result: { suggest: item.content.includes('需要检查的附加说明') ? 'risky' : 'pass' } });
  const result = await f.call('passport/register', input);
  assert.equal(result.code, 1600); assert.match(result.msg, /补充资料.*未通过/); assert.deepEqual(copy(f.userRow()), f.userBefore);
});

test('legacy fields sharing a display label cannot overwrite each other during text selection', async () => {
  const f = await profileFixture(), input = profile(f);
  input.forms.push({ mark: 'contacts', val: '需要检查的旧联系人' }, { mark: 'commonContact', val: '新的联系人' });
  f.auditResponse = item => ({ errCode: 0, result: { suggest: item.content.includes('需要检查的旧联系人') ? 'risky' : 'pass' } });
  const result = await f.call('passport/register', input);
  assert.equal(result.code, 1600); assert.match(result.msg, /常用联系人.*未通过/); assert.deepEqual(copy(f.userRow()), f.userBefore);
});

test('a nickname rejection leaves the WeChat account incomplete and does not bind its contact number', async () => {
  const f = await profileFixture(); f.auditResponse = () => ({ errCode: 0, result: { suggest: 'risky' } });
  const result = await f.call('passport/register', profile(f));
  assert.equal(result.code, 1600); assert.match(result.msg, /昵称.*未通过/);
  assert.deepEqual(copy(f.userRow()), f.userBefore); assert.equal(f.table('identity_unique').size, 0);
});

test('editing a profile identifies the rejected field and preserves the prior profile', async () => {
  const f = await profileFixture(); assert.equal((await f.call('passport/register', profile(f))).code, 200);
  const previous = copy(f.userRow()), input = profile(f); input.forms[2].val = '待修改专业';
  input.forms[2].type = 'image'; // client-provided type must not suppress this known text field.
  f.auditResponse = item => ({ errCode: 0, result: { suggest: item.content.includes('待修改专业') ? 'risky' : 'pass' } });
  const result = await f.call('passport/edit_base', input);
  assert.equal(result.code, 1600); assert.match(result.msg, /专业.*未通过/);
  assert.deepEqual(copy(f.userRow()), previous);
});

test('profile format errors are shown before calling an unavailable audit service', async () => {
  const f = await profileFixture(), input = profile(f); input.forms[1].val = '';
  f.auditResponse = () => { throw { errCode: 48001 }; };
  const result = await f.call('passport/register', input);
  assert.match(result.msg, /填写所在学院/); assert.equal(f.auditCalls.length, 0); assert.deepEqual(copy(f.userRow()), f.userBefore);
});

test('a profile audit outage preserves the incomplete WeChat account and reports the service problem', async () => {
  const f = await profileFixture(); f.auditResponse = () => { throw { errCode: 48001 }; };
  const result = await f.call('passport/register', profile(f));
  assert.equal(result.code, 1600); assert.match(result.msg, /审核服务.*(?:权限|配置)/);
  assert.doesNotMatch(result.msg, /内容不合适/); assert.deepEqual(copy(f.userRow()), f.userBefore);
});

for (const [section, value] of [['service', { enabled: true, openHour: 9, closeHour: 20 }],
  ['rules', { maxActiveOrders: 4, registrationReview: true }], ['pricing', { smallPrice: 2.35 }]]) {
  test('real ' + section + ' settings save without depending on a text service for numbers and switches', async () => {
    const f = await routeFixture(); f.auditResponse = () => { throw { errCode: 48001 }; };
    const result = await f.call('admin/operations_config_save', { section, value });
    assert.equal(result.code, 200, result.msg); assert.equal(f.auditCalls.length, 0);
    for (const [key, expected] of Object.entries(value)) assert.equal(f.configRow().value[key], expected);
    assert.equal(f.table('operation_audit').size, 1);
    const other = await tenant.run(B, () => new (f.service('operation_config_service'))().getConfig());
    assert.equal(other.smallPrice, 1.5);
  });
}

test('the real pricing page can change a number while submitting its unchanged settlement notice', async () => {
  const f = await routeFixture(); f.auditResponse = () => { throw { errCode: 48001 }; };
  const h = harness('settings/pricing/admin_pricing_settings.js', async (route, params = {}) => {
    const response = await f.call(route, params); if (response.code !== 200) throw response; return response.data;
  });
  await h.page.onLoad();
  h.page.bindEdit({ currentTarget: { dataset: { key: 'smallPrice' } }, detail: { value: '2.35' } });
  await h.page.bindSave();
  assert.deepEqual(h.errors, []); assert.equal(f.auditCalls.length, 0);
  assert.equal(h.page.data.dirty, false); assert.equal(f.configRow().value.smallPrice, 2.35);
});

test('a changed settlement notice is audited alone; failed saves retain the page draft and database', async () => {
  const f = await routeFixture(), old = copy(f.configRow());
  const h = harness('settings/pricing/admin_pricing_settings.js', async (route, params = {}) => {
    const response = await f.call(route, params); if (response.code !== 200) throw response; return response.data;
  });
  await h.page.onLoad();
  h.page.bindEdit({ currentTarget: { dataset: { key: 'offlineNotice' } }, detail: { value: '新的结算说明' } });
  f.auditResponse = () => ({ errCode: 0, result: { suggest: 'risky' } });
  await h.page.bindSave();
  assert.match(h.errors[0], /结算说明.*未通过/); assert.deepEqual(copy(f.configRow()), old);
  assert.equal(h.page.data.config.offlineNotice, '新的结算说明'); assert.equal(h.page.data.dirty, true); assert.equal(h.page.data.busy, false);
  assert.equal(f.table('operation_audit').size, 0);
  assert.deepEqual(f.auditCalls.map(item => item.content), ['新的结算说明']);
  f.auditResponse = pass; await h.page.bindSave();
  assert.equal(f.configRow().value.offlineNotice, '新的结算说明'); assert.equal(h.page.data.dirty, false);
});

test('configuration format and authorization checks still precede external auditing and prevent writes', async () => {
  const f = await routeFixture(), before = copy(f.configRow());
  f.auditResponse = () => { throw { errCode: 48001 }; };
  for (const value of [{ smallPrice: -1, offlineNotice: '新说明' }, { offlineNotice: { text: '新说明' } }]) {
    const result = await f.call('admin/operations_config_save', { section: 'pricing', value });
    assert.equal(result.code, 1600); assert.match(result.msg, /配置数值|结算说明/);
  }
  const denied = await f.call('admin/operations_config_save', { section: 'pricing', value: { offlineNotice: '新说明' } }, 'wrong-token');
  assert.notEqual(denied.code, 200);
  assert.equal(f.auditCalls.length, 0); assert.deepEqual(copy(f.configRow()), before);
});
