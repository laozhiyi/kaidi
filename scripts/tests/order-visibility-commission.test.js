'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const UI = require('../../miniprogram/projects/crun/biz/mail_ui_biz.js');
const { fixture } = require('../test-support/operations-fixture.cjs');
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

test('a completed order moves to the done tab until each participant reviews it', async () => {
 const f = fixture(), id = await complete(f), reviews = new (f.load('review_service.js'))();
 for (const [user, sortType] of [['poster', 'my_post'], ['rider', 'my_accept']]) assert.deepEqual(await ids(f, user, sortType), [], user + ' active list');
 // 已完成列表不再按 12 小时裁剪：未评价的订单一直留着等评价。
 f.table('mail').get(id).MAIL_OVER_TIME = Date.now() - 30 * 86400000;
 for (const user of ['poster', 'rider']) {
  const rows = (await f.service.getMailList(user, { sortType: 'my_done' })).list;
  assert.deepEqual(rows.map(row => row._id), [id], user);
  assert.equal(rows[0].MAIL_CAN_REVIEW, true);
 }
 await reviews.insert('poster', { orderId: id, score: 5, content: '很好', requestId: f.req('review-poster') });
 assert.equal(f.table('mail').get(id).MAIL_POSTER_REVIEWED, true);
 assert.equal(f.table('mail').get(id).MAIL_STATUS, 9, 'reviewing keeps the order state');
 assert.deepEqual(await ids(f, 'poster', 'my_done'), []);
 assert.deepEqual(await ids(f, 'rider', 'my_done'), [id], 'the other participant still needs to review');
 await reviews.insert('rider', { orderId: id, score: 4, content: '', requestId: f.req('review-rider') });
 assert.deepEqual(await ids(f, 'rider', 'my_done'), []);
 for (const user of ['poster', 'rider']) assert.deepEqual(await ids(f, user, 'my_all'), [id], user + ' complaint picker');
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

test('order cards show the price before and after the 10% commission, matching rider earnings', () => {
 assert.equal(UI.COMMISSION_RATE, 10);
 assert.deepEqual(UI.commission({ MAIL_PAYMENT_MODE: 'wechat', MAIL_TOTAL_FEE: 1000 }), { visible: true, rate: 10, gross: '10.00', net: '9.00', cut: '1.00' });
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
 assert.equal((list.match(/抽成前 ¥\{\{order\.commission\.gross\}\} · 抽成后 ¥\{\{order\.commission\.net\}\}/g) || []).length, 4, 'all four tabs');
 assert.match(fs.readFileSync(path.join(root, 'miniprogram/projects/crun/pages/mail/tpl/mail_detail_tpl.wxml'), 'utf8'), /ui\.commission\.visible/);
 assert.match(fs.readFileSync(path.join(root, 'miniprogram/projects/crun/pages/order/index/order_index.js'), 'utf8'), /commission: MailUI\.commission\(order\)/);
});

test('the done tab offers only a review action and never a reviewed state', () => {
 const list = fs.readFileSync(path.join(root, 'miniprogram/projects/crun/pages/order/index/order_index.wxml'), 'utf8');
 assert.match(list, /wx:if="\{\{order\.MAIL_CAN_REVIEW\}\}" class="btn-primary" catchtap="bindReviewTap" data-id="\{\{order\._id\}\}">评价</);
 assert.doesNotMatch(list, /已评价/);
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
 assert.equal(declined.modals.length, 1); assert.match(declined.modals[0].content, /抽成10%/);
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
