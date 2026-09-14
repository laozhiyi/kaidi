'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { runMiniProgram } = require('../test-support/miniprogram-module.cjs');
const MailUI = require('../../miniprogram/projects/crun/biz/mail_ui_biz.js');
const tick = () => new Promise(resolve => setImmediate(resolve));
const event = id => ({ currentTarget: { dataset: { id } } });
const delivered = { _id: 'receipt-order', MAIL_STATUS: 2, MAIL_PAYMENT_MODE: 'offline', mypost: true, myaccept: false, MAIL_OBJ: { title: '快递代取', price: 3 } };

function harness(initial = delivered) {
 let mail = structuredClone(initial), timerId = 0;
 const navigation = [], modals = [], commands = [], removed = [], errors = [], toasts = [], timers = new Map();
 const ops = {
  get: async route => route === 'operations/config' ? { paymentMode: 'offline' } : structuredClone(mail),
  command: async (route, params) => { commands.push({ route, params: structuredClone(params) }); mail = { ...mail, MAIL_STATUS: 9 }; return { id: mail._id }; },
  error: error => errors.push(error),
 };
 const wx = {
  navigateTo: options => navigation.push(options), showModal: options => modals.push(options), showToast: options => toasts.push(options),
  getStorageSync() {}, removeStorageSync: key => removed.push(key),
 };
 function mount(file, options) {
  let page;
  runMiniProgram(path.join(__dirname, '../../miniprogram/projects/crun/pages', file + '.js'), {
   Page: value => { page = value; }, wx, console: { error() {} },
   setInterval(fn) { const id = ++timerId; timers.set(id, fn); return id; }, clearInterval: id => timers.delete(id),
   require(name) {
    if (name.includes('mail_ui_biz')) return MailUI;
    if (name.includes('operations_biz')) return ops;
    if (name.includes('project_biz')) return { initPage() {} };
    if (name.includes('passport_biz')) return { getUserId: () => 'poster', loginMustCancelWin: async () => true };
    if (name.includes('order_sync_biz')) return { subscribe: () => () => {} };
    if (name.includes('page_helper')) return { fmtURLByPID: url => '/projects/crun' + url };
    return {};
   },
  });
  page.data = structuredClone(page.data);
  page.setData = (patch, callback) => { Object.assign(page.data, patch); if (callback) callback(); };
  page.selectComponent = () => null;
  page.onLoad(options);
  return page;
 }
 return { mount, ops, navigation, modals, commands, removed, errors, toasts, timers,
  setMail(value) { mail = structuredClone(value); },
  advance(seconds) { for (let i = 0; i < seconds; i++) for (const fn of [...timers.values()]) fn(); },
 };
}

test('posted receipt entry checks ownership and closed orders, prevents duplicate navigation, and recovers from navigation failure', () => {
 const h = harness(), page = h.mount('order/index/order_index', { tab: 2 }); page.onShow();
 for (const patch of [9, 99].map(MAIL_STATUS => ({ MAIL_STATUS })).concat([{ mypost: false }])) {
  page.setData({ dataList: { list: [{ ...delivered, ...patch }] } }); page.bindConfirmReceiptTap(event(delivered._id));
 }
 page.setData({ dataList: { list: [delivered] } });
 for (const tabIndex of [1, 3]) { page.setData({ tabIndex }); page.bindConfirmReceiptTap(event(delivered._id)); }
 page.setData({ tabIndex: 2 }); page.bindConfirmReceiptTap(event('missing'));
 page.onHide(); page.bindConfirmReceiptTap(event(delivered._id));
 assert.equal(h.navigation.length, 0);
 page.onShow(); page.bindConfirmReceiptTap(event(delivered._id)); page.bindConfirmReceiptTap(event(delivered._id));
 assert.equal(h.navigation.length, 1); assert.equal(page.data.confirmingId, delivered._id);
 assert.match(h.navigation[0].url, /mail_my_detail\?id=receipt-order&action=confirm$/);
 h.navigation[0].fail(new Error('navigation failed')); h.navigation[0].complete();
 assert.equal(h.errors.length, 1); assert.equal(page.data.confirmingId, '');
 page.bindConfirmReceiptTap(event(delivered._id)); assert.equal(h.navigation.length, 2);
 h.navigation[1].complete(); page.onHide();
});

test('pending posted orders retain the receipt entry and explain availability in their details', async () => {
 for (const status of [0, 1, 3, 4]) {
  const order = { ...delivered, MAIL_STATUS: status }, h = harness(order);
  const list = h.mount('order/index/order_index', { tab: 2 }); list.onShow();
  list.bindCommListCmpt({ detail: { dataList: { list: [order], total: 1 } } });
  assert.equal(list.data.dataList.list[0].receipt.visible, true);
  assert.equal(list.data.dataList.list[0].receipt.canConfirm, false);
  list.bindConfirmReceiptTap(event(order._id)); assert.equal(h.navigation.length, 1);
  const options = Object.fromEntries(new URL(h.navigation[0].url, 'https://local.test').searchParams);
  const detail = h.mount('mail/my_detail/mail_my_detail', options); await detail.onShow();
  assert.equal(detail.data.detailUI.receipt.visible, true);
  assert.equal(h.modals.length, 1); assert.equal(h.modals[0].title, '暂不能确认收货');
  assert.equal(h.modals[0].content, list.data.dataList.list[0].receipt.hint);
  assert.equal(h.modals[0].showCancel, false); assert.equal(detail.data.confirmGate, false);
  if (status === 0) assert.equal(detail.data.detailUI.primary, 'edit', 'pending orders must retain editing');
  await detail.bindGateConfirm(); assert.equal(h.commands.length, 0); detail.onHide(); list.onHide();
 }
});

test('posted receipt entry retains both confirmations, submits once, clears caches, and refreshes the posted list on return', async () => {
 const h = harness(), list = h.mount('order/index/order_index', { tab: 2 }); list.onShow();
 list.bindCommListCmpt({ detail: { type: 'order-mail-posted', dataList: { list: [delivered], total: 1 } } });
 list.bindConfirmReceiptTap(event(delivered._id)); h.navigation[0].complete(); list.onHide();
 const options = Object.fromEntries(new URL(h.navigation[0].url, 'https://local.test').searchParams);
 const detail = h.mount('mail/my_detail/mail_my_detail', options); await detail.onShow();
 assert.equal(h.modals.length, 1); assert.equal(h.modals[0].title, '确认收货'); assert.equal(h.commands.length, 0);
 h.modals[0].success({ confirm: true }); await tick();
 assert.equal(detail.data.confirmGate, true); assert.equal(detail.data.confirmCountdown, 5);
 h.advance(4); await detail.bindGateConfirm(); assert.equal(h.commands.length, 0);
 h.advance(1);
 const finish = detail.bindGateConfirm(); await detail.bindGateConfirm(); await finish;
 assert.deepEqual(h.commands, [{ route: 'mail/finish', params: { id: delivered._id } }]);
 assert.equal(detail.data.mail.MAIL_STATUS, 9); assert.equal(detail.data.busy, false); assert.equal(h.timers.size, 0);
 for (const type of ['take', 'mine', 'posted', 'done']) assert.ok(h.removed.includes('ORDER-MAIL-' + type.toUpperCase() + '_LIST'));
 assert.equal(h.modals.length, 1, 'refresh after completion must not reopen confirmation');
 let refreshes = 0;
 list.selectComponent = () => ({ refresh: async () => { refreshes++; list.bindCommListCmpt({ detail: { dataList: { list: [], total: 0 } } }); } });
 detail.onHide(); list.onShow(); await tick();
 assert.equal(refreshes, 1); assert.equal(list.data.dataList.total, 0); list.onHide();
});

test('fresh order data blocks receipt confirmation for a changed status or a different viewer', async () => {
 for (const patch of [0, 1, 3, 4, 9, 99].map(MAIL_STATUS => ({ MAIL_STATUS })).concat([{ mypost: false, myaccept: true }, { mypost: false }])) {
  const h = harness({ ...delivered, ...patch });
  const page = h.mount('mail/my_detail/mail_my_detail', { id: delivered._id, action: 'confirm' }); await page.onShow();
  assert.equal(h.modals.length, 1); assert.equal(h.modals[0].title, '暂不能确认收货'); assert.equal(h.modals[0].showCancel, false);
  assert.equal(h.commands.length, 0); assert.equal(page.data.confirmGate, false); page.onHide();
 }
});

test('cancelling either confirmation or hiding the detail prevents receipt submission', async () => {
 for (const stage of ['modal-cancel', 'gate-cancel', 'hidden-modal', 'hidden-gate']) {
  const h = harness(), page = h.mount('mail/my_detail/mail_my_detail', { id: delivered._id, action: 'confirm' }); await page.onShow();
  if (stage === 'hidden-modal') page.onHide();
  h.modals[0].success({ confirm: stage !== 'modal-cancel' }); await tick();
  if (stage === 'gate-cancel') page.bindGateCancel();
  if (stage === 'hidden-gate') page.onHide();
  h.advance(5); await page.bindGateConfirm();
  assert.equal(h.commands.length, 0, stage); assert.equal(h.timers.size, 0, stage);
  assert.equal(page.data.confirmGate, false, stage);
  if (stage === 'modal-cancel') { await page.load(); assert.equal(h.modals.length, 1); }
  page.onHide();
 }
});

test('failed or background detail loads cannot open a receipt modal, and a visible retry can recover', async () => {
 const h = harness(), get = h.ops.get;
 h.ops.get = async route => { if (route === 'mail/view') throw new Error('offline'); return get(route); };
 const page = h.mount('mail/my_detail/mail_my_detail', { id: delivered._id, action: 'confirm' }); await page.onShow();
 assert.equal(page.data.error, true); assert.equal(h.modals.length, 0);
 let resolve;
 h.ops.get = route => route === 'mail/view' ? new Promise(done => { resolve = done; }) : get(route);
 const pending = page.load(); page.onHide(); resolve(structuredClone(delivered)); await pending;
 assert.equal(h.modals.length, 0);
 h.ops.get = get; await page.onShow(); assert.equal(h.modals.length, 1);
 h.modals[0].success({ confirm: false }); await tick(); page.onHide();
});

test('a rejected receipt keeps lists intact and reloads the latest order state', async () => {
 const h = harness(), page = h.mount('mail/my_detail/mail_my_detail', { id: delivered._id, action: 'confirm' }); await page.onShow();
 h.modals[0].success({ confirm: true }); await tick(); h.advance(5);
 h.setMail({ ...delivered, MAIL_STATUS: 3 }); h.ops.command = async () => { throw new Error('订单状态已变化'); };
 await page.bindGateConfirm();
 assert.equal(h.errors.length, 1); assert.equal(h.toasts.length, 0); assert.equal(h.removed.length, 0);
 assert.equal(page.data.mail.MAIL_STATUS, 3); assert.equal(page.data.busy, false); assert.notEqual(page.data.detailUI.primary, 'confirm'); page.onHide();
});

test('ordinary detail visits and existing delivery links do not trigger receipt confirmation', async () => {
 for (const action of [undefined, 'cancel', 'finish']) {
  const h = harness(), page = h.mount('mail/my_detail/mail_my_detail', { id: delivered._id, action }); await page.onShow();
  assert.equal(h.modals.length, 0); assert.equal(h.commands.length, 0); page.onHide();
 }
 const h = harness({ ...delivered, MAIL_STATUS: 4, mypost: false, myaccept: true });
 const page = h.mount('mail/my_detail/mail_my_detail', { id: delivered._id, panel: 'deliver' }); await page.onShow();
 assert.equal(page.data.panel, 'deliver'); assert.equal(h.modals.length, 0); page.onHide();
});
