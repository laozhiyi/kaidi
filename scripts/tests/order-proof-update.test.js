'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { fixture } = require('../test-support/operations-fixture.cjs');
const { concurrentTransactions } = require('../test-support/concurrent-transactions.cjs');
const { runMiniProgram } = require('../test-support/miniprogram-module.cjs');
const UI = require('../../miniprogram/projects/crun/biz/mail_ui_biz.js');
const root = path.resolve(__dirname, '../..');
const tick = () => new Promise(resolve => setImmediate(resolve));
const event = index => ({ currentTarget: { dataset: { index } } });
const originalImages = ['cloud://bucket/private-evidence/rider/first.png', 'cloud://bucket/private-evidence/rider/second.png'];

async function delivered() {
 const f = fixture(), id = await f.publish();
 await f.service.acceptMail('rider', id, { requestId: f.req('accept') });
 await f.service.pickupMail('rider', id, { requestId: f.req('pickup') });
 await f.service.deliverMail('rider', id, { requestId: f.req('deliver'), note: '已放到201室门口', images: originalImages });
 return Object.assign(f, { id, mail: () => f.table('mail').get(id) });
}

// Exercise the real controller and image archival checks with an in-memory cloud.
function controller(f, params, actor = 'rider') {
 const state = { texts: 0, downloads: [], saved: [], beforeDownload: null };
 const cloud = {
  getWXContext: () => ({ OPENID: actor }),
  async downloadFile({ fileID }) {
   state.downloads.push(fileID);
   if (state.beforeDownload) await state.beforeDownload();
   return { fileContent: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]) };
  },
  async uploadFile(input) { state.saved.push(input.cloudPath); return { fileID: 'cloud://bucket/' + input.cloudPath }; },
  openapi: { security: {
   async imgSecCheck() { return { errCode: 0 }; },
   async msgSecCheck() { state.texts++; return { errCode: 0, result: { suggest: 'pass' } }; }
  } }
 };
 const checks = runMiniProgram(path.join(root, 'cloudfunctions/mcloud/framework/validate/content_check.js'), {
  Buffer, console: { warn() {} }, require(name) {
   if (name.endsWith('app_error.js')) return Error;
   if (name.endsWith('cloud_base.js')) return { getCloud: () => cloud };
   if (name.endsWith('account_context.js')) return require('../../cloudfunctions/mcloud/framework/core/account_context.js');
   if (name.endsWith('config.js')) return { CLIENT_CHECK_CONTENT: true, ADMIN_CHECK_CONTENT: false };
   if (name === 'crypto') return require('node:crypto');
   throw Error('Unexpected audit dependency ' + name);
  }
 });
 class Base {
  constructor(input) { this.params = input; this._userId = actor; }
  validateData(schema) { return require('../../cloudfunctions/mcloud/framework/validate/data_check.js').check(structuredClone(this.params), schema); }
  AppError(message) { throw Error(message); }
 }
 const Controller = runMiniProgram(path.join(root, 'cloudfunctions/mcloud/project/crun/controller/mail_controller.js'), {
  require(name) {
   if (name.endsWith('base_project_controller.js')) return Base;
   if (name.endsWith('mail_service.js')) return f.load('mail_service.js');
   if (name.endsWith('order_rules.js')) return f.load('order_rules.js');
   if (name.endsWith('operation_store.js')) return f.store;
   if (name.endsWith('content_check.js')) return checks;
   if (name.endsWith('time_util.js')) return { timestamp2Time: String };
   throw Error('Unexpected controller dependency ' + name);
  }
 });
 return { api: new Controller({ id: f.id, requestId: f.req('update'), note: '已放到正确的201室门口', images: originalImages, ...params }), state };
}

async function mount(f, options = {}, actor = 'rider', file = 'my_detail/mail_my_detail') {
 let page, sequence = 0;
 const commands = [], uploads = [], errors = [], choices = [], modals = [], navigation = [], audits = [];
 const ops = {
  get: async (route, params) => route === 'operations/config' ? f.config : f.service.viewMail(actor, params.id),
  async upload(images) { uploads.push(Array.from(images)); return images.map(id => id.startsWith('cloud://') ? id : 'cloud://bucket/private/' + actor + '/replacement.png'); },
  async command(route, params) {
   assert.equal(route, 'mail/update_proof'); commands.push({ route, params });
   const c = controller(f, { ...params, requestId: f.req('client-' + ++sequence) }, actor); audits.push(c.state);
   return c.api.updateDeliveryProof();
  },
  error: error => errors.push(error.message || error.msg)
 };
 const wx = { removeStorageSync() {}, showToast() {}, showModal: options => modals.push(options),
  chooseImage: options => choices.push(options), navigateTo: options => navigation.push(options) };
 runMiniProgram(path.join(root, 'miniprogram/projects/crun/pages/mail/' + file + '.js'), {
  Page: definition => { page = definition; }, wx, console: { error() {} },
  require(name) {
   if (name.includes('mail_ui_biz')) return UI;
   if (name.includes('operations_biz')) return ops;
   if (name.includes('cloud_helper')) return { callCloudSumbit: async (route, params) => ({ data: await ops.get(route, params) }) };
   if (name.includes('project_biz')) return { initPage() {} };
   if (name.includes('passport_biz')) return { loginMustCancelWin: async () => true };
   if (name.includes('order_sync_biz')) return { subscribe: () => () => {} };
   if (name.includes('order_fav_biz')) return { watch: () => ({ refresh() {}, stop() {} }) };
   return {};
  }
 });
 page.data = structuredClone(page.data);
 page.setData = (patch, callback) => { Object.assign(page.data, patch); if (callback) callback(); };
 await page.onLoad({ id: f.id, ...options }); await page.onShow();
 return { page, ops, commands, uploads, errors, choices, modals, navigation, audits };
}

test('rider replaces a wrong photo from the proof card while retaining the other photo and delivery time', async () => {
 const f = await delivered(), before = structuredClone(f.mail()), h = await mount(f), p = h.page;
 assert.equal(p.data.detailUI.canUpdateProof, true); p.bindUpdateProofTap();
 assert.equal(p.data.panel, 'update_proof'); assert.equal(p.data.note, before.MAIL_DELIVERY_PROOF.note);
 assert.deepEqual(Array.from(p.data.images), originalImages);
 assert.match(p.data.imagePreviews[originalImages[0]], /^https:\/\/signed\.invalid\//);
 p.bindRemoveImage(event(0)); p.bindImages();
 assert.equal(h.choices[0].count, 5); h.choices[0].success({ tempFilePaths: ['new-photo.png'] });
 p.bindNote({ detail: { value: '  已放到正确的201室门口，请查收  ' } });
 assert.deepEqual(f.mail(), before, 'draft editing must not change the stored proof');
 await p.bindSubmitPanel();
 const after = f.mail();
 assert.equal(after.MAIL_STATUS, 2); assert.equal(after.MAIL_DELIVERED_TIME, before.MAIL_DELIVERED_TIME);
 assert.equal(after.MAIL_DELIVERY_PROOF.at, before.MAIL_DELIVERY_PROOF.at);
 assert.ok(after.MAIL_DELIVERY_PROOF.updatedAt >= before.MAIL_DELIVERED_TIME);
 assert.equal(after.MAIL_DELIVERY_PROOF.note, '已放到正确的201室门口，请查收');
 assert.equal(after.MAIL_DELIVERY_PROOF.images[0], originalImages[1]);
 assert.match(after.MAIL_DELIVERY_PROOF.images[1], /^cloud:\/\/bucket\/private-evidence\/rider\/[a-f0-9]{64}\.png$/);
 assert.equal(h.audits[0].downloads.length, 1, 'retained evidence needs no new upload or audit');
 const events = [...f.table('order_event').values()].filter(row => row.orderId === f.id);
 assert.deepEqual(events.find(row => row.action === 'deliver').proof, before.MAIL_DELIVERY_PROOF);
 assert.equal(events.at(-1).action, 'update_proof'); assert.deepEqual(events.at(-1).proof, after.MAIL_DELIVERY_PROOF);
 const poster = await f.service.viewMail('poster', f.id);
 assert.equal(UI.detail(poster).history[0].title, '骑手已更新送达凭证');
 assert.equal(UI.detail(poster).canUpdateProof, false);
 assert.ok([...f.table('notification').values()].some(row => row.userId === 'poster' && row.action === 'update_proof' && row.title === '送达凭证已更新'));
 assert.equal((await f.service.viewMail('other', f.id)).MAIL_DELIVERY_PROOF, undefined);
 assert.equal(p.data.panel, ''); assert.ok(p.data.detailUI.proofUpdatedAt); p.onHide();
});

test('only the assigned rider can update an existing proof on a pending receipt order', async () => {
 for (const [actor, status, missing] of [['poster', 2], ['other', 2], ['rider2', 2], ...[0, 1, 3, 4, 9, 99].map(status => ['rider', status]), ['rider', 2, true]]) {
  const f = await delivered(); f.mail().MAIL_STATUS = status; if (missing) delete f.mail().MAIL_DELIVERY_PROOF;
  const before = structuredClone(f.mail()), c = controller(f, {}, actor);
  await assert.rejects(c.api.updateDeliveryProof(), /骑手/);
  await assert.rejects(f.service.updateDeliveryProof(actor, f.id, c.api.params));
  assert.equal(c.state.texts, 0); assert.equal(c.state.downloads.length, 0);
  assert.deepEqual(f.mail(), before);
  assert.equal(UI.detail(await f.service.viewMail(actor, f.id)).canUpdateProof, false);
 }
});

test('proof corrections validate text, photo count and ownership without replacing the saved evidence on failure', async () => {
 const f = await delivered(), before = structuredClone(f.mail());
 const invalid = [{ note: '' }, { note: ' '.repeat(3) }, { note: '字'.repeat(301) }, { images: [] },
  { images: Array(7).fill(originalImages[0]) }, { images: ['https://foreign.invalid/photo.png'] },
  { images: ['cloud://bucket/private/other/photo.png'] },
  { images: ['cloud://bucket/private-evidence/other/photo.png'] },
  { images: ['cloud://bucket/private-evidence/rider/another-orders-photo.png'] }];
 for (const patch of invalid) {
  const c = controller(f, patch); await assert.rejects(c.api.updateDeliveryProof());
  assert.deepEqual(f.mail(), before); assert.equal(c.state.downloads.length, 0);
 }
});

test('a note-only correction reuses the current archived photos', async () => {
 const f = await delivered(), c = controller(f, { note: '已当面交给收件人' });
 await c.api.updateDeliveryProof();
 assert.equal(c.state.downloads.length, 0); assert.equal(c.state.saved.length, 0);
 assert.deepEqual(f.mail().MAIL_DELIVERY_PROOF.images, originalImages);
 assert.equal(f.mail().MAIL_DELIVERY_PROOF.note, '已当面交给收件人');
});

test('correction retries replay once, recover their outcome, and reject changed or cancelled requests', async () => {
 const f = await delivered(), c = controller(f, { images: ['cloud://bucket/private/rider/new.png'] });
 await c.api.updateDeliveryProof();
 const recovery = new (f.load('request_recovery_service.js'))();
 assert.equal((await recovery.recover('rider', { route: 'mail/update_proof', id: f.id, requestId: f.req('update') })).state, 'committed');
 const cancelled = f.req('cancelled-update');
 assert.equal((await recovery.recover('rider', { route: 'mail/update_proof', id: f.id, requestId: cancelled })).state, 'cancelled');
 await assert.rejects(f.service.updateDeliveryProof('rider', f.id, { ...c.api.params, requestId: cancelled }), /已停止/);
 await f.service.finishMail('poster', f.id, { requestId: f.req('confirm') });
 c.api._limitAudit = async () => { throw Error('must replay before audit'); };
 for (let retry = 0; retry < 3; retry++) assert.equal((await c.api.updateDeliveryProof()).id, f.id);
 assert.equal(c.state.downloads.length, 1); assert.equal(c.state.texts, 1);
 assert.equal(f.mail().MAIL_HISTORY.filter(row => row.action === 'update_proof').length, 1);
 c.api.params.note = '不同的说明'; await assert.rejects(c.api.updateDeliveryProof(), /不同内容/);
 assert.equal(f.mail().MAIL_STATUS, 9);
});

test('a receipt confirmed during photo audit prevents the correction from overwriting completed evidence', async () => {
 const f = await delivered(), before = structuredClone(f.mail().MAIL_DELIVERY_PROOF);
 const c = controller(f, { images: ['cloud://bucket/private/rider/new.png'] });
 c.state.beforeDownload = () => f.service.finishMail('poster', f.id, { requestId: f.req('confirm-during-audit') });
 await assert.rejects(c.api.updateDeliveryProof(), /待收货/);
 assert.equal(f.mail().MAIL_STATUS, 9); assert.deepEqual(f.mail().MAIL_DELIVERY_PROOF, before);
 assert.equal(f.mail().MAIL_HISTORY.filter(row => row.action === 'update_proof').length, 0);
});

test('overlapping confirmation and proof correction serialize without reopening a completed order', async () => {
 for (const updateFirst of [false, true]) {
  const f = await delivered(), before = structuredClone(f.mail().MAIL_DELIVERY_PROOF), metrics = concurrentTransactions(f);
  const update = () => f.service.updateDeliveryProof('rider', f.id, { requestId: f.req('racing-update'), note: '已当面交付', images: [originalImages[1]] });
  const confirm = () => f.service.finishMail('poster', f.id, { requestId: f.req('racing-confirm') });
  const results = await Promise.allSettled(updateFirst ? [update(), confirm()] : [confirm(), update()]);
  assert.equal(results[updateFirst ? 1 : 0].status, 'fulfilled'); assert.ok(metrics.maxActive >= 2);
  assert.equal(f.mail().MAIL_STATUS, 9);
  if (results[updateFirst ? 0 : 1].status === 'rejected') assert.deepEqual(f.mail().MAIL_DELIVERY_PROOF, before);
  else assert.equal(f.mail().MAIL_DELIVERY_PROOF.note, '已当面交付');
  const saved = structuredClone(f.mail());
  await assert.rejects(f.service.updateDeliveryProof('rider', f.id, { requestId: f.req('after-confirm'), note: '迟到的修改', images: originalImages }), /待收货/);
  assert.deepEqual(f.mail(), saved);
 }
});

test('cancelling restores the saved proof on reopening, and an incomplete correction never uploads', async () => {
 const f = await delivered(), before = structuredClone(f.mail()), h = await mount(f, { panel: 'update_proof' }), p = h.page;
 p.bindNote({ detail: { value: '未保存的修改' } }); p.bindRemoveImage(event(0)); p.bindClosePanel();
 assert.equal(p.data.panel, ''); assert.deepEqual(f.mail(), before); p.bindUpdateProofTap();
 assert.equal(p.data.note, before.MAIL_DELIVERY_PROOF.note); assert.deepEqual(Array.from(p.data.images), originalImages);
 p.setData({ note: '   ' }); await p.bindSubmitPanel(); p.setData({ note: '正确位置', images: [] }); await p.bindSubmitPanel();
 assert.deepEqual(h.errors, ['请填写说明', '请至少上传1张送达照片']);
 assert.equal(h.uploads.length, 0); assert.equal(h.commands.length, 0); p.onHide();
});

test('failed correction uploads retain the draft and repeated save taps produce one successful retry', async () => {
 const f = await delivered(), before = structuredClone(f.mail()), h = await mount(f, { panel: 'update_proof' }), p = h.page;
 p.setData({ note: '新的位置说明', images: ['new-photo.png'] });
 const upload = h.ops.upload; h.ops.upload = async () => { throw Error('照片上传失败'); };
 await p.bindSubmitPanel();
 assert.deepEqual(f.mail(), before); assert.equal(p.data.panel, 'update_proof'); assert.equal(p.data.busy, false);
 assert.equal(p.data.note, '新的位置说明'); assert.equal(p.data.images[0], 'new-photo.png'); assert.equal(h.errors[0], '照片上传失败');
 let release; h.ops.upload = async images => { await new Promise(resolve => { release = resolve; }); return upload(images); };
 const retry = p.bindSubmitPanel(); await tick(); await p.bindSubmitPanel();
 p.bindClosePanel(); p.bindRemoveImage(event(0)); p.bindNote({ detail: { value: '忙碌时的输入' } });
 assert.equal(p.data.panel, 'update_proof'); assert.equal(p.data.note, '新的位置说明'); assert.equal(p.data.images.length, 1);
 release(); await retry;
 assert.equal(h.uploads.length, 1); assert.equal(h.commands.length, 1); assert.equal(p.data.panel, '');
 assert.equal(f.mail().MAIL_DELIVERY_PROOF.note, '新的位置说明'); p.onHide();
});

test('stale correction pages close after receipt confirmation and cannot update while hidden or failed', async () => {
 const f = await delivered(), h = await mount(f), p = h.page;
 p.setData({ error: true }); p.bindUpdateProofTap(); assert.equal(p.data.panel, '');
 p.setData({ error: false }); p.onHide(); p.bindUpdateProofTap(); await p.perform('update_proof');
 assert.equal(p.data.panel, ''); assert.equal(h.commands.length, 0);
 await p.onShow(); p.bindUpdateProofTap();
 await f.service.finishMail('poster', f.id, { requestId: f.req('confirm-stale-page') });
 const saved = structuredClone(f.mail().MAIL_DELIVERY_PROOF); await p.bindSubmitPanel();
 assert.match(h.errors.at(-1), /待收货/); assert.equal(p.data.panel, ''); assert.equal(p.data.detailUI.canUpdateProof, false);
 assert.deepEqual(f.mail().MAIL_DELIVERY_PROOF, saved); p.onHide();
});

test('both detail entry points allow the rider to update, and stale links or other roles cannot open the editor', async () => {
 const f = await delivered(), publicDetail = await mount(f, {}, 'rider', 'detail/mail_detail');
 publicDetail.page.bindUpdateProofTap();
 assert.equal(publicDetail.navigation[0].url, '../my_detail/mail_my_detail?id=' + f.id + '&panel=update_proof');
 publicDetail.page.onHide();
 for (const [actor, status] of [['poster', 2], ['other', 2], ['rider', 4], ['rider', 3], ['rider', 9], ['rider', 99]]) {
  f.mail().MAIL_STATUS = status;
  const h = await mount(f, { panel: 'update_proof' }, actor);
  assert.equal(h.page.data.panel, ''); assert.equal(h.modals[0].title, '暂不能更新凭证');
  h.page.bindUpdateProofTap(); await h.page.perform('update_proof'); assert.equal(h.commands.length, 0); h.page.onHide();
 }
});

test('missing signed previews preserve photo identities so the rider can replace unavailable photos', async () => {
 const f = await delivered(), h = await mount(f), p = h.page;
 p.data.mail.MAIL_MEDIA.proof = []; p.bindUpdateProofTap();
 assert.deepEqual(Array.from(p.data.images), originalImages);
 assert.equal(p.data.imagePreviews[originalImages[0]], '');
 p.bindRemoveImage(event(0)); assert.equal(p.data.images[0], originalImages[1]); p.onHide();
});
