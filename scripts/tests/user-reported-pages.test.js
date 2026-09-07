'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const pages = 'miniprogram/projects/crun/pages/';
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const quiet = { log() {}, warn() {}, error() {} };
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((a,b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const config = { enabled: true, paymentMode: 'offline', campuses: ['东校区', '西校区'], smallPrice: 2.5, mediumPrice: 4, largePrice: 6, maxPackages: 20, offlineNotice: '线下结算' };
function pageHarness(file, get) {
 let definition;
 const calls = [], patches = [], errors = [], navigation = [];
 const wx = { setNavigationBarTitle() {}, showLoading() {}, hideLoading() {}, showToast() {}, stopPullDownRefresh() {},
  navigateTo: p => navigation.push(p), showModal: p => errors.push(p), setStorageSync() {}, switchTab: p => navigation.push(p) };
 const ops = { async get(route, params) { calls.push({ route, params }); return get(route, params); }, error: e => errors.push(e), subscribe() {} };
 vm.runInNewContext(read(pages + file), { Page: p => definition = p, console: quiet, wx, require(request) {
  if (request.includes('mail_ui_biz')) return require('../../miniprogram/projects/crun/biz/mail_ui_biz.js');
  if (request.includes('operations_biz')) return ops;
  if (request.includes('project_biz')) return { initPage() {} };
  if (request.includes('passport_biz')) return { loginMustBackWin: async () => true, loginMustCancelWin: async () => true };
  if (request.includes('mail_biz')) return { initFormData: () => ({ formCateId: 1, fields: [{ mark: 'code', must: true }] }) };
  if (request.includes('cloud_helper')) return { callCloudSumbit: async (route, params) => ({ data: await ops.get(route, params) }) };
  if (request.includes('page_helper')) return { fmtURLByPID: url => '/projects/crun' + url };
  return {};
 } });
 const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(patch, callback) {
  patches.push(patch);
  for (const [key, value] of Object.entries(patch)) {
   const parts = key.split('.'); let target = this.data;
   for (const part of parts.slice(0, -1)) target = target[part] ||= {};
   target[parts.at(-1)] = value;
  }
  if (callback) callback();
 }, selectComponent() { return this.data.isLoad ? { setOneFormVal() {}, reload() {} } : null; } };
 return { page, calls, patches, errors, navigation };
}

test('home express entry goes straight to the registered publishing page', () => {
 const h = pageHarness('default/index/default_index.js', () => ({}));
 h.page.bindExpressTap();
 assert.equal(h.navigation[0].url, '/projects/crun/pages/mail/add/mail_add');
 assert.ok(!read('miniprogram/app.json').includes('mail_choose'));
});

test('publish config failure exits loading and retries without a modal loop or duplicate form fields', async () => {
 let fail = true;
 const h = pageHarness('mail/add/mail_add.js', () => { if (fail) throw { msg: '服务器繁忙，请稍候再试' }; return config; });
 await h.page.onLoad({});
 assert.equal(h.page.data.isLoad, false); assert.equal(h.page.data.configError, true); assert.equal(h.page.data.pageLoading, false);
 assert.match(h.page.data.loadError, /服务器繁忙/); assert.equal(h.errors.length, 0);
 const count = h.page.data.formForms.length;
 fail = false; await h.page.bindRetryLoad();
 assert.equal(h.page.data.isLoad, true); assert.equal(h.page.data.configError, false); assert.equal(h.page.data.formForms.length, count);
 assert.equal(h.page.data.packageTypes[0].price, '2.50'); assert.equal(h.page.data.totalFee, '2.50');
 assert.equal(h.page.data.formForms.find(x => x.mark === 'price').val, '2.50');
});

test('refresh preserves publish drafts and campus, and blocks submission on failed config refresh', async () => {
 let fail = false;
 const h = pageHarness('mail/add/mail_add.js', () => { if (fail) throw Error('offline'); return config; });
 await h.page.onLoad({});
 h.page.bindMailInput({ currentTarget: { dataset: { mark: 'address2' } }, detail: { value: '宿舍201' } });
 h.page.bindPackageTap({ currentTarget: { dataset: { index: 1, step: 1 } } });
 h.page.setData({ campus: '西校区', formEnd: '2026-09-09 12:00' });
 fail = true; await h.page.onPullDownRefresh();
 assert.equal(h.page.data.isLoad, true); assert.equal(h.page.data.configError, true);
 await h.page.bindFormSubmit(); assert.equal(h.errors.length, 1);
 fail = false; await h.page.bindRetryLoad();
 assert.equal(h.page.data.mailValues.address2, '宿舍201'); assert.equal(h.page.data.campus, '西校区');
 assert.equal(h.page.data.formForms.find(x => x.mark === 'address2').val, '宿舍201');
 assert.equal(h.page.data.formEnd, '2026-09-09 12:00'); assert.equal(h.page.data.totalCount, 2); assert.equal(h.page.data.totalFee, '6.50');
});

test('invalid config fails closed instead of calling toFixed on malformed prices', async () => {
 for (const value of [null, {}, { ...config, smallPrice: '2.50' }, { ...config, campuses: [] }, { ...config, smallPrice: Infinity }]) {
  const h = pageHarness('mail/add/mail_add.js', () => value); await h.page.onLoad({});
  assert.equal(h.page.data.isLoad, false); assert.equal(h.page.data.configError, true); assert.equal(h.page.data.pageLoading, false);
 }
 const h = pageHarness('mail/add/mail_add.js', () => ({ ...config, enabled: false })); await h.page.onLoad({});
 assert.equal(h.page.data.config.enabled, false); await h.page.bindFormSubmit(); assert.equal(h.errors.length, 1);
});

test('publish retry coalesces repeated taps while config is pending', async () => {
 const wait = deferred(), h = pageHarness('mail/add/mail_add.js', () => wait.promise);
 const initial = h.page.onLoad({}); await tick();
 await h.page.bindRetryLoad(); await h.page.bindRetryLoad(); assert.equal(h.calls.length, 1);
 wait.resolve(config); await initial; assert.equal(h.page.data.isLoad, true);
});

test('editing cannot expose a blank save form when original detail failed or is not editable', async () => {
 let mail = {};
 const h = pageHarness('mail/add/mail_add.js', route => route === 'operations/config' ? config : mail);
 await h.page.onLoad({ id: 'missing' }); assert.equal(h.page.data.isLoad, false); assert.match(h.page.data.loadError, /不存在/);
 mail = { _id: 'someone-else', MAIL_STATUS: 0, mypost: false };
 await h.page.bindRetryLoad(); assert.equal(h.page.data.isLoad, false); assert.match(h.page.data.loadError, /不可编辑/);
 mail = { _id: 'mine', MAIL_STATUS: 0, mypost: true, MAIL_OBJ: { code: '123', address2: '宿舍301' }, MAIL_FORMS: [] };
 await h.page.bindRetryLoad(); assert.equal(h.page.data.isLoad, true); assert.equal(h.page.data.mailValues.address2, '宿舍301');
});

test('order detail renders even if optional config fails or never resolves', async () => {
 const mail = { _id: 'order', MAIL_OBJ: {}, MAIL_HISTORY: [] };
 const h = pageHarness('mail/my_detail/mail_my_detail.js', route => route === 'mail/view' ? mail : Promise.reject(Error('config down')));
 h.page.onLoad({ id: 'order' }); await h.page.onShow(); await tick();
 assert.equal(h.page.data.mail._id, 'order'); assert.equal(h.page.data.loading, false); assert.equal(h.page.data.error, false); assert.equal(h.page.data.configError, true);
 const wait = deferred(), slow = pageHarness('mail/my_detail/mail_my_detail.js', route => route === 'mail/view' ? mail : wait.promise);
 slow.page.onLoad({ id: 'order' }); await slow.page.onShow();
 assert.equal(slow.page.data.mail._id, 'order'); assert.equal(slow.page.data.loading, false);
 wait.resolve(config); await tick(); assert.equal(slow.page.data.config.offlineNotice, '线下结算');
});

test('missing ids and null/empty order responses show a terminal state, never endless loading', async () => {
 const missing = pageHarness('mail/my_detail/mail_my_detail.js', () => { throw Error('must not request'); });
 missing.page.onLoad(); await missing.page.onShow();
 assert.equal(missing.calls.length, 0); assert.equal(missing.page.data.loading, false); assert.equal(missing.page.data.notFound, true);
 for (const mail of [null, {}]) {
  const h = pageHarness('mail/my_detail/mail_my_detail.js', route => route === 'mail/view' ? mail : config);
  h.page.onLoad({ id: 'deleted' }); await h.page.onShow();
  assert.equal(h.page.data.loading, false); assert.equal(h.page.data.mail, null); assert.equal(h.page.data.notFound, true);
 }
});

test('legacy invalid history timestamps do not prevent loading the order', async () => {
 const at = Date.UTC(2026, 8, 7, 1, 0);
 const h = pageHarness('mail/my_detail/mail_my_detail.js', route => route === 'operations/config' ? config : {
  _id: 'order', MAIL_HISTORY: [{ at }, { at: String(at) }, { at: 'invalid' }, null, { at: '2026-09-07T01:00:00Z' }]
 });
 h.page.onLoad({ id: 'order' }); await h.page.onShow();
 assert.equal(h.page.data.error, false);
 assert.deepEqual(Array.from(h.page.data.mail.history, x => x.time), ['2026-09-07 09:00:00', '2026-09-07 09:00:00', '时间未知', '2026-09-07 09:00:00']);
});

test('order refresh ignores stale and hidden responses, preserves displayed data on transient failure', async () => {
 const older = deferred(); let mode = 'old';
 const h = pageHarness('mail/my_detail/mail_my_detail.js', route => route === 'operations/config' ? config : mode === 'old' ? older.promise : mode === 'error' ? Promise.reject({ msg: '请重试' }) : { _id: 'new' });
 h.page.onLoad({ id: 'order' }); const first = h.page.onShow(); mode = 'new'; await h.page.load(); older.resolve({ _id: 'old' }); await first;
 assert.equal(h.page.data.mail._id, 'new');
 mode = 'error'; await h.page.load(); assert.equal(h.page.data.mail._id, 'new'); assert.equal(h.page.data.errorMessage, '请重试');
 mode = 'new'; await h.page.load(); assert.equal(h.page.data.error, false);
 const pending = deferred(), hidden = pageHarness('mail/my_detail/mail_my_detail.js', () => pending.promise);
 hidden.page.onLoad({ id: 'order' }); const load = hidden.page.onShow(); hidden.page.onUnload(); const count = hidden.patches.length;
 pending.resolve({ ...config, _id: 'order' }); await load; await tick(); assert.equal(hidden.patches.length, count);
});

test('public detail retries a failed load and refreshes when returning to a visible page', async () => {
 let fail = true;
 const h = pageHarness('mail/detail/mail_detail.js', () => { if (fail) throw { msg: '服务器繁忙' }; return { _id: 'order', MAIL_OBJ: {}, MAIL_STATUS: 0, MAIL_PAYMENT_MODE: 'offline' }; });
 await h.page.onLoad({ id: 'order' }); assert.equal(h.page.data.isLoad, false); assert.equal(h.page.data.errorMessage, '服务器繁忙');
 fail = false; await h.page._loadDetail(); assert.equal(h.page.data.isLoad, true);
 const count = h.calls.length; h.page.onHide(); await h.page.onShow(); assert.equal(h.calls.length, count + 1);
});

function moduleHarness(file, mocks) {
 const module = { exports: {} };
 vm.runInNewContext(read(file), { module, console: quiet, process: { env: {} }, require(request) {
  if (!(request in mocks)) throw Error('Unexpected dependency: ' + request);
  return mocks[request];
 } });
 return module.exports;
}

test('failed collection creation cannot be cached as successful setup; recovery retries in the same instance', async () => {
 let available = false, creates = 0;
 class Base { AppError(msg) { throw Error(msg); } }
 const Service = moduleHarness('cloudfunctions/mcloud/project/crun/service/base_project_service.js', {
  '../../../framework/database/db_util.js': {
   isExistCollection: async name => name !== 'bx_operation_config' || available,
   createCollection: async () => { creates++; return false; }
  }, '../../../framework/utils/util.js': {}, '../../../framework/platform/model/admin_model.js': {}, '../model/news_model.js': {},
  '../../../framework/platform/service/base_service.js': Base
 });
 const service = new Service();
 await assert.rejects(service.initSetup(), /初始化未完成/); await assert.rejects(service.initSetup(), /初始化未完成/); assert.equal(creates, 2);
 available = true; await service.initSetup(); await service.initSetup(); assert.equal(creates, 2);
});

test('concurrent collection creation tolerates a false result only when the collection now exists', async () => {
 let exists = false;
 class Base { AppError(msg) { throw Error(msg); } }
 const Service = moduleHarness('cloudfunctions/mcloud/project/crun/service/base_project_service.js', {
  '../../../framework/database/db_util.js': { isExistCollection: async () => exists, createCollection: async () => { exists = true; return false; } },
  '../../../framework/utils/util.js': {}, '../../../framework/platform/model/admin_model.js': {}, '../model/news_model.js': {},
  '../../../framework/platform/service/base_service.js': Base
 });
 await new Service()._ensureCollection('bx_operation_config');
});

test('unavailable private images do not block text details or leak files to public callers', async () => {
 let calls = 0;
 const media = moduleHarness('cloudfunctions/mcloud/project/crun/service/private_media_service.js', {
  '../../../framework/cloud/cloud_base.js': { getCloud: () => ({ getTempFileURL: async ({ fileList }) => {
   calls++; return { fileList: fileList.filter(x => !x.fileID.includes('missing')).map(x => ({ fileID: x.fileID, tempFileURL: 'https://signed.invalid/valid' })) };
  } }) }, '../../../framework/core/app_error.js': Error
 });
 const own = await media.order({ _id: 'order', MAIL_FORMS: [], MAIL_OBJ: { code: '123', imgUrls: ['cloud://missing'] }, MAIL_DELIVERY_PROOF: { images: ['cloud://valid'] } });
 assert.equal(own.MAIL_OBJ.code, '123'); assert.equal(own.MAIL_MEDIA.pickup.length, 0); assert.equal(own.MAIL_MEDIA.proof.length, 1); assert.match(own.MAIL_MEDIA_ERROR, /图片/);
 const count = calls, publicDto = await media.order({ _id: 'order', MAIL_OBJ: { title: '快递代取' } });
 assert.equal(calls, count); assert.equal(publicDto.MAIL_MEDIA, undefined);
 await assert.rejects(media.urls(['cloud://missing']), /图片/); // Other strict consumers keep their error semantics.
});

test('empty image upload makes no redundant config or cloud storage request', async () => {
 const ops = moduleHarness('miniprogram/projects/crun/biz/operations_biz.js', {
  '../../../helper/cloud_helper.js': { callCloudSumbit: async () => { throw Error('must not call config'); } },
  '../../../comm/biz/passport_biz.js': {}, '../../../comm/biz/admin_biz.js': {}, '../../../lib/tools/md5_lib.js': {}
 });
 assert.equal((await ops.upload([])).length, 0);
});

test('personal layout uses a native safe navigation bar, scoped full-width cards and no negative overlap', () => {
 const json = JSON.parse(read(pages + 'my/index/my_index.json'));
 const wxml = read(pages + 'my/index/my_index.wxml'), css = read(pages + 'my/index/my_index.wxss');
 assert.equal(json.navigationStyle, 'default'); assert.ok(!/class="main\b/.test(wxml));
 assert.match(css, /\.my-page \.my-card\s*\{[^}]*width: 100%/);
 assert.match(css, /\.my-page \.my-profile-copy\s*\{[^}]*min-width: 0/);
 assert.ok(!/margin[^:]*:\s*-\d/.test(css)); assert.match(css, /safe-area-inset-bottom/);
});
