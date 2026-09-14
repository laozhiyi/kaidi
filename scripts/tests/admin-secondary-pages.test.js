'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { harness, root } = require('../test-support/admin-console-harness.cjs');
const event = dataset => ({ currentTarget: { dataset } });
const tick = () => new Promise(resolve => setImmediate(resolve));
const copy = value => JSON.parse(JSON.stringify(value));
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const list = (rows, page = 1, total = rows.length) => ({ list: rows, page, size: 20, total });
const userPage = 'user/detail/admin_user_detail.js';
const managerList = 'mgr/list/admin_mgr_list.js';

test('user details accept legacy links, normalize mixed registration fields and update the resolved document', async () => {
  const row = { _id: 'document-id', USER_MINI_OPENID: 'open/id', USER_STATUS: '0', USER_FORMS: [null, { title: '宿舍', val: ['南苑', '101'] }, { type: 'image', val: 'cloud://proof' }] };
  const h = harness(userPage, () => row);
  await h.page.onLoad({ id: 'open%2Fid' });
  assert.equal(h.calls[0].params.id, 'open/id');
  assert.equal(h.page.data.user.USER_STATUS, 0);
  assert.equal(h.page.data.user.USER_FORMS[0].displayValue, '南苑、101');
  assert.deepEqual(copy(h.page.data.user.USER_FORMS[1].images), ['cloud://proof']);
  await h.page.bindStatus(event({ status: '1' }));
  const update = h.calls.find(call => call.route === 'admin/user_status');
  assert.equal(update.params.id, 'document-id');
  assert.equal(update.params.status, 1);
  assert.equal(h.events[0].emit, 'changed');
  assert.equal(h.UI.user({ _id: 'legacy', USER_STATUS: 'invalid' }).USER_STATUS, -1);
});

test('user detail retry recovers, empty records cannot be managed and rejection requires a reason', async () => {
  let response = Error('读取失败');
  const h = harness(userPage, () => { if (response instanceof Error) throw response; return response; });
  await h.page.onLoad({ id: 'one' }); assert.equal(h.page.data.error, '读取失败');
  response = {}; await h.page.load(); assert.equal(h.page.data.notFound, true);
  await h.page.bindStatus(event({ status: 1 })); assert.equal(h.calls.length, 2);
  response = { _id: 'one', USER_STATUS: 0 }; await h.page.load();
  await h.page.bindStatus(event({ status: 8 }));
  assert.equal(h.calls.length, 3); assert.match(h.errors.at(-1), /原因/);
  assert.equal(h.page.data.loading, false); assert.equal(h.page.data.error, '');
});

test('failed user management preserves reason and coalesces repeated taps', async () => {
  const pending = deferred();
  const h = harness(userPage, route => route.endsWith('_detail') ? { _id: 'one', USER_STATUS: 0 } : pending.promise);
  await h.page.onLoad({ id: 'one' }); h.page.bindReason({ detail: { value: '缺少校区信息' } });
  const action = h.page.bindStatus(event({ status: 8 })); await tick();
  await h.page.bindStatus(event({ status: 8 }));
  assert.equal(h.calls.filter(call => call.route.endsWith('_status')).length, 1);
  pending.reject(Error('保存失败')); await action;
  assert.equal(h.page.data.reason, '缺少校区信息'); assert.equal(h.page.data.busy, false);
  assert.equal(h.events.length, 0);
});

test('catalog search and stopped status combine, pagination survives a void-result mutation and retains scroll', async () => {
  let stop = false;
  const h = harness(managerList, (route, p) => route.endsWith('_list') ? list([{ _id: 'p' + p.page, ADMIN_STATUS: stop ? 0 : 1 }], p.page, 40) : (stop = true, undefined));
  await h.page.onLoad();
  h.page.bindInput({ detail: { value: '  陈[1]  ' } }); await h.page.bindSearch();
  await h.page.bindMenu(event({ index: 4 })); await h.page.bindMore();
  assert.equal(h.calls.at(-1).params.search, '陈[1]');
  assert.equal(h.calls.at(-1).params.sortType, 'status'); assert.equal(h.calls.at(-1).params.sortVal, 0);
  h.page.onPageScroll({ scrollTop: 500 });
  await h.page.bindStatusTap(event({ id: 'p1', status: 0 }));
  assert.equal(h.calls.find(call => call.route.endsWith('_status')).params.status, 0);
  assert.equal(h.page.data.page, 2); assert.equal(h.page.data.list.length, 2);
  assert.equal(h.page.data.list[0].ADMIN_STATUS, 0); assert.equal(h.scrolls.at(-1).scrollTop, 500);
  h.page.onHide(); const before = h.calls.length; await h.page.onShow();
  assert.equal(h.calls.length, before + 2);
});

test('secondary management enforces permissions and cancelled actions cause no writes', async () => {
  for (const page of [managerList, 'mgr/add/admin_mgr_add.js', 'mgr/edit/admin_mgr_edit.js']) {
    const h = harness(page, () => ({}), { superAdmin: false }); await h.page.onLoad({ id: 'one' });
    assert.equal(h.calls.length, 0);
  }
  const logs = harness('mgr/log/admin_log_list.js', () => list([]), { superAdmin: false });
  await logs.page.onLoad(); await logs.page.bindClearTap(); assert.equal(logs.calls.length, 1);
  const h = harness(managerList, () => list([]), { confirm: false });
  await h.page.onLoad(); await h.page.bindStatusTap(event({ id: 'one', status: 0 }));
  assert.equal(h.calls.length, 1); assert.equal(h.page.data.busy, false);
});

test('manager creation validates real rules, retains failed drafts and blocks duplicate submissions', async () => {
  const pending = deferred();
  const h = harness('mgr/add/admin_mgr_add.js', () => pending.promise);
  await h.page.onLoad(); await h.page.bindFormSubmit(); assert.equal(h.calls.length, 0);
  h.page.setData({ formName: 'campus_admin', formDesc: '校区管理员', formPassword: 'sample-only-password' });
  const action = h.page.bindFormSubmit(); await tick(); await h.page.bindFormSubmit();
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].params.type, 0);
  pending.reject(Error('账号已存在')); await action;
  assert.equal(h.page.data.formName, 'campus_admin'); assert.equal(h.page.data.busy, false);
  assert.equal(h.navigation.length, 0);
});

test('manager edit supports an unchanged password and password mismatch never submits', async () => {
  const h = harness('mgr/edit/admin_mgr_edit.js', route => route.endsWith('_detail') ? { _id: 'mgr', ADMIN_NAME: 'manager1', ADMIN_DESC: '小林' } : undefined);
  await h.page.onLoad({ id: 'mgr' }); await h.page.bindFormSubmit();
  assert.equal(h.calls.at(-1).params.id, 'mgr'); assert.equal(h.calls.at(-1).params.password, '');
  assert.equal(h.events[0].emit, 'changed'); assert.match(h.navigation[0].url, /admin_mgr_list$/);
  const pwd = harness('mgr/pwd/admin_mgr_pwd.js', () => undefined, { superAdmin: false });
  await pwd.page.onLoad(); pwd.page.setData({ formOldPassword: 'old-sample', formPassword: 'new-sample', formPassword2: 'mismatch' });
  await pwd.page.bindFormSubmit(); assert.equal(pwd.calls.length, 0);
  pwd.page.setData({ formPassword2: 'new-sample' }); await pwd.page.bindFormSubmit();
  assert.equal(pwd.calls[0].route, 'admin/mgr_pwd'); assert.equal(pwd.events[0].logout, true);
  assert.equal(pwd.page.data.formPassword, ''); assert.equal(pwd.navigation[0].method, 'reLaunch');
});

test('campus service saves zero sort order and rejects blank or invalid numeric input', async () => {
  const h = harness('campus_service/add/admin_campus_service_add.js', () => undefined);
  await h.page.onLoad(); h.page.setData({ formCampus: '育才校区', formName: '示例客服', formMobile: '13800000000', formOrder: '' });
  await h.page.bindFormSubmit(); assert.equal(h.calls.length, 0);
  h.page.setData({ formOrder: '0' }); await h.page.bindFormSubmit();
  assert.equal(h.calls[0].params.order, 0); assert.equal(h.page.data.isSubmit, false);
});

test('announcement creation accepts no custom fields and uploads cover and content before returning', async () => {
  const h = harness('news/add/admin_news_add.js', route => route.endsWith('_insert') ? { id: 'news-one' } : undefined);
  await h.page.onLoad({});
  assert.equal(h.page.data.fields.length, 0);
  h.page.setData({ formTitle: '校区服务通知', formContent: [{ type: 'text', val: '本周服务安排已更新，请大家及时查看。' }], imgList: ['cloud://sample-cover'] });
  await h.page.bindFormSubmit();
  assert.deepEqual(copy(h.calls[0].params.forms), []);
  assert.equal(h.calls[0].params.draft, true);
  assert.deepEqual(h.calls.map(call => call.route), ['admin/news_insert', 'admin/news_update_pic', 'admin/news_update_content', 'admin/news_update_forms', 'admin/news_status']);
  assert.equal(h.calls.at(-1).params.id, 'news-one'); assert.equal(h.calls.at(-1).params.status, 1);
  assert.equal(h.page.data.isSubmit, false); assert.equal(h.navigation[0].method, 'navigateBack');
});

test('an interrupted announcement upload retries the same draft and publishes only after all uploads succeed', async () => {
  let failContent = true;
  const h = harness('news/add/admin_news_add.js', route => {
    if (route === 'admin/news_insert') return { id: 'draft-one' };
    if (route === 'admin/news_update_content' && failContent) throw Error('上传中断');
  });
  await h.page.onLoad({});
  h.page.setData({ formTitle: '校区服务通知', formContent: [{ type: 'text', val: '本周服务安排已更新，请大家及时查看。' }], imgList: ['cloud://sample-cover'] });
  await h.page.bindFormSubmit();
  assert.equal(h.page._draftNewsId, 'draft-one');
  assert.equal(h.page.data.isSubmit, false); assert.equal(h.navigation.length, 0);
  assert.equal(h.calls.filter(call => call.route === 'admin/news_status').length, 0);
  failContent = false;
  await h.page.bindFormSubmit();
  assert.equal(h.calls.filter(call => call.route === 'admin/news_insert').length, 1);
  assert.equal(h.calls.find(call => call.route === 'admin/news_edit').params.id, 'draft-one');
  assert.equal(h.calls.at(-1).route, 'admin/news_status');
  assert.equal(h.calls.at(-1).params.id, 'draft-one');
  const count = h.calls.length;
  await h.page.bindFormSubmit(); assert.equal(h.calls.length, count);
});

test('About editor validates the configured key, loads empty content and preserves editor state after a failed save', async () => {
  const invalid = harness('setup/about/admin_setup_about.js');
  await invalid.page.onLoad({ key: 'unknown' }); assert.equal(invalid.calls.length, 0); assert.match(invalid.page.data.error, /不存在/);
  const menu = harness('setup/about_list/admin_setup_about_list.js');
  await menu.page.onLoad();
  const key = menu.page.data.list[0].key;
  const content = [{ type: 'text', val: '保留的联系说明' }];
  const h = harness('setup/about/admin_setup_about.js', route => route === 'home/setup_get' ? [] : Promise.reject(Error('保存失败')), { components: { '#contentEditor': { getNodeList: () => content } } });
  await h.page.onLoad({ key }); assert.equal(h.page.data.isLoad, true); assert.equal(h.page.data.formContent[0].val, '');
  await h.page.bindFormSubmit(); assert.equal(h.page.data.busy, false); assert.equal(h.navigation.length, 0);
  assert.equal(content[0].val, '保留的联系说明'); assert.equal(h.calls.at(-1).params.id, key);
});

test('article QR links carry their own page and scene; image failures can regenerate successfully', async () => {
  const h = harness('news/list/admin_news_list.js', () => list([{ _id: 'article-one', NEWS_TITLE: '开学服务通知' }]));
  await h.page.onLoad(); h.page.bindMoreTap(event({ id: 'article-one' }));
  h.sheets[0].success({ tapIndex: 2 });
  const params = Object.fromEntries(new URLSearchParams(h.navigation[0].url.split('?')[1]));
  assert.equal(params.sc, 'article-one'); assert.equal(params.path, '/projects/crun/pages/news/detail/news_detail');
  let url = 'https://example.invalid/qr.png';
  const qr = harness('setup/qr/admin_setup_qr.js', () => url);
  await qr.page.onLoad(params); assert.equal(qr.calls[0].params.sc, 'article-one');
  qr.page.bindImageError(); assert.equal(qr.page.data.imageError, true);
  url += '?new'; await qr.page.load(); assert.equal(qr.page.data.qrUrl, url); assert.equal(qr.page.data.imageError, false);
});

function service(file, dependencies) {
  const module = { exports: {} };
  class Base { constructor() { this._timestamp = 123; } getProjectId() { return 'crun'; } AppError(message) { throw Error(message); } }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'cloudfunctions/mcloud/project/crun/service', file), 'utf8'), { module, console, require(request) {
    if (request.includes('base_project')) return Base;
    return dependencies(request);
  } });
  return new module.exports();
}

test('user service resolves document, OpenID and legacy ids, preserves project isolation and never edits an unresolved id', async () => {
  const rows = [
    { _id: 'doc', _pid: 'crun', USER_MINI_OPENID: 'openid', USER_ID: 'legacy', USER_STATUS: 0 },
    { _id: 'foreign', _pid: 'elsewhere', USER_MINI_OPENID: 'foreign-open', USER_STATUS: 0 }
  ];
  const writes = [], reads = [];
  const svc = service('admin/admin_user_service.js', request => request.endsWith('/user_model.js') ? {
    getOne: async where => { reads.push(where); return rows.find(row => row._pid === 'crun' && Object.entries(where).every(([key, val]) => row[key] === val)) || null; },
    edit: async (where, data) => { writes.push({ where, data }); Object.assign(rows.find(row => row._id === where._id), data); }
  } : {});
  for (const id of ['doc', 'openid', 'legacy']) assert.equal((await svc.getUser({ userId: id }))._id, 'doc');
  await svc.statusUser('openid', 1, '通过'); await svc.statusUser('legacy', 8, '缺少信息'); await svc.delUser('doc');
  assert.ok(writes.every(write => write.where._id === 'doc' && Object.keys(write.where).length === 1));
  assert.equal(rows[0].USER_STATUS, 9); assert.equal(rows[1].USER_STATUS, 0);
  for (const id of ['missing', 'foreign', 'foreign-open']) await assert.rejects(svc.statusUser(id, 1, ''), /不存在/);
  await assert.rejects(svc.statusUser('doc', 8, '  '), /原因/);
  await assert.rejects(svc.statusUser('doc', 7, ''), /状态/);
  assert.equal(writes.length, 3); assert.ok(reads.some(where => where.USER_ID === 'legacy'));
});

test('QR storage separates article scenes, scopes by project and preserves signed URL query parameters', async () => {
  const generated = [], uploaded = [];
  const cloud = { openapi: { wxacode: { getUnlimited: async data => { generated.push(data); return { buffer: 'sample-bytes' }; } } }, uploadFile: async data => { uploaded.push(data); return { fileID: 'cloud://sample' }; } };
  const svc = service('admin/admin_setup_service.js', request => {
    if (request.endsWith('/cloud_base.js')) return { getCloud: () => cloud };
    if (request.endsWith('/cloud_util.js')) return { getTempFileURLOne: async () => 'https://example.invalid/qr.png?sign=sample' };
    if (request.endsWith('/md5_lib.js')) return { md5: value => crypto.createHash('md5').update(value).digest('hex') };
    return {};
  });
  const first = await svc.genMiniQr('/projects/crun/pages/news/detail/news_detail', 'one');
  await svc.genMiniQr('/projects/crun/pages/news/detail/news_detail', 'two');
  assert.notEqual(uploaded[0].cloudPath, uploaded[1].cloudPath); assert.match(uploaded[0].cloudPath, /^crun\/setup\//);
  assert.equal(generated[0].scene, 'one'); assert.equal(generated[0].page[0], 'p');
  assert.equal(new URL(first).searchParams.get('sign'), 'sample'); assert.equal(new URL(first).searchParams.get('rd'), '123');
  await assert.rejects(svc.genMiniQr('/pages/detail?id=one', 'one'), /路径/);
});
