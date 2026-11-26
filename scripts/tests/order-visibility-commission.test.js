'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const UI = require('../../miniprogram/projects/crun/biz/mail_ui_biz.js');
const { fixture } = require('../test-support/operations-fixture.cjs');
const { harness, flush } = require('../test-support/mail-form-harness.cjs');
const root = path.resolve(__dirname, '../..');

async function complete(f, label = 'one') {
 const id = await f.publish({ requestId: f.req('publish-' + label) });
 await f.service.acceptMail('rider', id, { requestId: f.req('accept-' + label) });
 await f.service.pickupMail('rider', id, { requestId: f.req('pickup-' + label), images: ['cloud://pickup'] });
 await f.service.deliverMail('rider', id, { requestId: f.req('deliver-' + label), note: '放在门口', images: ['cloud://proof'] });
 await f.service.finishMail('poster', id, { requestId: f.req('finish-' + label) });
 return id;
}
const ids = async (f, userId, sortType) => (await f.service.getMailList(userId, { sortType })).list.map(row => row._id);

test('a cancelled order leaves the rider and poster lists but stays selectable for complaints', async () => {
 const f = fixture(), id = await f.publish();
 await f.service.acceptMail('rider', id, { requestId: f.req('accept') });
 assert.deepEqual(await ids(f, 'rider', 'my_accept'), [id]);
 await f.service.exceptionMail('rider', id, { requestId: f.req('exception'), reason: '申请取消', note: '临时有事' });
 assert.deepEqual(await ids(f, 'rider', 'my_accept'), [id], 'exception is still in progress');
 await f.service.resolveExceptionMail('rider', id, { requestId: f.req('cancel'), resolution: 'cancel' });
 assert.equal(f.table('mail').get(id).MAIL_STATUS, 99);
 assert.ok(f.table('mail').get(id).MAIL_END_TIME > Date.now(), 'the pickup deadline has not passed');
 assert.deepEqual(await ids(f, 'rider', 'my_accept'), []);
 assert.deepEqual(await ids(f, 'poster', 'my_post'), []);
 assert.deepEqual(await ids(f, 'rider', 'my_done'), []);
 assert.deepEqual(await ids(f, 'rider', 'my_all'), [id]);
 assert.deepEqual(await ids(f, 'poster', 'my_all'), [id]);
});

test('a poster-cancelled unaccepted order disappears from my posts immediately', async () => {
 const f = fixture(), id = await f.publish();
 assert.deepEqual(await ids(f, 'poster', 'my_post'), [id]);
 await f.service.cancelMail('poster', id, { requestId: f.req('cancel') });
 assert.deepEqual(await ids(f, 'poster', 'my_post'), []);
 assert.deepEqual(await ids(f, 'poster', 'my_all'), [id]);
});

test('a completed order stays in the done tab after reviews until each participant deletes it', async () => {
 const f = fixture(), id = await complete(f), reviews = new (f.load('review_service.js'))();
 for (const [user, sortType] of [['poster', 'my_post'], ['rider', 'my_accept']]) assert.deepEqual(await ids(f, user, sortType), [], user + ' active list');
 // 完成很久之后也不会自动消失。
 f.table('mail').get(id).MAIL_OVER_TIME = Date.now() - 30 * 24 * 3600000;
 for (const user of ['poster', 'rider']) {
  const rows = (await f.service.getMailList(user, { sortType: 'my_done' })).list;
  assert.deepEqual(rows.map(row => row._id), [id], user);
  assert.equal(rows[0].MAIL_CAN_REVIEW, true);
 }
 await reviews.insert('poster', { orderId: id, score: 5, content: '很好', requestId: f.req('review-poster') });
 assert.equal(f.table('mail').get(id).MAIL_POSTER_REVIEWED, true);
 const reviewed = (await f.service.getMailList('poster', { sortType: 'my_done' })).list;
 assert.deepEqual(reviewed.map(row => row._id), [id], 'reviewing no longer removes the order');
 assert.equal(reviewed[0].MAIL_CAN_REVIEW, false);
 // 删除只影响自己这一侧，对方的「已完成」和双方的反馈投诉选单都不受影响。
 await f.service.delMail('poster', id, { requestId: f.req('delete-poster') });
 assert.equal(f.table('mail').get(id).MAIL_POSTER_DONE_DELETED, true);
 assert.equal(f.table('mail').get(id).MAIL_STATUS, 9, 'deleting keeps the order state');
 assert.deepEqual(await ids(f, 'poster', 'my_done'), []);
 assert.deepEqual(await ids(f, 'rider', 'my_done'), [id]);
 await f.service.delMail('rider', id, { requestId: f.req('delete-rider') });
 assert.deepEqual(await ids(f, 'rider', 'my_done'), []);
 for (const user of ['poster', 'rider']) assert.deepEqual(await ids(f, user, 'my_all'), [id], user + ' complaint picker');
 await assert.rejects(f.service.delMail('other', id, { requestId: f.req('delete-other') }), /无权限/);
 const active = await f.publish({ requestId: f.req('publish-active') });
 await assert.rejects(f.service.delMail('poster', active, { requestId: f.req('delete-active') }), /仅可删除已完成/);
});

test('a completed order no longer exposes the other side: no name, phone or contact button', async () => {
 const f = fixture(), id = await complete(f);
 const riderRow = (await f.service.getMailList('rider', { sortType: 'my_done' })).list[0];
 for (const key of ['poster', 'posterPic', 'tel', 'tel2']) assert.equal(riderRow.MAIL_OBJ[key], undefined, 'list ' + key);
 const riderView = await f.service.viewMail('rider', id);
 for (const key of ['poster', 'posterPic', 'tel', 'tel2']) assert.equal(riderView.MAIL_OBJ[key], undefined, 'detail ' + key);
 const posterView = await f.service.viewMail('poster', id);
 assert.equal(posterView.acceptUser, undefined, 'the poster no longer receives rider details');
 for (const view of [{ ...riderView, myaccept: true }, { ...posterView, mypost: true }]) {
  const ui = UI.detail(view);
  assert.equal(ui.contactName, '匿名用户'); assert.equal(ui.phone, ''); assert.equal(ui.contactHidden, true);
 }
 // 进行中的订单照常显示对方信息。
 const ongoing = UI.detail({ MAIL_STATUS: 1, myaccept: true, MAIL_OBJ: { poster: '小王', tel: '13800000000' } });
 assert.equal(ongoing.contactName, '小王'); assert.equal(ongoing.phone, '13800000000'); assert.equal(ongoing.contactHidden, false);
 const admin = await f.service.getMailDetail(null, id);
 assert.ok(admin.MAIL_OBJ.tel, 'admins still see the contact details');
 const detailTpl = fs.readFileSync(path.join(root, 'miniprogram/projects/crun/pages/mail/tpl/mail_detail_tpl.wxml'), 'utf8');
 assert.match(detailTpl, /<button wx:if="\{\{ui\.phone && !ui\.hideContactCall\}\}" class="od-call"/);
});

test('twelve hours after completion every missing review becomes five stars and the order stays in the done tab', async () => {
 const f = fixture(), id = await complete(f), reviews = new (f.load('review_service.js'))();
 const Maintenance = f.load('maintenance_service.js'), Mail = f.load('mail_service.js');
 assert.equal(Mail.REVIEW_WINDOW_MS, 12 * 3600000);
 await reviews.insert('poster', { orderId: id, score: 3, content: '一般', requestId: f.req('review-poster') });
 // 未到 12 小时：定时任务不动它。
 assert.equal(await new Maintenance()._sweep(id, 'auto_review'), 0);
 assert.equal(f.table('order_review').size, 1);
 f.table('mail').get(id).MAIL_OVER_TIME = Date.now() - 12 * 3600000 - 1000;
 // 到点后订单仍留在「已完成」，只是补上 5 星好评。
 assert.deepEqual(await ids(f, 'rider', 'my_done'), [id]);
 const notices = f.table('notification').size;
 const result = await new Maintenance().run();
 assert.equal(result.autoReview, 1);
 const rows = [...f.table('order_review').values()];
 const auto = rows.find(row => row.REVIEW_FROM_USER_ID === 'rider');
 assert.equal(auto.REVIEW_SCORE, 5); assert.equal(auto.REVIEW_AUTO, true); assert.equal(auto.REVIEW_TO_USER_ID, 'poster'); assert.equal(auto.REVIEW_CONTENT, '');
 assert.equal(rows.find(row => row.REVIEW_FROM_USER_ID === 'poster').REVIEW_SCORE, 3, 'an existing review is kept');
 const mail = f.table('mail').get(id);
 assert.equal(mail.MAIL_RIDER_REVIEWED, true); assert.equal(mail.MAIL_STATUS, 9);
 assert.equal(f.table('notification').size, notices, 'auto reviews send no notification');
 assert.equal(await new Maintenance()._sweep(id, 'auto_review'), 0, 'running again writes nothing');
 assert.equal(f.table('order_review').size, 2);
 await assert.rejects(reviews.insert('rider', { orderId: id, score: 1, requestId: f.req('late') }), /已经评价过/);
 for (const user of ['poster', 'rider']) assert.deepEqual(await ids(f, user, 'my_all'), [id], user + ' complaint picker');
 assert.deepEqual(await ids(f, 'rider', 'my_done'), [id]);
});

test('a failed review leaves the order in the done tab', async () => {
 const f = fixture(), id = await complete(f), reviews = new (f.load('review_service.js'))();
 await assert.rejects(reviews.insert('poster', { orderId: id, score: 9, requestId: f.req('bad') }), /评分/);
 assert.equal(f.table('mail').get(id).MAIL_POSTER_REVIEWED, undefined);
 assert.deepEqual(await ids(f, 'poster', 'my_done'), [id]);
});

test('an admin-completed order without a rider never waits for a review', async () => {
 const f = fixture(), id = await f.publish();
 await f.service.holdMail('admin', id, { requestId: f.req('hold'), note: '人工介入' });
 await f.service.resolveMail('admin', id, { requestId: f.req('resolve'), resolution: 'complete', note: '人工完结' });
 assert.equal(f.table('mail').get(id).MAIL_STATUS, 9);
 assert.deepEqual(await ids(f, 'poster', 'my_done'), []);
});

test('order cards show no take-home amount while the detail keeps the rider amount after the 10% fee', () => {
 assert.equal(UI.COMMISSION_RATE, 10);
 assert.deepEqual(UI.commission({ MAIL_PAYMENT_MODE: 'wechat', MAIL_TOTAL_FEE: 1000 }), { visible: true, rate: 10, gross: '10.00', net: '9.00', cut: '1.00', label: '到手' });
 assert.equal(UI.commission({ MAIL_PAYMENT_MODE: 'wechat', MAIL_TOTAL_FEE: 1000, mypost: true }).label, '骑手到手');
 // 骑手报酬按分向下取整，余数归平台，与 earnings_service 的 floor(fee * 9 / 10) 一致。
 for (const fee of [1, 9, 11, 199, 1234, 99999]) {
  const split = UI.commission({ MAIL_PAYMENT_MODE: 'adapay', MAIL_TOTAL_FEE: fee });
  assert.equal(Math.round(Number(split.net) * 100), Math.floor(fee * 9 / 10), String(fee));
  assert.equal(Math.round((Number(split.net) + Number(split.cut)) * 100), fee);
 }
 for (const mail of [{ MAIL_PAYMENT_MODE: 'offline', MAIL_TOTAL_FEE: 1000 }, { MAIL_PAYMENT_MODE: 'wechat', MAIL_TOTAL_FEE: 0 }, { MAIL_PAYMENT_MODE: 'wechat' }, null]) {
  assert.equal(UI.commission(mail).visible, false);
 }
 assert.equal(UI.detail({ MAIL_STATUS: 1, MAIL_PAYMENT_MODE: 'wechat', MAIL_TOTAL_FEE: 500, MAIL_OBJ: { price: 5 } }).commission.net, '4.50');
 const list = fs.readFileSync(path.join(root, 'miniprogram/projects/crun/pages/order/index/order_index.wxml'), 'utf8');
 // 订单卡片上不显示「到手」金额，订单详情里照常显示。
 assert.doesNotMatch(list, /到手|commission|tip-net/);
 const detailTpl = fs.readFileSync(path.join(root, 'miniprogram/projects/crun/pages/mail/tpl/mail_detail_tpl.wxml'), 'utf8');
 assert.match(detailTpl, /<view wx:if="\{\{ui\.commission\.visible\}\}" class="od-fee-split">\{\{ui\.commission\.label\}\} ¥\{\{ui\.commission\.net\}\}<\/view>/);
 for (const text of [list, detailTpl]) assert.doesNotMatch(text, /抽成/);
 assert.doesNotMatch(fs.readFileSync(path.join(root, 'miniprogram/projects/crun/pages/order/index/order_index.js'), 'utf8'), /commission/);
});

test('the done tab shows anonymous cards with delete and review actions', () => {
 const list = fs.readFileSync(path.join(root, 'miniprogram/projects/crun/pages/order/index/order_index.wxml'), 'utf8');
 const done = list.split('<!-- ===== 已完成 Tab ===== -->')[1];
 assert.match(done, /wx:if="\{\{order\.MAIL_CAN_REVIEW\}\}" class="btn-primary" catchtap="bindReviewTap" data-id="\{\{order\._id\}\}">评价</);
 assert.match(done, /catchtap="bindDeleteDoneTap" data-id="\{\{order\._id\}\}"[^>]*>删除</);
 assert.match(done, /<text class="nick">匿名用户<\/text>/);
 assert.doesNotMatch(done, /MAIL_OBJ\.poster|bindCallTap|已评价/);
});

function orderList(commands, confirm = true) {
 let page;
 const sandbox = { console, getApp: () => ({}), Page: p => page = p, setTimeout, clearTimeout,
  wx: { navigateTo() {}, showModal() {}, showToast() {} },
  require(request) {
   if (request.includes('operations_biz')) return { command: async (route, params) => { commands.push({ route, params }); return { id: params.id }; }, error: error => commands.push({ error: error.message }) };
   if (request.includes('page_helper')) return { showConfirm: async () => confirm, showSuccToast() {}, fmtURLByPID: url => url };
   if (request.includes('public_biz')) return { removeCacheList() {} };
   if (request.includes('passport_biz')) return { loginMustCancelWin: async () => true, getUserId: () => 'me' };
   if (request.includes('mail_ui_biz')) return UI;
   if (request.includes('settlement_gate_biz')) return { ensureSettlement: async () => true };
   return {};
  } };
 vm.runInNewContext(fs.readFileSync(path.join(root, 'miniprogram/projects/crun/pages/order/index/order_index.js'), 'utf8'), sandbox);
 page.setData = function (patch) { for (const [key, value] of Object.entries(patch)) { const parts = key.split('.'); let target = this.data; while (parts.length > 1) target = target[parts.shift()]; target[parts[0]] = value; } };
 page._visible = true;
 return page;
}

test('deleting a done card asks first, calls mail/del once and removes only that card', async () => {
 const commands = [], page = orderList(commands);
 page.data.tabIndex = 3; page.data.dataList = { total: 2, list: [{ _id: 'a', MAIL_STATUS: 9 }, { _id: 'b', MAIL_STATUS: 9 }] };
 await page.bindDeleteDoneTap({ currentTarget: { dataset: { id: 'a' } } });
 assert.deepEqual(JSON.parse(JSON.stringify(commands)), [{ route: 'mail/del', params: { id: 'a' } }]);
 assert.deepEqual([...page.data.dataList.list.map(row => row._id)], ['b']); assert.equal(page.data.dataList.total, 1); assert.equal(page.data.deletingId, '');
 const declined = [], other = orderList(declined, false);
 other.data.tabIndex = 3; other.data.dataList = { total: 1, list: [{ _id: 'a', MAIL_STATUS: 9 }] };
 await other.bindDeleteDoneTap({ currentTarget: { dataset: { id: 'a' } } });
 assert.deepEqual(declined, []); assert.equal(other.data.dataList.list.length, 1);
});

function gate(account) {
 const modals = [], navigations = [], gets = [];
 const sandbox = { module: { exports: {} }, require: () => ({ get: async route => { gets.push(route); return account; } }),
  wx: { showModal: options => { modals.push(options); options.complete(); }, navigateTo: options => navigations.push(options.url) } };
 vm.runInNewContext(fs.readFileSync(path.join(root, 'miniprogram/projects/crun/biz/settlement_gate_biz.js'), 'utf8'), sandbox);
 return { biz: sandbox.module.exports, modals, navigations, gets };
}

test('accepting an online order without a bound settlement card goes to the settlement page instead', async () => {
 const missing = gate({ opened: false });
 assert.equal(await missing.biz.ensureSettlement({ MAIL_PAYMENT_MODE: 'adapay' }), false);
 assert.deepEqual(missing.gets, ['settlement/status']);
 assert.equal(missing.modals.length, 1); assert.equal(missing.modals[0].showCancel, false); assert.match(missing.modals[0].content, /银行卡/);
 assert.deepEqual(missing.navigations, ['/projects/crun/pages/my/settlement/settlement']);
 const ready = gate({ opened: true });
 assert.equal(await ready.biz.ensureSettlement({ MAIL_PAYMENT_MODE: 'adapay' }), true);
 assert.deepEqual([ready.modals.length, ready.navigations.length], [0, 0]);
 const offline = gate({ opened: false });
 assert.equal(await offline.biz.ensureSettlement({ MAIL_PAYMENT_MODE: 'offline' }), true);
 assert.deepEqual(offline.gets, [], 'orders without online settlement need no card');
 // 两个接单入口都先过这道检查，再弹接单确认。
 for (const file of ['pages/order/index/order_index.js', 'pages/mail/detail/mail_detail.js']) {
  const source = fs.readFileSync(path.join(root, 'miniprogram/projects/crun', file), 'utf8');
  assert.ok(source.indexOf('SettlementGate.ensureSettlement(') > 0 && source.indexOf('SettlementGate.ensureSettlement(') < source.indexOf("Ops.command('mail/accept'"), file);
 }
});

test('user-facing pages no longer mention settling offline between both sides', () => {
 const files = ['pages/mail/tpl/mail_detail_tpl.wxml', 'pages/mail/detail/mail_detail.js', 'pages/mail/my_detail/mail_my_detail.js', 'pages/mail/add/business_order_fields.wxml', 'pages/mail/add/mail_add.wxml', 'pages/mail/add/mail_add_logic.js', 'pages/order/index/order_index.wxml', 'pages/order/index/order_index.js', 'pages/admin/orders/detail/admin_order_detail.wxml', 'pages/admin/settings/pricing/admin_pricing_settings.wxml', 'pages/admin/monitor/admin_monitor.wxml'];
 for (const file of files) assert.doesNotMatch(fs.readFileSync(path.join(root, 'miniprogram/projects/crun', file), 'utf8'), /线下结算|线下协商|双方线下|线下费用|线下订单/, file);
});

function payment(answers, replies) {
 const modals = [], calls = [];
 const sandbox = { module: { exports: {} }, require: () => ({ get: async (route, params) => { calls.push(route); return replies[route](params); } }),
  wx: { showModal: options => { modals.push(options); options.success({ confirm: answers.shift() }); }, requestPayment: options => { calls.push('requestPayment'); options.success(); } } };
 vm.runInNewContext(fs.readFileSync(path.join(root, 'miniprogram/projects/crun/biz/payment_biz.js'), 'utf8'), sandbox);
 return { biz: sandbox.module.exports, modals, calls };
}

test('every payment attempt shows the commission notice first and cancelling it never requests payment', async () => {
 let paid = false;
 const replies = { 'mail/payment_status': () => ({ status: paid ? 0 : -1, published: paid }), 'mail/payment_prepare': () => { paid = true; return { payment: {} }; } };
 const declined = payment([false], replies);
 await assert.rejects(declined.biz.pay('one'), /支付已取消/);
 assert.equal(declined.modals.length, 1); assert.match(declined.modals[0].content, /^　　支付成功后订单才会发布[\s\S]*平台从中收取10%技术服务费/); assert.doesNotMatch(declined.modals[0].content, /抽成/);
 assert.deepEqual(declined.calls, ['mail/payment_status']);
 const first = payment([true], replies);
 assert.equal((await first.biz.pay('one')).published, true);
 assert.equal(first.modals.length, 1);
 assert.deepEqual(first.calls, ['mail/payment_status', 'mail/payment_prepare', 'requestPayment', 'mail/payment_status']);
 paid = false;
 const again = payment([true], replies);
 await again.biz.pay('two');
 assert.equal(again.modals.length, 1, 'the notice is shown on every payment, not once per session');
 const settled = payment([], { 'mail/payment_status': () => ({ status: 0, published: true }) });
 await settled.biz.pay('three');
 assert.equal(settled.modals.length, 0, 'an already published order needs no new payment');
 assert.match(fs.readFileSync(path.join(root, 'cloudfunctions/mcloud/project/crun/service/operation_config_service.js'), 'utf8'), new RegExp("paymentNotice: '" + first.biz.PAY_NOTICE + "'"));
});

async function publishTake(h) {
 h.page.bindPackageTap({ currentTarget: { dataset: { index: 0, step: 1 } } });
 h.page.bindPackageItemInput({ currentTarget: { dataset: { index: 0, mark: 'pickupPoint' } }, detail: { value: '一期 · 菜鸟驿站' } });
 h.page.bindPackageItemInput({ currentTarget: { dataset: { index: 0, mark: 'code' } }, detail: { value: '12-34' } });
 const submit = h.page.bindFormSubmit();
 await flush();
 // 包一层对象：直接返回 Promise 会被 await 展开，等到弹窗被点击才返回。
 return { submit };
}

const VALUABLE = '请勿在包裹中夹带现金、首饰、证件、数码产品等贵重物品。你已知晓该提醒，若因贵重物品产生丢失、损坏或纠纷，平台仅协助配合调查，不承担赔付责任。';

test('online publishing shows the original valuables reminder, then the payment notice before paying', async () => {
 let paid = false;
 const payments = [], h = harness({ paymentMode: 'wechat', payments, payment: {
  'mail/payment_status': () => ({ status: paid ? 0 : -1, published: paid }), 'mail/payment_prepare': () => { paid = true; return { payment: {} }; } } });
 await h.start();
 const { submit } = await publishTake(h);
 assert.equal(h.modals.length, 1);
 assert.deepEqual([h.modals[0].title, h.modals[0].content], ['贵重物品提醒', VALUABLE]);
 h.modals[0].success({ confirm: true });
 await flush();
 assert.equal(h.commands.length, 1, JSON.stringify(h.errors));
 assert.equal(h.modals.length, 2);
 assert.equal(h.modals[1].title, '支付说明');
 assert.match(h.modals[1].content, /^　　支付成功后订单才会发布[\s\S]*平台从中收取10%技术服务费/);
 assert.equal(payments.length, 0, 'payment waits for the payment notice');
 h.modals[1].success({ confirm: true });
 await submit;
 assert.equal(payments.length, 1);
 assert.deepEqual(h.errors, []);
});

test('declining the valuables reminder neither saves nor pays, and offline publishing shows the same reminder', async () => {
 const payments = [], h = harness({ paymentMode: 'adapay', payments, payment: { 'mail/payment_status': () => ({ status: -1, published: false }) } });
 await h.start();
 const { submit } = await publishTake(h);
 h.modals[0].success({ confirm: false });
 await submit;
 assert.deepEqual([h.commands.length, payments.length], [0, 0]);
 const offline = harness();
 await offline.start();
 const { submit: done } = await publishTake(offline);
 assert.deepEqual([offline.modals[0].title, offline.modals[0].content], ['贵重物品提醒', VALUABLE]);
 offline.modals[0].success({ confirm: true });
 await done;
 assert.equal(offline.commands.length, 1);
});

test('the settlement card change is blocked by unfinished posts, accepts and unsettled earnings', async () => {
 const f = fixture(), account = new (f.load('adapay_account_service.js'))();
 assert.equal(await account.openOrders('rider'), '');
 const posted = await f.publish({ requestId: f.req('rider-post') }, 'rider');
 assert.match(await account.openOrders('rider'), /未完成的发布订单/);
 await f.service.cancelMail('rider', posted, { requestId: f.req('rider-cancel') });
 assert.equal(await account.openOrders('rider'), '', 'a cancelled post no longer blocks');
 const id = await f.publish({ requestId: f.req('poster-post') });
 await f.service.acceptMail('rider', id, { requestId: f.req('accept') });
 assert.match(await account.openOrders('rider'), /未完成的接单订单/);
 assert.match(await account.openOrders('poster'), /未完成的发布订单/);
 await f.service.pickupMail('rider', id, { requestId: f.req('pickup'), images: ['cloud://pickup'] });
 await f.service.deliverMail('rider', id, { requestId: f.req('deliver'), note: '放在门口', images: ['cloud://proof'] });
 await f.service.finishMail('poster', id, { requestId: f.req('finish') });
 f.table('mail').get(id).MAIL_EARNINGS_STATUS = 'pending';
 assert.match(await account.openOrders('rider'), /跑腿报酬正在结算/);
 assert.equal(await account.openOrders('poster'), '');
 f.table('mail').get(id).MAIL_EARNINGS_STATUS = 'settled';
 assert.equal(await account.openOrders('rider'), '');
});

test('each package price keeps at most two decimals without a 10 yuan cap, completes on blur and states the 1 yuan start', async () => {
 const h = harness();
 await h.start();
 h.page.bindPackageTap({ currentTarget: { dataset: { index: 0, step: 1 } } });
 const input = value => h.page.bindPackageItemInput({ currentTarget: { dataset: { index: 0, mark: 'price' } }, detail: { value } });
 const blur = value => h.page.bindPackagePriceBlur({ currentTarget: { dataset: { index: 0 } }, detail: { value } });
 for (const [raw, kept] of [['12', '12'], ['128.5', '128.5'], ['123456', '1234'], ['9.999', '9.99'], ['15.678', '15.67'], ['0.5', '5'], ['.8', '8'], ['3.4.5', '3.45'], ['a7', '7']]) assert.equal(input(raw), kept, raw);
 for (const [raw, done] of [['5', '5.00'], ['5.', '5.00'], ['5.5', '5.50'], ['9.99', '9.99'], ['25', '25.00']]) {
  assert.equal(blur(raw), done, raw);
  assert.equal(h.page.data.packageItems[0].price, done);
 }
 assert.equal(h.page.data.totalFee, '25.00');
 // 清空后离开输入框，恢复为参考价。
 assert.equal(blur(''), h.page.data.packageItems[0].referencePrice);
 const wxml = fs.readFileSync(path.join(root, 'miniprogram/projects/crun/pages/mail/add/business_order_fields.wxml'), 'utf8');
 assert.match(wxml, /每件 1 元起步/);
 assert.match(wxml, /type="digit" maxlength="7"[^>]*bindinput="bindPackageItemInput" bindblur="bindPackagePriceBlur"/);
});
