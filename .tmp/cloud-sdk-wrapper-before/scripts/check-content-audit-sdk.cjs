'use strict';
// Validate the installed SDK's serializer and error conversion without network.
const assert = require('node:assert/strict');
const path = require('node:path');
const { runMiniProgram } = require('./test-support/miniprogram-module.cjs');
const cloud = require('../cloudfunctions/mcloud/node_modules/wx-server-sdk');
const version = require('../cloudfunctions/mcloud/node_modules/wx-server-sdk/package.json').version;
assert.ok(require('../cloudfunctions/mcloud/config.json').permissions.openapi.includes('security.msgSecCheck'));
let transport;
cloud.registerService({ createService(instance) {
  transport = instance.provider.api;
  return { name: 'local-text-audit-probe', getAPIs: () => ({}) };
} });
cloud.init({ env: 'content-audit-local-only' });
const original = transport.callWXOpenAPI, requests = [], diagnostics = [];
let response = { errcode: 0, errmsg: 'ok', result: { suggest: 'pass', label: 100 }, trace_id: 'offline-trace' };
transport.callWXOpenAPI = async ({ api, data }) => {
  requests.push(api);
  assert.equal(api, 'security.msgSecCheck'); assert.ok(Buffer.isBuffer(data));
  for (const field of ['content', 'version', 'scene', 'openid']) assert.ok(data.includes(Buffer.from(field)), field);
  assert.ok(data.includes(Buffer.from(JSON.stringify('trusted-sdk-openid'))));
  assert.ok(data.includes(Buffer.from(JSON.stringify('离线审核样例'))));
  return { contentType: 'application/json', respData: Buffer.from(JSON.stringify(response)) };
};
const check = runMiniProgram(path.resolve(__dirname, '../cloudfunctions/mcloud/framework/validate/content_check.js'), {
  Buffer, console: { warn: (...args) => diagnostics.push(args) }, require(name) {
    if (name.endsWith('/app_error.js')) return require('../cloudfunctions/mcloud/framework/core/app_error.js');
    if (name.endsWith('/cloud_base.js')) return { getCloud: () => ({ openapi: cloud.openapi, getWXContext: () => ({ OPENID: 'trusted-sdk-openid' }) }) };
    if (name.endsWith('/config.js')) return { CLIENT_CHECK_CONTENT: true };
    throw Error('Unexpected content audit dependency: ' + name);
  }
});
async function main() {
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
    console.log('Installed wx-server-sdk ' + version + ': text-audit serialization, v2 pass/review/risky and provider error classification OK; 6 mocked requests, no network.');
  } finally { transport.callWXOpenAPI = original; }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
