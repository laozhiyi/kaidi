'use strict';
// 价格协商：骑手取件前发现包裹比所选大小大，可申请调价；发布人同意 / 拒绝；
// 提交取件凭证即确认包裹大小，此后不能再调价，未处理的申请自动撤回。
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('../test-support/operations-fixture.cjs');
const MailUI = require('../../miniprogram/projects/crun/biz/mail_ui_biz.js');

async function accepted() {
  const f = fixture(), id = await f.publish();
  await f.service.acceptMail('rider', id, { requestId: f.req('accept') });
  const mail = () => f.table('mail').get(id);
  const notes = action => [...f.table('notification').values()].filter(row => row.orderId === id && row.action === action);
  return Object.assign(f, { id, mail, notes });
}
const propose = (f, price, reason = '实际是大件', key = 'propose') => f.service.proposePrice('rider', f.id, { requestId: f.req(key), price, reason });
const respond = (f, decision, key = 'respond', actor = 'poster') => f.service.respondPrice(actor, f.id, { requestId: f.req(key), decision });
const pickup = (f, key = 'pickup') => f.service.pickupMail('rider', f.id, { requestId: f.req(key), images: ['cloud://bucket/private-evidence/rider/pickup.png'] });

test('骑手申请调价后只通知发布人，发布人同意后订单费用改为新价格并通知骑手', async () => {
  const f = await accepted();
  const from = f.mail().MAIL_TOTAL_FEE, to = from + 300;
  await propose(f, (to / 100).toFixed(2));
  const pending = f.mail().MAIL_PRICE_ADJUST;
  assert.deepEqual({ status: pending.status, from: pending.from, to: pending.to, reason: pending.reason, count: pending.count }, { status: 'pending', from, to, reason: '实际是大件', count: 1 });
  assert.equal(f.mail().MAIL_TOTAL_FEE, from, '发布人同意前费用不变');
  assert.deepEqual(f.notes('price_propose').map(row => row.userId), ['poster']);

  await respond(f, 'agree');
  assert.equal(f.mail().MAIL_TOTAL_FEE, to);
  assert.equal(f.mail().MAIL_OBJ.price, to / 100);
  assert.equal(f.mail().MAIL_PRICE_ADJUST.status, 'agreed');
  assert.deepEqual(f.notes('price_respond').map(row => row.userId), ['rider']);
  assert.match(f.notes('price_respond')[0].title, /同意/);
});

test('发布人拒绝后费用不变，骑手可以再次申请，最多 3 次', async () => {
  const f = await accepted();
  const from = f.mail().MAIL_TOTAL_FEE;
  for (let i = 1; i <= 3; i++) {
    await propose(f, ((from + i * 100) / 100).toFixed(2), '实际是中件', 'propose' + i);
    await respond(f, 'reject', 'respond' + i);
    assert.equal(f.mail().MAIL_TOTAL_FEE, from);
    assert.equal(f.mail().MAIL_PRICE_ADJUST.status, 'rejected');
    assert.equal(f.mail().MAIL_PRICE_ADJUST.count, i);
  }
  await assert.rejects(() => propose(f, ((from + 900) / 100).toFixed(2), '实际是大件', 'propose4'), /已达3次/);
});

test('调价申请的校验：须高于原价、格式有效、有理由、同一时间只有一条待处理', async () => {
  const f = await accepted();
  const from = f.mail().MAIL_TOTAL_FEE;
  await assert.rejects(() => propose(f, (from / 100).toFixed(2), '实际是大件', 'same'), /须高于当前价格/);
  await assert.rejects(() => propose(f, 'abc', '实际是大件', 'bad'), /有效的新价格/);
  await assert.rejects(() => propose(f, '1.234', '实际是大件', 'bad2'), /有效的新价格/);
  await assert.rejects(() => propose(f, '10000.01', '实际是大件', 'huge'), /不能超过/);
  await assert.rejects(() => propose(f, ((from + 100) / 100).toFixed(2), '', 'empty'), /调价理由/);
  await propose(f, ((from + 100) / 100).toFixed(2));
  await assert.rejects(() => propose(f, ((from + 200) / 100).toFixed(2), '实际是大件', 'again'), /尚未处理/);
  await assert.rejects(() => respond(f, 'maybe', 'maybe'), /处理方式无效/);
});

test('只有接单骑手能申请、只有发布人能处理', async () => {
  const f = await accepted();
  const price = ((f.mail().MAIL_TOTAL_FEE + 100) / 100).toFixed(2);
  await assert.rejects(() => f.service.proposePrice('poster', f.id, { requestId: f.req('p1'), price, reason: '实际是大件' }), /骑手可申请调价/);
  await assert.rejects(() => f.service.proposePrice('rider2', f.id, { requestId: f.req('p2'), price, reason: '实际是大件' }), /无权限/);
  await propose(f, price);
  await assert.rejects(() => respond(f, 'agree', 'r1', 'rider'), /仅发布人/);
  await assert.rejects(() => respond(f, 'agree', 'r2', 'other'), /无权限/);
});

test('提交取件凭证即锁定价格：未处理的申请自动撤回，取件后不能再申请或同意', async () => {
  const f = await accepted();
  const from = f.mail().MAIL_TOTAL_FEE;
  await propose(f, ((from + 300) / 100).toFixed(2));
  await pickup(f);
  assert.equal(f.mail().MAIL_STATUS, 4);
  assert.equal(f.mail().MAIL_PRICE_ADJUST.status, 'withdrawn');
  assert.equal(f.mail().MAIL_TOTAL_FEE, from);
  await assert.rejects(() => respond(f, 'agree', 'late'), /骑手取件前/);
  await assert.rejects(() => propose(f, ((from + 500) / 100).toFixed(2), '实际是大件', 'late2'), /尚未提交取件凭证/);
});

test('待接单订单不能申请调价', async () => {
  const f = fixture(), id = await f.publish();
  await assert.rejects(() => f.service.proposePrice('rider', id, { requestId: f.req('early'), price: '99', reason: '实际是大件' }), /无权限/);
});

test('详情页的调价卡片按角色与状态区分', () => {
  const base = (extra = {}) => ({ MAIL_STATUS: 1, MAIL_TOTAL_FEE: 300, MAIL_OBJ: { serviceType: 'take', price: 3 }, ...extra });
  const pending = { status: 'pending', from: 300, to: 600, reason: '实际是大件', count: 1 };

  const riderIdle = MailUI.priceAdjust(base({ myaccept: true }));
  assert.equal(riderIdle.canPropose, true); assert.equal(riderIdle.hasRecord, false); assert.equal(riderIdle.left, 3);

  const riderPending = MailUI.priceAdjust(base({ myaccept: true, MAIL_PRICE_ADJUST: pending }));
  assert.equal(riderPending.pending, true); assert.equal(riderPending.canPropose, false); assert.equal(riderPending.canRespond, false);
  assert.equal(riderPending.from, '3.00'); assert.equal(riderPending.to, '6.00');

  const posterPending = MailUI.priceAdjust(base({ mypost: true, MAIL_PRICE_ADJUST: pending }));
  assert.equal(posterPending.canRespond, true); assert.equal(posterPending.title, '骑手申请调整费用');

  const rejected = MailUI.priceAdjust(base({ myaccept: true, MAIL_PRICE_ADJUST: { ...pending, status: 'rejected' } }));
  assert.equal(rejected.canPropose, true); assert.equal(rejected.left, 2); assert.equal(rejected.tone, 'rejected');

  const used = MailUI.priceAdjust(base({ myaccept: true, MAIL_PRICE_ADJUST: { ...pending, status: 'rejected', count: 3 } }));
  assert.equal(used.canPropose, false);

  // 取件后（配送中）只留记录，不能再申请
  const picked = MailUI.priceAdjust(base({ myaccept: true, MAIL_STATUS: 4, MAIL_PRICE_ADJUST: { ...pending, status: 'withdrawn' } }));
  assert.equal(picked.canPropose, false); assert.equal(picked.tone, 'withdrawn');
  assert.equal(MailUI.priceAdjust(base({ myaccept: true, MAIL_STATUS: 4 })).visible, false);

  // 非参与人、非快递代取看不到
  assert.equal(MailUI.priceAdjust(base({ MAIL_PRICE_ADJUST: pending })).visible, false);
  assert.equal(MailUI.priceAdjust(base({ myaccept: true, MAIL_OBJ: { serviceType: 'send' } })).visible, false);
});

// ---- 调价未达成：骑手放弃接单，订单按原价重新上架 ----
test('调价被拒后骑手放弃接单：订单回到待接单、价格不变、通知发布人，原骑手不能再接', async () => {
  const f = await accepted();
  const from = f.mail().MAIL_TOTAL_FEE;
  await assert.rejects(() => f.service.releaseMail('rider', f.id, { requestId: f.req('early-release') }), /被拒绝后才能放弃/);
  await propose(f, ((from + 300) / 100).toFixed(2));
  await assert.rejects(() => f.service.releaseMail('rider', f.id, { requestId: f.req('pending-release') }), /被拒绝后才能放弃/);
  await respond(f, 'reject');
  await assert.rejects(() => f.service.releaseMail('poster', f.id, { requestId: f.req('poster-release') }), /骑手可放弃/);

  await f.service.releaseMail('rider', f.id, { requestId: f.req('release') });
  const mail = f.mail();
  assert.equal(mail.MAIL_STATUS, 0);
  assert.equal(mail.MAIL_ACCEPT_USER_ID, '');
  assert.equal(mail.MAIL_TOTAL_FEE, from, '按原价重新发布');
  assert.equal(mail.MAIL_PRICE_ADJUST, null, '新骑手重新获得调价次数');
  assert.equal(mail.MAIL_ACCEPT_TIME, undefined);
  assert.deepEqual(f.notes('release').map(row => row.userId), ['poster']);
  assert.match(f.notes('release')[0].content, /重新发布/);

  await assert.rejects(() => f.service.acceptMail('rider', f.id, { requestId: f.req('reaccept') }), /已放弃过/);
  await f.service.acceptMail('rider2', f.id, { requestId: f.req('accept2') });
  assert.equal(f.mail().MAIL_STATUS, 1);
  assert.equal(f.mail().MAIL_ACCEPT_USER_ID, 'rider2');
});

test('重新上架的订单不显示上一位骑手的接单进度', async () => {
  const f = await accepted();
  await propose(f, ((f.mail().MAIL_TOTAL_FEE + 100) / 100).toFixed(2));
  await respond(f, 'reject');
  await f.service.releaseMail('rider', f.id, { requestId: f.req('release') });
  const rules = f.load('order_rules.js');
  const view = rules.project(f.mail(), 'poster');
  assert.equal(view.MAIL_ACCEPT_TIME, undefined);
  assert.notEqual(view.MAIL_MILESTONES.MAIL_ACCEPT_TIME, true, '进度里不再算作已接单');
  assert.ok(view.MAIL_ADD_TIME > 0, '发布时间仍然保留');
});

test('详情页：调价被拒后骑手才看到「放弃接单」', () => {
  const base = extra => ({ MAIL_STATUS: 1, MAIL_TOTAL_FEE: 300, MAIL_OBJ: { serviceType: 'take' }, myaccept: true, ...extra });
  const record = status => ({ status, from: 300, to: 600, reason: '实际是大件', count: 1 });
  assert.equal(MailUI.priceAdjust(base({ MAIL_PRICE_ADJUST: record('rejected') })).canRelease, true);
  for (const status of ['pending', 'agreed']) assert.equal(MailUI.priceAdjust(base({ MAIL_PRICE_ADJUST: record(status) })).canRelease, false);
  assert.equal(MailUI.priceAdjust(base({})).canRelease, false);
  assert.equal(MailUI.priceAdjust(base({ myaccept: false, mypost: true, MAIL_PRICE_ADJUST: record('rejected') })).canRelease, false);
});

// ---- 小费：下单时加，骑手接单前可见，计入总价 ----
const withTip = (f, tip) => [...f.forms().filter(x => x.mark !== 'tip'), { mark: 'tip', title: '小费', type: 'int', val: tip }];

test('小费由发布人自定义金额，计入订单总价并对未接单骑手公开；0 到 20 元、最多两位小数', async () => {
  const f = fixture();
  const plainId = await f.publish();
  const plainFee = f.table('mail').get(plainId).MAIL_TOTAL_FEE;
  const id = await f.service.insertMail('poster', { forms: withTip(f, 3), requestId: f.req('tip') }).then(r => r._id);
  const mail = f.table('mail').get(id);
  assert.equal(mail.MAIL_OBJ.tip, 3);
  assert.equal(mail.MAIL_TOTAL_FEE, plainFee + 300);
  assert.equal(mail.MAIL_OBJ.price, (plainFee + 300) / 100);
  assert.equal(f.table('mail').get(plainId).MAIL_OBJ.tip, 0);
  const view = f.load('order_rules.js').project(mail, 'rider');
  assert.equal(view.MAIL_OBJ.tip, 3, '骑手接单前就能看到小费');
  const custom = await f.service.insertMail('poster', { forms: withTip(f, '2.5'), requestId: f.req('tip-custom') }).then(r => r._id);
  assert.equal(f.table('mail').get(custom).MAIL_OBJ.tip, 2.5);
  assert.equal(f.table('mail').get(custom).MAIL_TOTAL_FEE, plainFee + 250);
  for (const [bad, key] of [[21, 'b1'], [-1, 'b2'], ['1.234', 'b3'], ['abc', 'b4'], ['20.01', 'b5']]) {
    await assert.rejects(() => f.service.insertMail('poster', { forms: withTip(f, bad), requestId: f.req(key) }), /小费/);
  }
});

test('详情页显示「含小费」，没有小费时不显示', () => {
  const now = Date.now();
  const mail = tip => ({ MAIL_STATUS: 0, MAIL_END_TIME: now + 3600000, MAIL_OBJ: { serviceType: 'take', price: 5, tip }, MAIL_TOTAL_FEE: 500 });
  assert.equal(MailUI.detail(mail(2), now).tipText, '含小费 ¥2');
  assert.equal(MailUI.detail(mail(0), now).tipText, '');
  assert.equal(MailUI.detail({ ...mail(2), MAIL_OBJ: { serviceType: 'send', price: 5, tip: 2 } }, now).tipText, '');
});

test('先同意过调价、后一次被拒再放弃接单：订单恢复为发布人最初的价格', async () => {
  const f = await accepted();
  const original = f.mail().MAIL_TOTAL_FEE;
  await propose(f, ((original + 500) / 100).toFixed(2), '实际是大件', 'p1');
  await respond(f, 'agree', 'r1');
  assert.equal(f.mail().MAIL_TOTAL_FEE, original + 500);
  await propose(f, ((original + 1200) / 100).toFixed(2), '包裹超重', 'p2');
  assert.equal(f.mail().MAIL_PRICE_ADJUST.base, original, '多次申请仍记住最初价格');
  await respond(f, 'reject', 'r2');
  await f.service.releaseMail('rider', f.id, { requestId: f.req('release') });
  assert.equal(f.mail().MAIL_TOTAL_FEE, original);
  assert.equal(f.mail().MAIL_OBJ.price, original / 100);
  assert.match(f.notes('release')[0].content, new RegExp('¥' + (original / 100).toFixed(2).replace('.', '\.')));
});

test('异常恢复到待收货后重新计时 8 小时，不会被立刻自动确认', async () => {
  const f = await accepted();
  await pickup(f);
  await f.service.deliverMail('rider', f.id, { requestId: f.req('deliver'), note: '已放到门口', images: ['cloud://bucket/private-evidence/rider/one.png'] });
  const old = Date.now() - 9 * 3600000;
  f.table('mail').set(f.id, { ...f.mail(), MAIL_DELIVERED_TIME: old, MAIL_AUTO_CONFIRM_AT: old + 8 * 3600000 });
  await f.service.exceptionMail('poster', f.id, { requestId: f.req('exception'), reason: '物品损坏', note: '外包装破损' });
  await f.service.resolveMail('admin', f.id, { requestId: f.req('resolve'), resolution: 'resume', note: '核实后恢复' });
  assert.equal(f.mail().MAIL_STATUS, 2);
  assert.ok(f.mail().MAIL_DELIVERED_TIME > Date.now() - 60000, '送达时间按恢复时刻重新计算');
  assert.ok(f.mail().MAIL_AUTO_CONFIRM_AT > Date.now() + 7 * 3600000);
});
