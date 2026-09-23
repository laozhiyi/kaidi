'use strict';
// Exercise the production cloud wrapper and installed SDK without network.
const assert = require('node:assert/strict');
const sdk = require('../cloudfunctions/mcloud/node_modules/wx-server-sdk');
const { fixture, A, tenant } = require('./test-support/tenant-services.cjs');
const version = require('../cloudfunctions/mcloud/node_modules/wx-server-sdk/package.json').version;
assert.ok(require('../cloudfunctions/mcloud/config.json').permissions.openapi.includes('security.msgSecCheck'));
// Synthetic context is confined to this standalone offline process.
process.env.CLOUD_ENV_ID = 'content-audit-local-only';
process.env.WX_CONTEXT_KEYS = 'WX_OPENID,WX_APPID';
process.env.WX_OPENID = 'trusted-sdk-openid';
process.env.WX_APPID = 'wx3d8dc6fb0e764ec7';
let transport;
sdk.registerService({ createService(instance) {
  transport = instance.provider.api;
  return { name: 'local-text-audit-probe', getAPIs: () => ({}) };
} });
const cloud = require('../cloudfunctions/mcloud/framework/cloud/cloud_base.js').getCloud();
const check = require('../cloudfunctions/mcloud/framework/validate/content_check.js');
const original = transport.callWXOpenAPI, requests = [], diagnostics = [];
let response = { errcode: 0, errmsg: 'ok', result: { suggest: 'pass', label: 100 }, trace_id: 'offline-trace' };
let expectedTexts = ['离线审核样例'];
transport.callWXOpenAPI = async ({ api, data }) => {
  requests.push(api);
  assert.equal(api, 'security.msgSecCheck'); assert.ok(Buffer.isBuffer(data));
  for (const field of ['content', 'version', 'scene', 'openid']) assert.ok(data.includes(Buffer.from(field)), field);
  assert.ok(data.includes(Buffer.from(JSON.stringify('trusted-sdk-openid'))));
  assert.ok(expectedTexts.some(text => data.includes(Buffer.from(JSON.stringify(text)))));
  return { contentType: 'application/json', respData: Buffer.from(JSON.stringify(response)) };
};

async function registerThroughSDK() {
  const f = fixture({ allowManualRegistration: true, credentialsOnly: true });
  await f.setup();
  Object.assign(f.load('config/config.js'), { CLIENT_CHECK_CONTENT: true, ADMIN_CHECK_CONTENT: true });
  f.cloud.getWXContext = () => cloud.getWXContext();
  // Keep the route's in-memory database while using the actual cloud wrapper's
  // OpenAPI getter, rather than replacing it with a plain-object SDK double.
  Object.defineProperty(f.cloud, 'openapi', { get: () => cloud.openapi });
  f.load('framework/validate/data_check.js').check = require('../cloudfunctions/mcloud/framework/validate/data_check.js').check;
  const params = { name: '新同学', mobile: '13912345678', pic: 'cloud://test/avatar.png', forms: [
    { mark: 'sex', val: '女' }, { mark: 'college', val: '计算机学院' },
    { mark: 'sub', val: '软件工程' }, { mark: 'campus', val: A.campusName }
  ] };
  const app = f.load('framework/core/application.js');
  const login = await app.app({ route: 'passport/wechat_identity_login', PID: 'crun', scope: A, params: {} }, {});
  assert.equal(login.code, 200, login.msg);
  params.pic = 'cloud://test/private/trusted-sdk-openid/' + login.data.token.mediaGeneration + '/avatar.png';
  const userId = tenant.run(A, () => f.store.schoolKey('crun', 'user', 'crun^^^trusted-sdk-openid'));
  const userBefore = JSON.stringify(f.table('user').get(userId));
  const result = await app.app({ route: 'passport/register', PID: 'crun', scope: A, token: login.data.token.sessionToken, params }, {});
  return { result, user: f.table('user').get(userId), userBefore };
}

async function main() {
  const originalWarn = console.warn;
  console.warn = (...args) => diagnostics.push(args);
  try {
    const run = () => check.checkTextMultiClient({ 昵称: '离线审核样例' }, { scene: 1, byField: true });
    await run();
    for (const suggest of ['risky', 'review']) {
      response = { errcode: 0, errmsg: 'ok', result: { suggest } };
      await assert.rejects(run(), suggest === 'review' ? /昵称.*复核/ : /昵称.*未通过/);
    }
    for (const [errcode, message] of [[87014, /昵称.*未通过/], [48001, /审核服务.*权限/], [40003, /身份/]]) {
      response = { errcode, errmsg: 'private provider message' };
      await assert.rejects(run(), message);
    }
    assert.equal(requests.length, 6);
    assert.deepEqual(diagnostics.map(item => item[1].errCode), [48001, 40003]);
    assert.ok(!JSON.stringify(diagnostics).includes('private provider message'));
    response = { errcode: 0, errmsg: 'ok', result: { suggest: 'pass', label: 100 } };
    const configured = await cloud.openapi({ convertCase: false }).security.msgSecCheck({
      content: '离线审核样例', version: 2, scene: 1, openid: 'trusted-sdk-openid'
    });
    assert.equal(configured.result.suggest, 'pass', 'the callable namespace must retain its options API');
    expectedTexts = ['新同学', '计算机学院', '软件工程'];
    const accepted = await registerThroughSDK();
    assert.equal(accepted.result.code, 200, accepted.result.msg);
    assert.equal(accepted.result.data.token.profileComplete, true);
    assert.equal(accepted.result.data.token.phoneVerified, false);
    assert.equal(accepted.user.USER_MOBILE, '13912345678');
    response = { errcode: 0, errmsg: 'ok', result: { suggest: 'risky', label: 20001 } };
    const rejected = await registerThroughSDK();
    assert.equal(rejected.result.code, 1600);
    assert.match(rejected.result.msg, /昵称.*未通过/);
    assert.equal(JSON.stringify(rejected.user), rejected.userBefore);
    response = { errcode: 48001, errmsg: 'private provider message' };
    const unavailable = await registerThroughSDK();
    assert.equal(unavailable.result.code, 1600);
    assert.match(unavailable.result.msg, /权限.*48001/);
    assert.equal(JSON.stringify(unavailable.user), unavailable.userBefore);
    assert.equal(requests.length, 12);
    assert.ok(requests.every(api => api === 'security.msgSecCheck'));
    console.log('Production cloud wrapper + installed wx-server-sdk ' + version + ': text audit, callable options and WeChat profile completion pass/rejection/outage OK; 12 mocked requests, no network.');
  } finally { transport.callWXOpenAPI = original; console.warn = originalWarn; }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
