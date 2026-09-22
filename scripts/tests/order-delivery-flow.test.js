'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { fixture } = require('../test-support/operations-fixture.cjs');
const { runMiniProgram } = require('../test-support/miniprogram-module.cjs');
const UI = require('../../miniprogram/projects/crun/biz/mail_ui_biz.js');
const tick = () => new Promise(resolve => setImmediate(resolve));
const event = (id, action) => ({ currentTarget: { dataset: { id, action } } });
const labels = ['已发布', '已接单', '已取件', '已送达', '已完成'];

async function harness(pickedUp = false) {
 const f = fixture(), forms = f.forms();
 forms.find(field => field.mark === 'address1').val = '二期 · 中通';
 forms.find(field => field.mark === 'address2').val = '五期 3栋201室（东侧楼梯入口）';
 const id = await f.publish({ forms });
 await f.service.acceptMail('rider', id, { requestId: f.req('accept') });
 if (pickedUp) await f.service.pickupMail('rider', id, { requestId: f.req('pickup') });
 let sequence = 0, actor = 'rider';
 const modals = [], navigation = [], commands = [], uploads = [], errors = [];
 const ops = {
  get: async (route, params) => route === 'operations/config' ? f.config : f.service.viewMail(actor, params.id),
  async command(route, params) {
   commands.push({ route, params: structuredClone(params) });
   const method = { 'mail/pickup': 'pickupMail', 'mail/deliver': 'deliverMail' }[route];
   assert.ok(method, route);
   return f.service[method](actor, params.id, { ...params, requestId: f.req('ui-' + ++sequence) });
  },
  async upload(paths) { uploads.push(Array.from(paths)); return paths.map((_, index) => 'cloud://delivery/proof-' + index); },
  error: error => errors.push(error.message || error.msg),
 };
 const wx = {
  showModal: options => modals.push(options), navigateTo: options => navigation.push(options),
  getStorageSync() {}, removeStorageSync() {}, showToast() {},
 };
 function mount(file, options) {
  let page;
  runMiniProgram(path.join(__dirname, '../../miniprogram/projects/crun/pages', file + '.js'), {
   Page: value => { page = value; }, wx, console: { error() {} },
   require(name) {
    if (name.includes('mail_ui_biz')) return UI;
    if (name.includes('operations_biz')) return ops;
    if (name.includes('project_biz')) return { initPage() {} };
    if (name.includes('passport_biz')) return { getUserId: () => actor, loginMustCancelWin: async () => true };
    if (name.includes('public_biz')) return { removeCacheList() {} };
    if (name.includes('order_sync_biz')) return { subscribe: () => () => {} };
    if (name.includes('order_fav_biz')) return { watch: () => ({ refresh() {}, stop() {} }) };
    if (name.includes('page_helper')) return {
     fmtURLByPID: url => '/projects/crun' + url, showSuccToast() {},
     showConfirm: content => new Promise(resolve => wx.showModal({ content, success: result => resolve(!!result.confirm) })),
    };
    return {};
   },
  });
  page.data = structuredClone(page.data);
  page.setData = (patch, callback) => { Object.assign(page.data, patch); if (callback) callback(); };
  page.selectComponent = () => ({ async refresh() {
   const sortType = ['wait', 'my_accept', 'my_post', 'my_done'][page.data.tabIndex];
   const dataList = await f.service.getMailList(actor, { sortType });
   page.bindCommListCmpt({ detail: { dataList } });
   return { ok: true };
  } });
  page.onLoad(options);
  return page;
 }
 return { f, id, ops, mount, modals, navigation, commands, uploads, errors,
  setActor(value) { actor = value; }, confirm(value = true) { modals.at(-1).success({ confirm: value }); },
  stored: () => f.table('mail').get(id),
 };
}

test('card pickup advances to delivery; delivery navigates to details and changes state only after text and photos are submitted', async () => {
 const h = await harness(), list = h.mount('order/index/order_index', { tab: 1 });
 list.onShow(); await list._syncOrders();
 assert.equal(list.data.dataList.list[0].progressStep, 1);
 await list.bindOrderAction(event(h.id, 'deliver'));
 assert.equal(h.modals.length, 0, 'delivery cannot skip pickup');
 const pickup = list.bindOrderAction(event(h.id, 'pickup'));
 await list.bindOrderAction(event(h.id, 'pickup'));
 assert.equal(h.modals.length, 1); h.confirm(); await pickup;
 assert.equal(h.stored().MAIL_STATUS, 4);
 const card = list.data.dataList.list[0];
 assert.equal(card.progressStep, 2); assert.deepEqual(Array.from(card.progressLabels), labels);
 assert.equal(card.deliveryAddress, '育才校区 · 五期 3栋201室（东侧楼梯入口）');

 const delivery = list.bindOrderAction(event(h.id, 'deliver'));
 assert.match(h.modals.at(-1).content, /订单详情.*说明.*照片/);
 assert.equal(h.navigation.length, 0); h.confirm(); await tick();
 assert.equal(h.navigation.length, 1);
 assert.match(h.navigation[0].url, /mail_my_detail\?id=.+&panel=deliver$/);
 await list.bindOrderAction(event(h.id, 'deliver'));
 assert.equal(h.modals.length, 2, 'navigation remains locked until it completes');
 h.navigation[0].success({}); await delivery; list.onHide();
 assert.equal(h.stored().MAIL_STATUS, 4); assert.equal(h.commands.length, 1); assert.equal(h.uploads.length, 0);

 const options = Object.fromEntries(new URL(h.navigation[0].url, 'https://local.test').searchParams);
 const detail = h.mount('mail/my_detail/mail_my_detail', options); await detail.onShow();
 assert.equal(detail.data.panel, 'deliver'); assert.equal(detail.data.detailUI.primaryLabel, '已送达');
 assert.equal(detail.data.detailUI.step, card.progressStep);
 assert.deepEqual(detail.data.detailUI.steps.map(step => step.label), labels);
 assert.equal(detail.data.detailUI.deliveryAddress, card.deliveryAddress);
 await detail.bindSubmitPanel(); detail.setData({ note: '   ' }); await detail.bindSubmitPanel();
 detail.setData({ note: '已放到201室门口，请及时查收。' }); await detail.bindSubmitPanel();
 assert.equal(h.uploads.length, 0); assert.equal(h.stored().MAIL_STATUS, 4);
 detail.setData({ images: ['local-photo.jpg'] }); await detail.bindSubmitPanel();
 assert.equal(h.stored().MAIL_STATUS, 2);
 assert.equal(h.stored().MAIL_DELIVERY_PROOF.note, detail.data.note);
 assert.deepEqual(Array.from(h.stored().MAIL_DELIVERY_PROOF.images), ['cloud://delivery/proof-0']);
 assert.deepEqual(h.commands.map(command => command.route), ['mail/pickup', 'mail/deliver']);
 assert.equal(detail.data.panel, ''); assert.equal(detail.data.detailUI.step, 3);
 list.onShow(); await list._syncOrders();
 assert.equal(list.data.dataList.list[0].MAIL_STATUS, 2); assert.equal(list.data.dataList.list[0].progressStep, 3);
 detail.onHide(); list.onHide();
});

test('detail pickup and delivery use separate confirmations, and cancelling either leaves the order unchanged', async () => {
 const h = await harness(), page = h.mount('mail/my_detail/mail_my_detail', { id: h.id }); await page.onShow();
 assert.equal(page.data.detailUI.primaryLabel, '已取件');
 page.bindPanel(event(h.id, 'deliver')); assert.equal(page.data.panel, '');
 const cancelled = page.bindPrimaryAction(); h.confirm(false); await cancelled;
 assert.equal(h.stored().MAIL_STATUS, 1); assert.equal(h.commands.length, 0);
 const pickup = page.bindPrimaryAction(); await page.bindPrimaryAction();
 assert.equal(h.modals.length, 2); assert.equal(h.modals.at(-1).title, '确认已取件');
 h.confirm(); await pickup;
 assert.equal(h.stored().MAIL_STATUS, 4); assert.equal(page.data.detailUI.primaryLabel, '已送达');
 assert.equal(page.data.detailUI.showProgress, true); assert.equal(page.data.detailUI.step, 2);
 const cancelledDelivery = page.bindPrimaryAction();
 assert.equal(h.modals.at(-1).title, '确认已送达'); h.confirm(false); await cancelledDelivery;
 assert.equal(page.data.panel, ''); assert.equal(h.stored().MAIL_STATUS, 4);
 const delivery = page.bindPrimaryAction(); h.confirm(); await delivery;
 assert.equal(page.data.panel, 'deliver'); assert.equal(h.commands.length, 1);
 page.bindClosePanel(); assert.equal(h.stored().MAIL_STATUS, 4); page.onHide();
});

test('delivery links reload the order and refuse unpicked, changed or unrelated orders', async () => {
 for (const [status, actor] of [[1, 'rider'], [2, 'rider'], [3, 'rider'], [4, 'poster'], [4, 'other']]) {
  const h = await harness(); h.stored().MAIL_STATUS = status; h.setActor(actor);
  const page = h.mount('mail/my_detail/mail_my_detail', { id: h.id, panel: 'deliver' }); await page.onShow();
  assert.equal(page.data.panel, '', status + ':' + actor);
  assert.equal(h.modals.length, 1); assert.equal(h.modals[0].showCancel, false);
  await page.perform('deliver'); assert.equal(h.commands.length, 0); assert.equal(h.uploads.length, 0);
  page.onHide();
 }
});

test('a failed photo upload keeps the delivery draft and allows one successful retry', async () => {
 const h = await harness(true), page = h.mount('mail/my_detail/mail_my_detail', { id: h.id, panel: 'deliver' }); await page.onShow();
 page.setData({ note: '已当面交付，照片为包裹外观。', images: ['local.jpg'] });
 const upload = h.ops.upload; h.ops.upload = async () => { throw new Error('照片上传失败'); };
 await page.bindSubmitPanel();
 assert.equal(h.stored().MAIL_STATUS, 4); assert.equal(h.commands.length, 0);
 assert.equal(page.data.panel, 'deliver'); assert.equal(page.data.busy, false); assert.equal(page.data.images[0], 'local.jpg');
 assert.equal(page.data.note, '已当面交付，照片为包裹外观。'); assert.equal(h.errors.at(-1), '照片上传失败');
 h.ops.upload = upload;
 const retry = page.bindSubmitPanel(); await page.bindSubmitPanel(); await retry;
 assert.equal(h.uploads.length, 1); assert.equal(h.commands.length, 1); assert.equal(h.stored().MAIL_STATUS, 2);
 page.onHide();
});

test('hidden, stale or unrelated card actions cannot advance the order, and navigation errors can be retried', async () => {
 const h = await harness(true), page = h.mount('order/index/order_index', { tab: 1 }); page.onShow(); await page._syncOrders();
 for (const action of ['pickup', 'invalid']) await page.bindOrderAction(event(h.id, action));
 await page.bindOrderAction(event('missing', 'deliver')); assert.equal(h.modals.length, 0);
 const hidden = page.bindOrderAction(event(h.id, 'deliver')); page.onHide(); h.confirm(); await hidden;
 assert.equal(h.navigation.length, 0); assert.equal(h.commands.length, 0);
 page.onShow(); await page._syncOrders();
 const failed = page.bindOrderAction(event(h.id, 'deliver')); h.confirm(); await tick();
 h.navigation.at(-1).fail(new Error('页面打开失败')); await failed;
 assert.equal(page.data.actionBusyId, ''); assert.equal(h.errors.at(-1), '页面打开失败');
 const retry = page.bindOrderAction(event(h.id, 'deliver')); h.confirm(); await tick();
 h.navigation.at(-1).success({}); await retry;
 assert.equal(h.navigation.length, 2); assert.equal(h.stored().MAIL_STATUS, 4); page.onHide();
});

test('all card sections and detail roles use the full order address, including an older order form snapshot', async () => {
 const h = await harness(), list = h.mount('order/index/order_index', { tab: 1 }); list.onShow();
 const expected = '育才校区 · 五期 3栋201室（东侧楼梯入口）';
 for (const role of ['poster', 'rider', 'other']) {
  const mail = await h.f.service.viewMail(role, h.id);
  for (const tabIndex of [0, 1, 2, 3]) {
   list.setData({ tabIndex }); list.bindCommListCmpt({ detail: { dataList: { list: [mail] } } });
   assert.equal(list.data.dataList.list[0].deliveryAddress, expected);
  }
  assert.equal(UI.detail(mail).deliveryAddress, expected);
 }
 const legacy = await h.f.service.viewMail('rider', h.id);
 legacy.MAIL_OBJ.address2 = '3栋201室（东侧楼梯入口）';
 assert.equal(UI.deliveryAddress(legacy), expected);
 assert.equal(UI.detail(legacy).deliveryAddress, expected);
 assert.equal(UI.deliveryAddress({ MAIL_OBJ: { campus: '育才校区', address2: expected } }), expected);
 for (const [status, step] of [[1, 1], [4, 2], [2, 3], [9, 4]]) {
  h.stored().MAIL_STATUS = status;
  const mail = await h.f.service.viewMail('rider', h.id), ui = UI.detail(mail), card = list._decorateOrder(mail);
  assert.deepEqual(Array.from(mail.progressLabels), labels); assert.equal(mail.progressStep, step);
  assert.equal(ui.step, step); assert.equal(card.progressStep, step);
  assert.deepEqual(ui.steps.filter(item => item.current).map(item => item.label), [labels[step]]);
 }
 list.onHide();
});
