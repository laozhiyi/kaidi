'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, A, B, C, tenant } = require('../test-support/tenant-services.cjs');
const { concurrentTransactions } = require('../test-support/concurrent-transactions.cjs');

async function setup() {
  const f = fixture(); await f.setup();
  f.passport = () => new (f.service('passport_service'))();
  f.account = () => new (f.service('account_service'))();
  f.login = (id = 'poster', scope = A) => tenant.run(scope, () => f.passport().wechatIdentityLogin(id));
  return f;
}

test('explicit WeChat login issues an unpredictable session bound to its trusted identity', async () => {
  const f = await setup(), login = await f.login();
  assert.match(login.token.sessionToken || '', /^[a-f0-9]{64}$/);
  const session = await f.account().authenticate('poster', login.token.sessionToken);
  assert.ok(session);
  assert.equal(await f.account().authenticate('rider', login.token.sessionToken), null);
  assert.equal(await f.account().authenticate('poster', 'poster'), null);
  assert.equal(await f.account().authenticate('poster', ''), null);
  const stored = JSON.stringify([...f.table('account_session').values()]);
  assert.ok(!stored.includes(login.token.sessionToken), 'database stores only a digest');
});

test('media directories survive logout and cancellation recovery, but change after completed deletion', async () => {
  const f = await setup(), first = await f.login();
  assert.match(first.token.mediaGeneration || '', /^[a-f0-9]{32}$/);
  await f.account().logout('poster', first.token.sessionToken);
  const next = await f.login();
  assert.equal(next.token.mediaGeneration, first.token.mediaGeneration);
  await f.account().requestCancellation('poster', next.token.sessionToken);
  const recovered = await f.login();
  assert.equal(recovered.token.mediaGeneration, first.token.mediaGeneration);
  await f.account().requestCancellation('poster', recovered.token.sessionToken);
  [...f.table('account_session').values()].find(row => row.userId === 'poster').cancelAt = Date.now() - 1;
  const fresh = await f.login();
  assert.notEqual(fresh.token.mediaGeneration, first.token.mediaGeneration);
});

test('private file cleanup is durable across storage failures and never deletes unowned references', async () => {
  const f = await setup(), login = await f.login(), env = f.load('config/config.js').CLOUD_ID;
  const own = `cloud://${env}.bucket/private/poster/${login.token.mediaGeneration}/avatar.png`;
  const evidence = `cloud://${env}.bucket/private-evidence/poster/legacy.png`;
  const other = `cloud://${env}.bucket/private/rider/other.png`;
  const legacy = `cloud://${env}.bucket/crun/user/old.png`;
  const foreignEnv = 'cloud://other-env.bucket/private/poster/other.png';
  for (const row of f.table('user').values()) if (row.USER_MINI_OPENID === 'poster') row.USER_PIC = own;
  await f.put(A, 'feedback', 'files', { FB_USER_ID: 'poster', FB_IMG: [evidence, other, legacy, foreignEnv] });
  let failing = true; const removed = [];
  f.cloud.deleteFile = async ({ fileList }) => {
    if (failing) throw new Error('storage unavailable');
    removed.push(...fileList); return { fileList: fileList.map(fileID => ({ fileID, status: 0 })) };
  };
  await f.account().requestCancellation('poster', login.token.sessionToken);
  [...f.table('account_session').values()].find(row => row.userId === 'poster').cancelAt = Date.now() - 1;
  await assert.rejects(f.account().finalize('poster'), /storage unavailable/);
  assert.equal([...f.table('account_session').values()].find(row => row.userId === 'poster').status, 'deleting');
  assert.deepEqual([...new Set([...f.table('account_cleanup_file').values()].flatMap(row => row.files))].sort(), [own, evidence].sort(), 'file references survive database scrubbing');
  failing = false;
  assert.equal((await f.account().finalize('poster')).complete, true);
  assert.deepEqual([...new Set(removed)].sort(), [own, evidence].sort());
  assert.equal(f.table('account_cleanup_file').size, 0);
});

test('new sessions archive media in the current account directory and reject a deleted generation', async () => {
  const f = await setup(), login = await f.login(), Account = f.service('account_service');
  const fileRoot = 'cloud://' + f.load('config/config.js').CLOUD_ID + '.bucket/';
  f.load('config/config.js').CLIENT_CHECK_CONTENT = false;
  f.load('config/config.js').ADMIN_CHECK_CONTENT = false;
  f.cloud.downloadFile = async () => ({ fileContent: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]) });
  f.cloud.uploadFile = async ({ cloudPath }) => ({ fileID: fileRoot + cloudPath });
  const checks = f.load('framework/validate/content_check.js');
  await tenant.run(A, () => Account.runRequest('mail/insert', 'poster', login.token.sessionToken, async () => {
    const generation = login.token.mediaGeneration;
    const original = `${fileRoot}private/poster/${generation}/original.png`;
    const file = await checks.checkCloudImage(original);
    assert.ok(file.startsWith(`${fileRoot}private-evidence/poster/${generation}/`));
    assert.deepEqual([...f.table('account_media').values()].map(row => row.fileID).sort(), [original, file].sort(), 'original and archive both remain discoverable for cancellation');
    await assert.rejects(checks.checkCloudImage('cloud://bucket/private/poster/old-generation/original.png'), /图片|上传/);
    await assert.rejects(f.passport().saveWechatProfile('poster', { name: '新昵称', pic: 'cloud://bucket/private/poster/old-generation/avatar.png' }), /头像|图片|上传/);
  }));
});

test('partial storage deletion retries failures and acknowledges files already removed', async () => {
  const f = await setup(), login = await f.login(), env = f.load('config/config.js').CLOUD_ID;
  const first = `cloud://${env}.bucket/private/poster/one.png`, second = `cloud://${env}.bucket/private/poster/two.png`;
  await f.put(A, 'feedback', 'images', { FB_USER_ID: 'poster', FB_IMG: [first, second] });
  const calls = [];
  f.cloud.deleteFile = async ({ fileList }) => {
    calls.push([...fileList]);
    return { fileList: fileList.map(fileID => ({ fileID, status: calls.length === 1 ? fileID === first ? 0 : -503001 : -503003 })) };
  };
  await f.account().requestCancellation('poster', login.token.sessionToken);
  [...f.table('account_session').values()].find(row => row.userId === 'poster').cancelAt = Date.now() - 1;
  assert.equal((await f.account().finalize('poster')).complete, false);
  assert.equal((await f.account().finalize('poster')).complete, true);
  assert.deepEqual(calls, [[first, second], [second]]);
  assert.equal(f.table('account_cleanup_file').size, 0);
});

test('a delayed cleanup response cannot alter a new account or its media directory', async () => {
  const f = await setup(), login = await f.login(), env = f.load('config/config.js').CLOUD_ID;
  const oldFile = `cloud://${env}.bucket/private/poster/${login.token.mediaGeneration}/old.png`;
  for (const row of f.table('user').values()) if (row.USER_MINI_OPENID === 'poster') row.USER_PIC = oldFile;
  let release, entered, calls = 0;
  const gate = new Promise(resolve => { release = resolve; }), reached = new Promise(resolve => { entered = resolve; });
  f.cloud.deleteFile = async ({ fileList }) => {
    if (++calls === 1) { entered(); await gate; }
    return { fileList: fileList.map(fileID => ({ fileID, status: 0 })) };
  };
  await f.account().requestCancellation('poster', login.token.sessionToken);
  [...f.table('account_session').values()].find(row => row.userId === 'poster').cancelAt = Date.now() - 1;
  const delayed = f.account().finalize('poster'); await reached;
  await f.account().finalize('poster'); const fresh = await f.login();
  const newFile = `cloud://${env}.bucket/private/poster/${fresh.token.mediaGeneration}/new.png`;
  const newUser = [...f.table('user').values()].find(row => row.USER_MINI_OPENID === 'poster'); newUser.USER_PIC = newFile;
  release(); await delayed;
  assert.notEqual(fresh.token.mediaGeneration, login.token.mediaGeneration);
  assert.ok(await f.account().authenticate('poster', fresh.token.sessionToken));
  assert.equal([...f.table('user').values()].find(row => row.USER_MINI_OPENID === 'poster').USER_PIC, newFile);
  assert.equal(f.table('account_cleanup_file').size, 0);
});

for (const kind of ['image', 'nickname']) test('a submitted ' + kind + ' rejected by moderation still has its original file erased on cancellation', async () => {
  const f = await setup(), userId = kind === 'nickname' ? 'crun^^^poster' : 'poster', login = await f.login(userId);
  const config = f.load('config/config.js'), before = config.CLIENT_CHECK_CONTENT;
  const fileID = `cloud://${config.CLOUD_ID}.bucket/private/poster/${login.token.mediaGeneration}/rejected.png`;
  config.CLIENT_CHECK_CONTENT = true;
  f.cloud.openapi.security = { imgSecCheck: async () => ({ errCode: 87014 }), msgSecCheck: async () => ({ errCode: 87014 }) };
  f.cloud.downloadFile = async () => ({ fileContent: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]) });
  const deleted = [];
  f.cloud.deleteFile = async ({ fileList }) => { deleted.push(...fileList); return { fileList: fileList.map(fileID => ({ fileID, status: 0 })) }; };
  try {
    if (kind === 'image') {
      const Account = f.service('account_service'), check = f.load('framework/validate/content_check.js');
      await assert.rejects(tenant.run(A, () => Account.runRequest('feedback/insert', userId, login.token.sessionToken, () => check.checkCloudImage(fileID))));
    } else {
      const app = f.load('framework/core/application.js');
      f.load('framework/validate/data_check.js').check = require('../../cloudfunctions/mcloud/framework/validate/data_check.js').check;
      const result = await app.app({ route: 'passport/wechat_profile', PID: 'crun', scope: A, token: login.token.sessionToken,
        params: { name: '待审核昵称', pic: fileID } }, {});
      assert.notEqual(result.code, 200);
    }
    assert.ok([...f.table('account_media').values()].some(row => row.fileID === fileID));
    await f.account().requestCancellation(userId, login.token.sessionToken);
    [...f.table('account_session').values()].find(row => row.userId === userId).cancelAt = Date.now() - 1;
    assert.equal((await f.account().finalize(userId)).complete, true);
    assert.ok(deleted.includes(fileID));
  } finally { config.CLIENT_CHECK_CONTENT = before; }
});

test('logout revokes server access and a delayed old logout cannot revoke a newer login', async () => {
  const f = await setup(), first = await f.login();
  await f.account().logout('poster', first.token.sessionToken);
  assert.equal(await f.account().authenticate('poster', first.token.sessionToken), null);
  const second = await f.login();
  assert.notEqual(second.token.sessionToken, first.token.sessionToken);
  await f.account().logout('poster', first.token.sessionToken);
  assert.ok(await f.account().authenticate('poster', second.token.sessionToken));
});

for (const role of ['MAIL_USER_ID', 'MAIL_ACCEPT_USER_ID']) for (const status of [0, 1, 2, 3, 4]) {
  test(`cancellation refuses unfinished ${role} status ${status}, including another school`, async () => {
    const f = await setup(), login = await f.login();
    await f.put(C, 'mail', 'unfinished', { MAIL_USER_ID: 'other', MAIL_ACCEPT_USER_ID: '', [role]: 'poster', MAIL_STATUS: status });
    await assert.rejects(f.account().requestCancellation('poster', login.token.sessionToken), /未完成|订单/);
    assert.ok(await f.account().authenticate('poster', login.token.sessionToken));
  });
}

test('completed and cancelled orders allow cancellation; retries preserve the original two-hour deadline', async () => {
  const f = await setup(), login = await f.login();
  await f.put(B, 'mail', 'done', { MAIL_USER_ID: 'poster', MAIL_STATUS: 9 });
  await f.put(C, 'mail', 'cancelled', { MAIL_ACCEPT_USER_ID: 'poster', MAIL_STATUS: 99 });
  const before = Date.now(), result = await f.account().requestCancellation('poster', login.token.sessionToken);
  assert.equal(result.cancelAt - result.requestedAt, 7200000);
  assert.ok(result.requestedAt >= before);
  assert.equal(await f.account().authenticate('poster', login.token.sessionToken), null);
  const retry = await f.account().requestCancellation('poster', login.token.sessionToken);
  assert.equal(retry.cancelAt, result.cancelAt);
  assert.ok([...f.table('user').values()].some(row => row.USER_MINI_OPENID === 'poster'));
});

test('a deliberate login within two hours cancels deletion and preserves every school profile', async () => {
  const f = await setup(), initial = await f.login();
  const before = [...f.table('user').values()].filter(row => row.USER_MINI_OPENID === 'poster');
  await f.account().requestCancellation('poster', initial.token.sessionToken);
  const relogin = await f.login();
  assert.equal(relogin.cancellationCancelled, true);
  assert.equal(relogin.user.USER_NAME, 'poster');
  assert.equal(relogin.token.profileComplete, true);
  assert.equal(await f.account().authenticate('poster', initial.token.sessionToken), null);
  assert.ok(await f.account().authenticate('poster', relogin.token.sessionToken));
  assert.equal([...f.table('user').values()].filter(row => row.USER_MINI_OPENID === 'poster').length, before.length);
});

test('at the exact cancellation deadline login creates a fresh profile and cannot restore deleted data', async () => {
  const f = await setup(), login = await f.login();
  await f.put(A, 'identity_unique', 'own-phone', { userId: 'poster' });
  await f.put(C, 'identity_unique', 'other-phone', { userId: 'rider' });
  await f.account().requestCancellation('poster', login.token.sessionToken);
  const state = [...f.table('account_session').values()].find(row => row.userId === 'poster');
  const now = Date.now; Date.now = () => state.cancelAt;
  try {
    const relogin = await f.login();
    assert.equal(relogin.cancellationCancelled, false);
    assert.equal(relogin.user.USER_NAME, '');
    assert.equal(relogin.user.USER_MOBILE, '');
    assert.equal(relogin.token.profileComplete, false);
    assert.equal(f.table('identity_unique').has('own-phone'), false);
    assert.equal(f.table('identity_unique').has('other-phone'), true);
    assert.equal([...f.table('user').values()].filter(row => row.USER_MINI_OPENID === 'poster').length, 1);
  } finally { Date.now = now; }
});

test('scheduled maintenance deletes due accounts without requiring another login and anonymizes completed orders', async () => {
  const f = await setup(), login = await f.login();
  await f.put(B, 'mail', 'history', { MAIL_USER_ID: 'poster', MAIL_USER_NAME: '原昵称', MAIL_ACCEPT_USER_ID: 'rider', MAIL_ACCEPT_USER_NAME: '接单人', MAIL_STATUS: 9,
    MAIL_OBJ: { poster: '原姓名', tel: '13800000000', address2: '宿舍地址', title: '已完成订单' }, MAIL_FORMS: [{ mark: 'tel', val: '13800000000' }] });
  await f.put(A, 'notification', 'private-notice', { userId: 'poster', content: '个人消息' });
  await f.put(A, 'subscription', 'private-sub', { userId: 'poster', enabled: true });
  await f.account().requestCancellation('poster', login.token.sessionToken);
  const state = [...f.table('account_session').values()].find(row => row.userId === 'poster');
  state.cancelAt = Date.now() - 1;
  await new (f.service('maintenance_service'))().runScheduled('orders', { maxBatches: 1 });
  assert.equal([...f.table('user').values()].some(row => row.USER_MINI_OPENID === 'poster'), false);
  assert.equal(f.table('notification').has('private-notice'), false);
  assert.equal(f.table('subscription').has('private-sub'), false);
  const history = f.table('mail').get('history');
  assert.ok(history, 'counterparty retains a completed order');
  assert.notEqual(history.MAIL_USER_ID, 'poster');
  assert.equal(history.MAIL_USER_NAME, '已注销用户');
  assert.equal(history.MAIL_ACCEPT_USER_ID, 'rider');
  assert.ok(!JSON.stringify(history).includes('13800000000'));
  assert.ok(!JSON.stringify(history).includes('宿舍地址'));
});

test('private routes require a session while logged-out public order details omit ownership and contacts', async () => {
  const f = await setup(), login = await f.login();
  const Account = f.service('account_service');
  let reached = false;
  await assert.rejects(Account.runRequest('passport/my_detail', 'poster', '', () => { reached = true; }), /登录/);
  assert.equal(reached, false);
  assert.deepEqual(JSON.parse(JSON.stringify(await Account.runRequest('passport/login', 'poster', '', () => { reached = true; }))), { token: null });
  assert.equal(reached, false);
  const anonymous = await Account.runRequest('mail/view', 'poster', '', userId => ({ userId }));
  assert.equal(anonymous.userId, '');
  const authenticated = await Account.runRequest('mail/view', 'poster', login.token.sessionToken, userId => ({ userId }));
  assert.equal(authenticated.userId, 'poster');
});

test('an already-started mutation rechecks the session inside its transaction after logout', async () => {
  const f = await setup(), login = await f.login(), Account = f.service('account_service');
  await assert.rejects(Account.runRequest('mail/insert', 'poster', login.token.sessionToken, async () => {
    await f.account().logout('poster', login.token.sessionToken);
    await f.store.transaction(tx => f.store.set(tx, 'mail', 'should-not-exist', { MAIL_USER_ID: 'poster' }));
  }), /登录/);
  assert.equal(f.table('mail').has('should-not-exist'), false);
});

test('cleanup failure cannot reopen a due account and a retry finishes without restoring its old profile', async () => {
  const f = await setup(), login = await f.login();
  await f.account().requestCancellation('poster', login.token.sessionToken);
  const state = [...f.table('account_session').values()].find(row => row.userId === 'poster'); state.cancelAt = Date.now() - 1;
  const transaction = f.store.transaction;
  f.store.transaction = async () => { throw new Error('database unavailable'); };
  await assert.rejects(f.login(), /database unavailable/);
  f.store.transaction = transaction;
  assert.equal(await f.account().authenticate('poster', login.token.sessionToken), null);
  const next = await f.login();
  assert.equal(next.token.profileComplete, false); assert.equal(next.user.USER_NAME, '');
});

test('deletion anonymizes the real review schema without changing the other participant name', async () => {
  const f = await setup(), login = await f.login();
  await f.put(A, 'order_review', 'sent', { REVIEW_FROM_USER_ID: 'poster', REVIEW_TO_USER_ID: 'rider', REVIEW_FROM_NAME: '旧昵称', REVIEW_TO_NAME: '接单同学', REVIEW_CONTENT: '旧评价', REVIEW_SCORE: 5 });
  await f.put(C, 'order_review', 'received', { REVIEW_FROM_USER_ID: 'rider', REVIEW_TO_USER_ID: 'poster', REVIEW_FROM_NAME: '接单同学', REVIEW_TO_NAME: '旧昵称', REVIEW_CONTENT: '旧评价', REVIEW_SCORE: 4 });
  await f.account().requestCancellation('poster', login.token.sessionToken);
  [...f.table('account_session').values()].find(row => row.userId === 'poster').cancelAt = Date.now() - 1;
  await f.account().finalize('poster');
  for (const row of f.table('order_review').values()) {
    assert.notEqual(row.REVIEW_FROM_USER_ID, 'poster'); assert.notEqual(row.REVIEW_TO_USER_ID, 'poster');
    assert.ok(!JSON.stringify(row).includes('旧昵称'));
  }
  assert.equal(f.table('order_review').get('sent').REVIEW_TO_NAME, '接单同学');
  assert.equal(f.table('order_review').get('received').REVIEW_FROM_NAME, '接单同学');
});

test('deletion removes nested parcel contact data and a fresh account gets a new usable invitation', async () => {
  const f = await setup(), login = await f.login(), invites = new (f.service('invite_service'))();
  const code = await tenant.run(A, () => invites.getOrCreateMyInviteCode('poster'));
  const other = await tenant.run(A, () => invites.getOrCreateMyInviteCode('rider'));
  await tenant.run(A, () => invites.acceptInvite('poster', other.code));
  await f.put(A, 'mail', 'parcels', { MAIL_USER_ID: 'poster', MAIL_STATUS: 9,
    MAIL_OBJ: { title: '订单', packages: [{ type: 'small', code: '秘密取件码', note: '私人联系方式', images: ['cloud://test/private/poster/a.jpg'] }] },
    MAIL_FORMS: [{ mark: 'packages', val: [{ code: '秘密取件码', note: '私人联系方式' }] }] });
  await f.account().requestCancellation('poster', login.token.sessionToken);
  [...f.table('account_session').values()].find(row => row.userId === 'poster').cancelAt = Date.now() - 1;
  await f.account().finalize('poster');
  const mail = JSON.stringify(f.table('mail').get('parcels'));
  assert.ok(!mail.includes('秘密取件码')); assert.ok(!mail.includes('私人联系方式'));
  await f.login();
  const user = [...f.table('user').values()].find(row => row.USER_MINI_OPENID === 'poster'); user.USER_STATUS = 1;
  const next = await tenant.run(A, () => invites.getOrCreateMyInviteCode('poster'));
  assert.match(next.code, /^[A-Z0-9]{6}$/); assert.notEqual(next.code, code.code);
  const accepted = await tenant.run(A, () => invites.acceptInvite('poster', other.code));
  assert.equal(accepted.accepted, true); assert.notEqual(accepted.alreadyAccepted, true);
});

test('an invitation acceptance read before deletion cannot recreate a link to the old account', async () => {
  const f = await setup(), login = await f.login(), invites = new (f.service('invite_service'))();
  const code = await tenant.run(A, () => invites.getOrCreateMyInviteCode('poster'));
  const original = f.store.transaction; let release, entered;
  const gate = new Promise(resolve => { release = resolve; }), reached = new Promise(resolve => { entered = resolve; });
  let blocked = false;
  f.store.transaction = async callback => { if (!blocked) { blocked = true; entered(); await gate; } return original(callback); };
  const accept = tenant.run(A, () => invites.acceptInvite('rider', code.code)); await reached;
  await f.account().requestCancellation('poster', login.token.sessionToken);
  [...f.table('account_session').values()].find(row => row.userId === 'poster').cancelAt = Date.now() - 1;
  await f.account().finalize('poster'); release();
  const result = await accept; assert.equal(result.accepted, false);
  assert.equal([...f.table('invite').values()].some(row => row.INV_USER_ID === 'poster' || row.INV_ACCEPT_USER_ID === 'poster'), false);
});

test('the application rejects private reads and silent login during cancellation without restoring the account', async () => {
  const f = await setup(), app = f.load('framework/core/application.js');
  f.load('framework/validate/data_check.js').check = require('../../cloudfunctions/mcloud/framework/validate/data_check.js').check;
  const call = (route, token = '', scope = A) => app.app({ route, PID: 'crun', params: {}, scope, token }, {});
  const login = await call('passport/wechat_identity_login'); assert.equal(login.code, 200, login.msg);
  const credential = login.data.token.sessionToken;
  const cancel = await call('passport/cancel', credential); assert.equal(cancel.code, 200, cancel.msg);
  const read = await call('passport/my_detail', credential); assert.equal(read.code, 2301);
  const silent = await call('passport/login', credential); assert.equal(silent.code, 200); assert.equal(silent.data.token, null);
  assert.equal([...f.table('account_session').values()].find(row => row.userId === 'crun^^^poster').status, 'pending');
});

for (const route of ['passport/logout', 'passport/cancel']) test(route + ' remains usable without an active campus', async () => {
  const f = await setup(), app = f.load('framework/core/application.js');
  f.load('framework/validate/data_check.js').check = require('../../cloudfunctions/mcloud/framework/validate/data_check.js').check;
  const login = await app.app({ route: 'passport/wechat_identity_login', PID: 'crun', params: {}, scope: A }, {});
  assert.equal(login.code, 200, login.msg);
  for (const row of f.table('campus').values()) row.enabled = false;
  const result = await app.app({ route, PID: 'crun', params: {}, scope: A, token: login.data.token.sessionToken }, {});
  assert.equal(result.code, 200, result.msg);
  assert.equal(await f.account().authenticate('crun^^^poster', login.data.token.sessionToken), null);
});

for (const action of ['publish', 'accept']) test('overlapping ' + action + ' and cancellation cannot both commit', async () => {
  const f = await setup(), userId = action === 'publish' ? 'poster' : 'rider';
  const account = await f.login(userId), Account = f.service('account_service'), mail = new (f.service('mail_service'))();
  const order = action === 'accept' ? await tenant.run(A, () => mail.insertMail('poster', { forms: f.forms(), requestId: 'req_before_cancel_race' })) : null;
  const metrics = concurrentTransactions({ ...f, load: () => f.service('operation_store') }, { productionRetries: true, commitDelayMs: 10 });
  const outcomes = await Promise.allSettled([
    tenant.run(A, () => Account.runRequest(action === 'publish' ? 'mail/insert' : 'mail/accept', userId, account.token.sessionToken, () => action === 'publish'
      ? mail.insertMail(userId, { forms: f.forms(), requestId: 'req_publish_cancel_race' })
      : mail.acceptMail(userId, order._id, { requestId: 'req_accept_cancel_race' }))),
    f.account().requestCancellation(userId, account.token.sessionToken)
  ]);
  assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled').length, 1);
  assert.ok(metrics.maxActive >= 2, 'callbacks really overlap'); assert.ok(metrics.conflicts >= 1, 'uses production conflict retries');
  const active = [...f.table('mail').values()].filter(row => row[action === 'publish' ? 'MAIL_USER_ID' : 'MAIL_ACCEPT_USER_ID'] === userId);
  const state = [...f.table('account_session').values()].find(row => row.userId === userId);
  assert.equal(active.length > 0 && state.status === 'pending', false);
});

test('cleanup scrubs copied private evidence from every order event in multiple batches', async () => {
  const f = await setup(), login = await f.login();
  await f.put(A, 'mail', 'closed', { MAIL_USER_ID: 'poster', MAIL_ACCEPT_USER_ID: 'rider', MAIL_STATUS: 9 });
  for (let index = 0; index < 83; index++) await f.put(A, 'order_event', 'event-' + index, { orderId: 'closed', actorId: 'rider', note: '旧私有说明', proof: { images: ['私有图片'] }, exception: { text: '旧私有异常' } });
  await f.account().requestCancellation('poster', login.token.sessionToken);
  [...f.table('account_session').values()].find(row => row.userId === 'poster').cancelAt = Date.now() - 1;
  await f.account().finalize('poster');
  assert.equal(f.table('order_event').size, 83);
  for (const event of f.table('order_event').values()) { assert.equal(event.actorId, 'rider'); assert.equal(event.proof, null); assert.equal(event.exception, null); assert.equal(event.note, ''); }
});

test('a delayed administrator reply cannot recreate an erased chat after fresh registration', async () => {
  const f = await setup(), login = await f.login(), chat = new (f.service('campus_service_service'))();
  await f.put(A, 'campus_service', 'service', { CS_STATUS: 1 });
  const message = await tenant.run(A, () => chat.sendCampusMessage('poster', 'service', '旧私密咨询', 'req_old_chat_message'));
  const original = f.store.transaction; let release, entered, blocked = false;
  const gate = new Promise(resolve => { release = resolve; }), reached = new Promise(resolve => { entered = resolve; });
  f.store.transaction = async callback => { if (!blocked) { blocked = true; entered(); await gate; } return original(callback); };
  const reply = tenant.run(A, () => chat.replyCampusMessage(message.sessionId, '旧账号的私密回复', 'req_old_chat_reply', 'platform'));
  const rejected = assert.rejects(reply, /会话|注销/); await reached;
  await f.account().requestCancellation('poster', login.token.sessionToken);
  [...f.table('account_session').values()].find(row => row.userId === 'poster').cancelAt = Date.now() - 1;
  await f.account().finalize('poster'); await f.login();
  release(); await rejected;
  assert.equal(f.table('campus_service_message').size, 0);
});
