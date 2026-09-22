'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { fixture, A, B, tenant } = require('../test-support/tenant-services.cjs');
const password = require('../../cloudfunctions/mcloud/framework/utils/password_util.js');
const secret = 'local-test-password';
const root = path.resolve(__dirname, '../..');
const requestId = name => 'request_' + name.padEnd(16, '_');

async function adminFixture({ credentialsOnly = true, ...overrides } = {}) {
  const f = fixture({ credentialsOnly });
  await f.setup();
  const row = { _id: 'legacy', _pid: 'crun', ADMIN_NAME: 'ops', ADMIN_PASSWORD: password.hash(secret),
    ADMIN_STATUS: 1, ADMIN_TYPE: 1, ADMIN_LOGIN_CNT: 0, ...overrides };
  f.table('admin').set(row._id, row);
  const login = (pwd = secret, user = 'owner', name = row.ADMIN_NAME) => tenant.run(A,
    () => new (f.service('admin/admin_mgr_service'))().adminLogin(name, pwd, user));
  const sessions = new (f.load('framework/platform/service/base_admin_service.js'))();
  return { ...f, row, login, sessions };
}

test('internal testing defaults to credentials-only login and can explicitly restore restrictions', () => {
  const source = fs.readFileSync(path.join(root, 'cloudfunctions/mcloud/config/config.js'), 'utf8');
  for (const [env, expected] of [[{}, true], [{ ADMIN_LOGIN_CREDENTIALS_ONLY: 'false' }, false]]) {
    const module = { exports: {} };
    vm.runInNewContext(source, { module, process: { env } });
    assert.equal(module.exports.ADMIN_LOGIN_CREDENTIALS_ONLY, expected);
  }
});

for (const status of [1, 0, undefined]) {
  test('an existing admin without campus grants can log in and retain a session with status ' + status, async () => {
    const f = await adminFixture({ ADMIN_STATUS: status });
    const session = await f.login();
    assert.match(session.token, /^[a-f0-9]{64}$/);
    assert.equal(session.credentialsOnly, true);
    assert.equal(session.platform, false, 'temporary login must not promote an account to platform administrator');
    await tenant.run(A, async () => {
      assert.equal((await f.sessions.isAdmin(session.token, 'owner'))._id, 'legacy');
      assert.equal((await f.sessions.isSuperAdmin(session.token, 'owner'))._id, 'legacy');
    });
    const saved = f.table('admin').get('legacy');
    assert.equal(saved.ADMIN_STATUS, status);
    assert.equal(saved.ADMIN_PLATFORM, undefined);
    assert.equal(saved.ADMIN_SCOPES, undefined, 'temporary access never writes permanent grants');
  });
}

test('incorrect or missing credentials remain rejected, without creating admins or locking out a later correct attempt', async () => {
  const f = await adminFixture();
  for (let i = 0; i < 12; i++) await assert.rejects(f.login('wrong'), /账号或密码错误/);
  for (const [pwd, name] of [['', 'ops'], [secret, 'missing']]) await assert.rejects(f.login(pwd, 'owner', name), /账号或密码错误/);
  const session = await f.login();
  assert.ok(session.token);
  assert.equal(f.table('admin').size, 2);
  assert.equal(f.table('admin_limit').size, 0);
});

test('correct credentials still work when an old login rate-limit bucket is exhausted', async () => {
  const f = await adminFixture();
  for (let i = 0; i < 10; i++) await f.store.limitAdmin('crun', 'owner', 'admin_login', 10, 900000);
  assert.ok((await f.login()).token);
});

test('internal admin sessions still require the latest token, its owner, expiry and the proper role', async () => {
  const f = await adminFixture({ ADMIN_TYPE: 0 });
  const first = await f.login(), second = await f.login(secret, 'other');
  await tenant.run(A, async () => {
    await assert.rejects(f.sessions.isAdmin(first.token, 'owner'));
    await assert.rejects(f.sessions.isAdmin(second.token, 'owner'));
    await assert.rejects(f.sessions.isAdmin('', 'other'));
    assert.equal((await f.sessions.isAdmin(second.token, 'other')).ADMIN_TYPE, 0);
    await assert.rejects(f.sessions.isSuperAdmin(second.token, 'other'));
    await assert.rejects(new (f.service('tenant_service'))().adminDirectory(f.table('admin').get('legacy')), /平台管理员/);
    f.table('admin').get('legacy').ADMIN_TOKEN_TIME = 0;
    await assert.rejects(f.sessions.isAdmin(second.token, 'other'));
  });
});

test('legacy admins can use the dashboard and existing write transactions while rows remain campus isolated', async () => {
  const f = await adminFixture({ ADMIN_STATUS: 0 });
  const session = await f.login();
  const Mail = f.service('mail_service');
  const publish = (scope, name) => tenant.run(scope, () => new Mail().insertMail('poster', { forms: f.forms(scope), requestId: requestId(name) }));
  const a = await publish(A, 'local'), b = await publish(B, 'foreign');
  await tenant.run(A, async () => {
    await f.sessions.isAdmin(session.token, 'owner');
    const home = await new (f.service('admin/admin_home_service'))().adminHome();
    assert.equal(home.find(item => item.title === '代取数').cnt, 1);
    await new Mail().holdMail('legacy', a._id, { requestId: requestId('hold'), note: '测试处理' });
    assert.equal(f.table('mail').get(a._id).MAIL_STATUS, 3);
    assert.equal(await new Mail().getMailDetail('poster', b._id), null);
    const Config = f.service('operation_config_service');
    await new Config().saveConfig({ enabled: false }, 'legacy', 'service');
    assert.equal((await new Config().getConfig()).enabled, false);
    assert.equal(tenant.canSchoolAdmin(f.table('admin').get('legacy')), true);
  });
  assert.equal(f.table('mail').get(b._id).MAIL_STATUS, 0);
  assert.equal(await tenant.run(B, async () => (await new (f.service('operation_config_service'))().getConfig()).enabled), true);
});

test('the real admin login route accepts a correct existing account shorter than five characters', async () => {
  const f = await adminFixture();
  const app = f.load('framework/core/application.js');
  const result = await app.app({ route: 'admin/login', PID: 'crun', scope: A, params: { name: 'ops', pwd: secret } }, {});
  assert.equal(result.code, 200, result.msg);
  assert.equal(result.data.name, 'ops');
  assert.ok(result.data.token);
});

test('restoring strict mode rejects missing grants and disabled accounts and restores rate limits', async () => {
  const f = await adminFixture({ credentialsOnly: false, ADMIN_NAME: 'admin' });
  await assert.rejects(f.login(), /学校或校区/);
  f.table('admin').get('legacy').ADMIN_SCOPES = [{ schoolId: A.schoolId, campusId: A.campusId }];
  const session = await f.login();
  assert.equal(session.credentialsOnly, false);
  await tenant.run(A, () => f.sessions.isAdmin(session.token, 'owner'));
  f.table('admin').get('legacy').ADMIN_STATUS = 0;
  await assert.rejects(f.login(), /账号或密码/);
  await assert.rejects(tenant.run(A, () => f.sessions.isAdmin(session.token, 'owner')));
  for (let i = 0; i < 10; i++) await f.store.limitAdmin('crun', 'limited', 'admin_login', 10, 900000);
  f.table('admin').get('legacy').ADMIN_STATUS = 1;
  await assert.rejects(f.login(secret, 'limited'), /频繁/);
});

function client(response) {
  const calls = [], navigation = [], toasts = [];
  let cached;
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'miniprogram/comm/biz/admin_biz.js'), 'utf8'), {
    module, console: { log() {} }, wx: { showToast: value => toasts.push(value), reLaunch: value => navigation.push(value) },
    require(name) {
      if (name.endsWith('/base_biz.js')) return class {};
      if (name.endsWith('/cloud_helper.js')) return { callCloudSumbit: async (route, params) => { calls.push({ route, params }); return response; } };
      if (name.endsWith('/cache_helper.js')) return { set: (_, value) => { cached = value; }, get: () => cached };
      if (name.endsWith('/page_helper.js')) return { fmtURLByPID: value => '/projects/crun' + value };
      return {};
    }
  });
  return { biz: module.exports, calls, navigation, toasts, get cached() { return cached; } };
}

test('admin client validates a real session and uses the server-issued temporary access mode', async () => {
  const session = { token: 'server-token', name: 'ops', type: 0, credentialsOnly: true, scopes: [] };
  const f = client({ data: session });
  assert.equal(await f.biz.adminLogin({}, ' ops ', secret), true);
  assert.equal(f.calls[0].params.name, 'ops');
  assert.equal(f.cached.token, session.token);
  assert.equal(f.biz.isSchoolAdmin(), true);
  assert.equal(f.biz.isSuperAdmin(), false);
  assert.equal(f.navigation.length, 1);
});

test('empty passwords and incomplete login responses cannot navigate into the admin console', async () => {
  const f = client({ data: { name: 'ops' } });
  assert.equal(await f.biz.adminLogin({}, 'ops', ''), false);
  assert.equal(f.calls.length, 0);
  assert.equal(await f.biz.adminLogin({}, 'ops', secret), false);
  assert.equal(f.navigation.length, 0);
  assert.equal(f.cached, undefined);
});
