'use strict';
// Exercise the installed SDK's real OpenAPI serializer and response conversion.
// Replace its transport before any API call; all values below are local fixtures.
const assert = require('node:assert/strict');
const cloud = require('../cloudfunctions/mcloud/node_modules/wx-server-sdk');
const version = require('../cloudfunctions/mcloud/node_modules/wx-server-sdk/package.json').version;
const permissions = require('../cloudfunctions/mcloud/config.json').permissions.openapi;
assert.ok(permissions.includes('phonenumber.getPhoneNumber'));
let transport;
cloud.registerService({ createService(instance) {
  transport = instance.provider.api;
  return { name: 'local-phone-transport-probe', getAPIs: () => ({}) };
} });
cloud.init({ env: 'wechat-login-local-only' });
const original = transport.callWXOpenAPI;
let requests = 0, fail = false;
transport.callWXOpenAPI = async ({ api, data }) => {
  requests++;
  assert.equal(api, 'phonenumber.getPhoneNumber');
  assert.ok(Buffer.isBuffer(data));
  assert.ok(data.includes(Buffer.from('code')));
  assert.ok(data.includes(Buffer.from(JSON.stringify('offline-phone-code'))));
  const response = fail ? { errcode: 40029, errmsg: 'invalid code' } : {
    errcode: 0, errmsg: 'ok', phone_info: { phoneNumber: '13912345678', purePhoneNumber: '13912345678',
      countryCode: '86', watermark: { timestamp: 1790000000, appid: 'wx3d8dc6fb0e764ec7' } }
  };
  return { contentType: 'application/json', respData: Buffer.from(JSON.stringify(response)) };
};
(async () => {
  try {
    const result = await cloud.openapi.phonenumber.getPhoneNumber({ code: 'offline-phone-code' });
    assert.equal(result.errCode, 0);
    assert.equal(result.phoneInfo.purePhoneNumber, '13912345678');
    assert.equal(result.phoneInfo.countryCode, '86');
    assert.equal(result.phoneInfo.watermark.appid, 'wx3d8dc6fb0e764ec7');
    fail = true;
    await assert.rejects(cloud.openapi.phonenumber.getPhoneNumber({ code: 'offline-phone-code' }), error => Number(error.errCode) === 40029);
    assert.equal(requests, 2, 'the SDK must not silently retry a one-time phone code');
    console.log('Installed wx-server-sdk ' + version + ': phonenumber.getPhoneNumber, code serialization, phoneInfo conversion and invalid-code rejection OK; 2 mocked requests, no network.');
  } finally { transport.callWXOpenAPI = original; }
})().catch(error => { console.error(error); process.exitCode = 1; });
