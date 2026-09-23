'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { client, tick } = require('../test-support/reliability-client.cjs');

test('a private response from before logout cannot be delivered after session invalidation', async () => {
  const f = client();
  const pending = f.cloud.callCloudSumbit('passport/my_detail', {}, { hint: false });
  const rejected = assert.rejects(pending, error => error.staleSession === true);
  await tick();
  assert.equal(typeof f.cloud.invalidateSessionRequests, 'function');
  f.cloud.invalidateSessionRequests();
  f.respond(0, { USER_NAME: '旧昵称', USER_MOBILE: '13800000000' });
  await rejected;
});

test('expired credentials clear the local session instead of leaving cached access active', async () => {
  const f = client(), pending = f.cloud.callCloudSumbit('passport/my_detail', {}, { hint: false });
  const rejected = assert.rejects(pending, error => error.code === 2301);
  await tick(); f.respond(0, {}, 2301); await rejected;
  assert.equal(f.storage.get('CACHE_LOGGED_OUT'), true);
});

test('global logout retries do not depend on the previously selected campus', async () => {
  const f = client();
  const pending = f.cloud.callCloudSumbit('passport/logout', {}, { hint: false, authToken: 'c'.repeat(64), ignoreSessionChange: true, scope: { schoolId: 'old-school', campusId: 'old-campus' } });
  await tick(); assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].data.scope, undefined); assert.equal(f.calls[0].data.token, 'c'.repeat(64));
  f.respond(0, { ok: true }); await pending;
});

test('an automatic command retry cannot reuse a new login after logout during backoff', { timeout: 2000 }, async () => {
  const f = client(), ops = f.ops();
  const command = ops.command('mail/insert', { forms: [{ mark: 'tel', val: '13800000000' }] });
  const stopped = assert.rejects(command, /登录/); await tick();
  f.fail(0, { errMsg: 'network timeout', retryable: true }); await tick();
  f.cloud.invalidateSessionRequests(); f.cloud.invalidateSessionRequests();
  await f.advance(1000); await stopped;
  assert.equal(f.calls.length, 1);
  assert.equal(ops.pendingCommand('mail/insert').uncertain, true, 'only identifiers remain for explicit result recovery');
});

test('server session expiry clears private disk caches and resets the visible page stack', async () => {
  const f = client(); f.load('comm/biz/passport_biz.js');
  f.storage.set('crun-profile-user-v1:rider:campus', { mobile: '13800000000' });
  f.storage.set('crun-draft-order', { contact: '个人信息' });
  const request = assert.rejects(f.cloud.callCloudSumbit('passport/my_detail', {}, { hint: false }), error => error.code === 2301);
  await tick(); f.respond(0, {}, 2301); await request;
  assert.equal(f.storage.has('crun-profile-user-v1:rider:campus'), false);
  assert.equal(f.storage.has('crun-draft-order'), false);
  assert.ok(f.ui.some(item => item[0] === 'relaunch' && item[1].url.endsWith('/my/index/my_index')));
});
