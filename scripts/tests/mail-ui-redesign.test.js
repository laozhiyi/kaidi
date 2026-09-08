'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const UI = require('../../miniprogram/projects/crun/biz/mail_ui_biz.js');
const { fixture } = require('../test-support/operations-fixture.cjs');
const root = path.resolve(__dirname, '../..');
const now = Date.parse('2026-09-07T10:00:00+08:00');
const base = { _id: 'order', MAIL_ID: 'KD20260907001', MAIL_STATUS: 0, MAIL_PAYMENT_MODE: 'offline', MAIL_END_TIME: now + 3600000,
 MAIL_ADD_TIME: now, MAIL_OBJ: { title: '快递代取', small: 2, medium: 1, large: 0, price: 6, code: '123-456', tel: '13800000000', poster: '小林' } };
function page(file, extraOps = {}, extraWx = {}, extraHelper = {}) {
 let result;
 vm.runInNewContext(fs.readFileSync(path.join(root, 'miniprogram/projects/crun/pages/mail', file), 'utf8'), { console, Page: p => result = p,
  wx: extraWx, require(request) {
   if (request.includes('mail_ui_biz')) return UI;
   if (request.includes('content_check_helper')) return { imgTypeCheck: () => true, imgSizeCheck: () => true };
   if (request.includes('operations_biz')) return { get: async () => ({ paymentMode: 'offline' }), ...extraOps };
   if (request.includes('cloud_helper')) return { callCloudSumbit: async () => ({ data: base }) };
   if (request.includes('passport_biz')) return { loginMustCancelWin: async () => true };
   if (request.includes('project_biz')) return { initPage() {} };
   if (request.includes('page_helper')) return { fmtURLByPID: p => p, ...extraHelper };
   return {};
  } });
 result.data = structuredClone(result.data);
 result.setData = patch => { for (const [key, val] of Object.entries(patch)) { const parts = key.split('.'); let target = result.data; for (const part of parts.slice(0, -1)) target = target[part] ||= {}; target[parts.at(-1)] = val; } };
 return result;
}
test('absent operations config opens the default service, but saved false or malformed settings stay paused', async () => {
 const f = fixture(), Service = f.load('operation_config_service.js'), service = new Service(), id = f.store.key('crun', 'config');
 f.table('operation_config').delete(id);
 let config = await service.getConfig(); assert.equal(config.enabled, true); assert.equal(config.configured, false); assert.equal(config.openHour, 8); assert.equal(config.closeHour, 22);
 for (const value of [{ enabled: false }, {}, null, { enabled: 'true' }, { enabled: 1 }]) {
  f.table('operation_config').set(id, { value }); config = await service.getConfig(); assert.equal(config.enabled, false); assert.equal(config.configured, true);
 }
 f.table('operation_config').set(id, { value: { enabled: true, smallPrice: 2 } }); config = await service.getConfig(); assert.equal(config.enabled, true); assert.equal(config.smallPrice, 2);
});
test('operations config read errors do not silently enable service or return local defaults', async () => {
 const f = fixture(), Service = f.load('operation_config_service.js'); f.store.get = async () => { throw Error('database unavailable'); };
 await assert.rejects(new Service().getConfig(), /database unavailable/);
});
test('saved pause continues to block both server publishing and accepting without stopping existing fulfillment', async () => {
 const f = fixture(), id = await f.publish(); f.config.enabled = false;
 await assert.rejects(f.service.acceptMail('rider', id, { requestId: f.req('accept') }), /暂停/);
 await assert.rejects(f.publish({ requestId: f.req('second') }), /暂停/);
 assert.equal(f.table('mail').get(id).MAIL_STATUS, 0);
 const g = fixture(), active = await g.publish(); await g.service.acceptMail('rider', active, { requestId: g.req('take') }); g.config.enabled = false;
 await g.service.deliverMail('rider', active, { requestId: g.req('deliver'), note: '已送达', images: ['cloud://proof'] }); assert.equal(g.table('mail').get(active).MAIL_STATUS, 2);
});
test('service badge distinguishes loading and administrator pause without business-hour blocking', () => {
 const config = { enabled: true, openHour: 8, closeHour: 22 };
 assert.equal(UI.service(null, now).kind, 'loading');
 for (const time of ['07:59:59', '08:00:00', '21:59:59', '22:00:00']) {
    const state = UI.service(config, Date.parse('2026-09-07T' + time + '+08:00')); assert.equal(state.kind, 'open'); assert.equal(state.canPublish, true); assert.equal(state.hours, '08:00–22:00');
 }
 assert.equal(UI.service({ ...config, enabled: false }, now).kind, 'paused');
 assert.equal(UI.service({ enabled: true, openHour: 0, closeHour: 24 }, now).canPublish, true);
});
test('detail presentation calculates fees, package tags and safe Beijing times', () => {
 const ui = UI.detail(base, now); assert.equal(ui.fee, '6.00'); assert.equal(ui.count, 3); assert.equal(ui.packages.length, 2); assert.equal(ui.createdAt, '2026-09-07 10:00');
 assert.equal(UI.detail({ ...base, MAIL_OBJ: {}, MAIL_TOTAL_FEE: 150 }, now).fee, '1.50');
 assert.equal(UI.detail({ ...base, MAIL_OBJ: { price: 'bad' } }, now).fee, '—');
 assert.equal(UI.time('invalid'), ''); assert.equal(UI.time(String(now)), '2026-09-07 10:00');
 assert.equal(UI.detail({ ...base, MAIL_STATUS: null }, now).step, -1);
 assert.equal(UI.detail({ ...base, MAIL_PAYMENT_MODE: 'wechat' }, now).legacyPayment, true);
});
test('detail primary actions depend on actual order role and status, never on page entry', () => {
 const cases = [[0, 'poster', 'edit'], [1, 'rider', 'deliver'], [2, 'poster', 'confirm'], [2, 'rider', 'contact'], [3, 'rider', 'contact'], [9, 'poster', 'contact'], [99, 'public', 'orders']];
 for (const [status, role, action] of cases) {
  const mail = { ...base, MAIL_STATUS: status, mypost: role === 'poster', myaccept: role === 'rider', acceptUser: { USER_NAME: '小陈', USER_MOBILE: '13900000000' } };
  const ui = UI.detail(mail, now); assert.equal(ui.primary, action); assert.equal(ui.canCancel, role === 'poster' && status === 0); assert.equal(ui.canException, role !== 'public' && [1,2].includes(status));
 }
 const expired = UI.detail({ ...base, mypost: true, MAIL_END_TIME: now - 1 }, now); assert.equal(expired.expired, true); assert.equal(expired.step, -1); assert.notEqual(expired.primary, 'edit');
});
test('public presentation never projects contact or event history, even if a malformed DTO includes it', () => {
 const mail = { ...base, MAIL_HISTORY: [{ actor: 'poster', action: 'publish', note: 'private', at: now }] };
 const ui = UI.detail(mail, now); assert.equal(ui.phone, ''); assert.equal(ui.history.length, 0); assert.equal(ui.participant, false);
 const own = UI.detail({ ...mail, mypost: true, MAIL_HISTORY: [null, ...mail.MAIL_HISTORY, { action: 'accept', at: 'bad', actor: 'rider' }] }, now);
 assert.equal(own.history.length, 2); assert.equal(own.history[0].title, '骑手已接单'); assert.equal(own.history[0].time, '时间待确认');
});
test('shared detail template handlers are implemented in both page controllers', () => {
 const template = fs.readFileSync(path.join(root, 'miniprogram/projects/crun/pages/mail/tpl/mail_detail_tpl.wxml'), 'utf8');
 for (const name of ['my_detail/mail_my_detail.js', 'detail/mail_detail.js']) {
  const p = page(name); for (const match of template.matchAll(/(?:bind|catch):?[\w-]+\s*=\s*"([\w]+)"/g)) assert.equal(typeof p[match[1]], 'function', name + ':' + match[1]);
 }
 assert.match(template, /ui.participant && mail.MAIL_DELIVERY_PROOF/); assert.match(template, /ui.participant && mail.MAIL_EXCEPTION/);
});
test('participant primary button delegates to edit, delivery sheet or explicit confirmation, and honors busy/error', async () => {
 const p = page('my_detail/mail_my_detail.js'), calls = []; p.setData({ mail: base, loading: false });
 p.bindEditTap = () => calls.push('edit'); p.bindPanel = e => calls.push(e.currentTarget.dataset.action); p.bindConfirm = e => calls.push(e.currentTarget.dataset.action); p.bindCallTap = () => calls.push('contact'); p.bindBackOrders = () => calls.push('orders');
 for (const primary of ['edit', 'deliver', 'confirm', 'contact', 'orders']) { p.setData({ detailUI: { primary } }); await p.bindPrimaryAction(); }
 assert.deepEqual(calls, ['edit', 'deliver', 'confirm', 'contact', 'orders']);
 p.setData({ busy: true }); p.bindPrimaryAction(); p.setData({ busy: false, error: true }); p.bindPrimaryAction(); assert.equal(calls.length, 5);
});
test('more menu filters mutations by role/state, and cancellation is never performed without confirmation', async () => {
 let sheet, modal, commands = 0;
 const p = page('my_detail/mail_my_detail.js', { command: async () => commands++ }, { showActionSheet: p => sheet = p, showModal: p => { modal = p; p.success({ confirm: false }); } });
 p.setData({ mail: base, loading: false, detailUI: UI.detail({ ...base, mypost: true }, now) });
 p.bindMoreTap(); assert.ok(sheet.itemList.includes('取消订单')); assert.ok(!sheet.itemList.includes('配送异常 / 申请取消'));
 sheet.success({ tapIndex: 0 }); await new Promise(resolve => setImmediate(resolve)); assert.ok(modal.title.includes('取消')); assert.equal(commands, 0);
 p.setData({ detailUI: UI.detail({ ...base, myaccept: true, MAIL_STATUS: 1 }, now) }); p.bindMoreTap(); assert.ok(sheet.itemList.includes('配送异常 / 申请取消')); assert.ok(!sheet.itemList.includes('取消订单'));
 p.setData({ detailUI: UI.detail(base, now) }); sheet = null; p.bindMoreTap(); assert.equal(sheet, null);
});
test('delivery sheet requires a note and a photo, ignores unsupported actions and caps attachments at six', async () => {
 const errors = [], p = page('my_detail/mail_my_detail.js', { error: e => errors.push(e.message) }, { chooseImage: () => { throw Error('already full'); } });
 p.setData({ loading: false, detailUI: UI.detail({ ...base, myaccept: true, MAIL_STATUS: 1 }, now) });
 p.bindPanel({ currentTarget: { dataset: { action: 'cancel' } } }); assert.equal(p.data.panel, '');
 p.bindPanel({ currentTarget: { dataset: { action: 'deliver' } } }); assert.equal(p.data.panel, 'deliver');
 await p.bindSubmitPanel(); p.setData({ note: '放在门口' }); await p.bindSubmitPanel(); assert.equal(errors.length, 2); assert.match(errors[1], /照片/);
 p.setData({ images: ['a','b','c','d','e','f'] }); p.bindImages(); assert.equal(p.data.images.length, 6);
});
test('participant contact uses the other party and image previews stay in the authorized group', () => {
 const calls = [], previews = [];
 for (const file of ['my_detail/mail_my_detail.js', 'detail/mail_detail.js']) {
  const p = page(file, {}, { makePhoneCall: x => calls.push(x.phoneNumber), previewImage: x => previews.push(x) });
  p.setData({ detailUI: UI.detail({ ...base, mypost: true, acceptUser: { USER_MOBILE: '13900000000' } }, now), mail: { ...base, mypost: true, canSeeCode: true, MAIL_MEDIA: { proof: ['signed-a', 'signed-b'] } } });
  p.bindCallTap(); p.bindPreviewImageTap({ currentTarget: { dataset: { group: 'proof', url: 'signed-b' } } });
  p.bindPreviewImageTap({ currentTarget: { dataset: { group: 'proof', url: 'untrusted' } } });
  p.setData({ detailUI: UI.detail(base, now), mail: base }); p.bindCallTap();
 }
 assert.deepEqual(calls, ['13900000000','13900000000']); assert.equal(previews.length, 2); assert.equal(previews[0].urls.length, 2);
});
test('public accepting locks before confirmation, avoids repeat requests and exposes reactive button state', async () => {
 let release, commands = 0; const redirects = [];
 const p = page('detail/mail_detail.js', { command: async () => { commands++; return { id: 'order' }; } }, { showLoading() {}, hideLoading() {}, redirectTo: x => redirects.push(x) }, { showConfirm: () => new Promise(r => release = r), showSuccToast() {} });
 p._visible = true; p.setData({ isLoad: true, mail: { ...base, canAccept: true } });
 const pending = p.bindAcceptTap(); await new Promise(resolve => setImmediate(resolve)); assert.equal(p.data.accepting, true);
 await p.bindAcceptTap(); release(true); await pending;
 assert.equal(commands, 1); assert.equal(p.data.accepting, false); assert.equal(p.data.mail.canAccept, false); assert.equal(redirects.length, 1);
});

test('publish screenshot selection and hidden form both cap attachments at six', () => {
 let request, images;
 const p = page('add/mail_add.js', {}, { chooseMedia: x => request = x });
 p.setData({ proofImages: ['a','b','c','d','e'] }); p._setFormVal = (key,value) => { if (key === 'img') images = value; };
 p.bindUploadImageTap(); assert.equal(request.count, 1);
 request.success({ tempFiles: [{tempFilePath:'f',size:100},{tempFilePath:'g',size:100}] });
 assert.equal(p.data.proofImages.length, 6); assert.equal(images.length, 6);
});
test('order command locks before async login/upload and refuses actions not allowed in the displayed state', async () => {
 let release, commands = 0, uploads = 0;
 const p = page('my_detail/mail_my_detail.js', { upload: async () => { uploads++; await new Promise(r => release = r); return ['cloud://proof']; }, command: async () => commands++ }, { showToast() {} });
 p._visible = true; p.load = async () => {};
 p.setData({ loading: false, mail: base, id: 'order', panel: 'deliver', note: '已送达', images: ['local'], detailUI: UI.detail({ ...base, myaccept: true, MAIL_STATUS: 1 }, now) });
 await p.perform('confirm'); assert.equal(commands, 0);
 const pending = p.perform('deliver'); await p.perform('deliver'); await new Promise(resolve => setImmediate(resolve));
 assert.equal(uploads, 1); assert.equal(p.data.busy, true); release(); await pending; assert.equal(commands, 1); assert.equal(p.data.busy, false);
});
