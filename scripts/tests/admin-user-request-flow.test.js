'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { fixture } = require('../test-support/operations-fixture.cjs');
const { harness, root } = require('../test-support/admin-console-harness.cjs');
const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
const tap = dataset => ({ currentTarget: { dataset } });

// Keep the real request envelope, routes, controllers, validation and project
// models. Only the WeChat transport and database I/O use local sample records.
function requestFixture() {
  const f = fixture(), backendRoot = path.join(root, 'cloudfunctions/mcloud');
  const requests = [], writes = [], redirects = [], cache = new Map();
  const database = f.store.database();
  const rows = (collection, where) => database.collection(collection).where(where).limit(1000).get();
  const project = (row, fields) => !row || !fields || fields === '*' ? copy(row) :
    Object.fromEntries(['_id', ...fields.split(',')].filter(key => Object.hasOwn(row, key)).map(key => [key, copy(row[key])]));
  const db = {
    async getOne(collection, where, fields) { return project((await rows(collection, where)).data[0] || null, fields); },
    async getList(collection, where, fields, orderBy, page = 1, size = 20) {
      const query = database.collection(collection).where(where);
      for (const [field, direction] of Object.entries(orderBy || {})) query.orderBy(field, direction);
      const total = (await query.count()).total;
      return { list: (await query.skip((page - 1) * size).limit(size).get()).data.map(row => project(row, fields)), page, size, total, count: Math.ceil(total / size) };
    },
    async edit(collection, where, data) {
      writes.push({ collection, where: copy(where), data: copy(data) });
      for (const row of (await rows(collection, where)).data) Object.assign(f.table(collection.replace(/^bx_/, '')).get(row._id), copy(data));
    },
    async inc(collection, where, field, amount) {
      for (const row of (await rows(collection, where)).data) f.table(collection.replace(/^bx_/, '')).get(row._id)[field] = Number(row[field] || 0) + amount;
    },
    async insert(collection, data) {
      const table = f.table(collection.replace(/^bx_/, '')), id = 'test-record-' + table.size;
      table.set(id, { ...copy(data), _id: id });
      return id;
    }
  };
  const overrides = {
    'framework/database/db_util.js': db,
    'framework/cloud/cloud_base.js': { getCloud: () => ({ getWXContext: () => ({ OPENID: 'admin-openid', CLIENTIP: '127.0.0.1' }) }) },
    'config/config.js': { COLLECTION_PRFIX: 'bx_', ADMIN_LOGIN_EXPIRE: 86400 },
    'framework/utils/export_util.js': {},
    'project/crun/service/admin/admin_home_service.js': class {},
    'project/crun/service/operation_store.js': f.store,
    'project/crun/service/operation_config_service.js': f.load('operation_config_service.js')
  };
  function backend(relative) {
    const absolute = path.resolve(backendRoot, relative), key = path.relative(backendRoot, absolute).split(path.sep).join('/');
    if (Object.hasOwn(overrides, key)) return overrides[key];
    if (cache.has(absolute)) return cache.get(absolute).exports;
    const module = { exports: {} };
    cache.set(absolute, module);
    vm.runInNewContext(fs.readFileSync(absolute, 'utf8'), {
      module, Buffer, Date, global: { PID: 'crun' }, console: { log() {}, warn() {}, error() {} },
      require(name) {
        if (name === 'crypto') return require('node:crypto');
        if (name.startsWith('.')) return backend(path.relative(backendRoot, path.resolve(path.dirname(absolute), name)));
        throw Error('Unexpected backend dependency: ' + name);
      }
    }, { filename: absolute });
    return module.exports;
  }
  const routes = backend('project/crun/public/route.js');
  async function dispatch(event) {
    if (!event.route.startsWith('admin/user_')) throw Error('Unexpected route: ' + event.route);
    const [file, method] = routes[event.route].split('#')[0].split('@');
    const Controller = backend('project/crun/controller/' + file + '.js');
    try { return { code: 200, data: copy(await new Controller(event.route, 'admin-openid', event)[method]()) }; }
    catch (error) { return { code: error.code || 500, msg: error.message }; }
  }
  const admin = { _id: 'admin', _pid: 'crun', ADMIN_NAME: 'sample-admin', ADMIN_DESC: '测试管理员', ADMIN_STATUS: 1, ADMIN_TYPE: 1,
    ADMIN_TOKEN: 'local-admin-token', ADMIN_TOKEN_USER: 'admin-openid', ADMIN_TOKEN_TIME: Date.now() };
  f.table('admin').set(admin._id, admin);
  const wx = {
    reLaunch: options => redirects.push(options.url),
    cloud: { callFunction(options) {
      const event = copy(options.data);
      requests.push(event);
      dispatch(event).then(result => { options.success({ result }); options.complete({}); }, error => options.fail(error));
    } }
  };
  function client(relative, dependencies) {
    const absolute = path.join(root, 'miniprogram', relative), module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(absolute, 'utf8'), { module, wx, console: { log() {} }, require: dependencies }, { filename: absolute });
    return module.exports;
  }
  const cloud = client('helper/cloud_helper.js', name => {
    if (name === './helper.js') return { isDefined: value => value !== undefined };
    if (name === './cache_helper.js') return { get: key => key === 'ADMIN_TOKEN' ? { token: admin.ADMIN_TOKEN } : null };
    if (name === '../comm/constants.js') return require('../../miniprogram/comm/constants.js');
    if (name.endsWith('/page_helper.js')) return { getPID: () => 'crun', fmtURLByPID: url => '/projects/crun' + url };
    return {};
  });
  const Ops = client('projects/crun/biz/operations_biz.js', name => {
    if (name.endsWith('/cloud_helper.js')) return cloud;
    return {};
  });
  const Passport = backend('project/crun/service/passport_service.js');
  f.config.registrationReview = false;
  return { ...f, admin, requests, writes, redirects, Ops, passport: new Passport(),
    page: relative => harness(relative, (route, params) => Ops.get(route, params)) };
}

async function registered(f) {
  const result = await f.passport.register('sample-user-openid', { name: '同学[1]', mobile: '13900000001', pic: 'sample-avatar',
    forms: [{ mark: 'campus', title: '校区', val: '育才校区' }] });
  const id = f.store.key('crun', 'user', result.token.id);
  return { token: result.token, id, row: f.table('user').get(id) };
}

test('registered login reaches user details through the real request and model layers and manages the same document', async () => {
  const f = requestFixture(), { token, id, row } = await registered(f);
  assert.notEqual(id, token.id);
  assert.notEqual(id, token.key);
  assert.equal(row.USER_LOGIN_CNT, 1);
  f.table('user').set('foreign-user', { ...copy(row), _id: 'foreign-user', _pid: 'another-project' });
  const list = f.page('user/list/admin_user_list.js');
  await list.page.onLoad({ status: '1' });
  list.page.bindInput({ detail: { value: '同学[1]' } });
  await list.page.bindSearch();
  assert.deepEqual(Array.from(list.page.data.list, user => user.userId), [id]);
  list.page.bindDetail(tap({ id: list.page.data.list[0].userId }));
  const options = Object.fromEntries(new URLSearchParams(list.navigation.at(-1).url.split('?')[1]));
  const detail = f.page('user/detail/admin_user_detail.js');
  await detail.page.onLoad(options);
  assert.equal(detail.page.data.error, '');
  assert.equal(detail.page.data.loading, false);
  assert.equal(detail.page.data.user.USER_NAME, '同学[1]');
  assert.notEqual(detail.page.data.user.USER_LOGIN_TIME, '未登录');
  for (const status of [9, 1]) {
    await detail.page.bindStatus(tap({ status }));
    assert.equal(detail.page.data.user.USER_STATUS, status);
    assert.equal((await f.passport.login(token.id)).token.status, status);
    assert.equal(detail.page.data.busy, false);
  }
  assert.equal(f.table('user').get('foreign-user').USER_STATUS, 1);
  const statusWrites = f.writes.filter(write => Object.hasOwn(write.data, 'USER_STATUS'));
  assert.equal(statusWrites.length, 2);
  assert.ok(statusWrites.every(write => write.where._id === id && write.where._pid === 'crun'));
  assert.ok(f.requests.every(event => event.PID === 'crun' && event.token === 'local-admin-token'));
  for (const legacyId of [token.id, token.key]) {
    const legacy = f.page('user/detail/admin_user_detail.js');
    await legacy.page.onLoad({ id: encodeURIComponent(legacyId) });
    assert.equal(legacy.page.data.user.userId, id);
  }
  const foreign = f.page('user/detail/admin_user_detail.js');
  await foreign.page.onLoad({ id: 'foreign-user' });
  assert.equal(foreign.page.data.notFound, true);
});

async function settles(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Request did not settle after the login redirect')), 1000); })]); }
  finally { clearTimeout(timer); }
}

test('an expired administrator session ends user reads and mutations, preserves the draft and redirects to login', async () => {
  const f = requestFixture(), { id, row } = await registered(f);
  const detail = f.page('user/detail/admin_user_detail.js');
  await detail.page.onLoad({ id });
  detail.page.bindReason({ detail: { value: '保留尚未提交的处理说明' } });
  f.admin.ADMIN_TOKEN_TIME = 0;
  await settles(detail.page.bindStatus(tap({ status: 9 })));
  assert.equal(row.USER_STATUS, 1);
  assert.equal(detail.page.data.busy, false);
  assert.equal(detail.page.data.reason, '保留尚未提交的处理说明');
  assert.equal(detail.events.length, 0);
  const unread = f.page('user/detail/admin_user_detail.js');
  await settles(unread.page.onLoad({ id }));
  assert.equal(unread.page.data.loading, false);
  assert.match(unread.page.data.error, /管理员/);
  assert.equal(unread.page.data.user, null);
  assert.equal(f.redirects.length, 2);
  assert.ok(f.redirects.every(url => url.endsWith('/admin/index/login/admin_login')));
});
