'use strict';
// 积分：订单完成 +100、邀请首单双方 +300、幂等与防刷，以及 point/my 的归属校验。
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('../test-support/operations-fixture.cjs');

const proof = ['cloud://bucket/private-evidence/rider/pickup.png'];
const delivered = { note: '已送达', images: ['cloud://bucket/private-evidence/rider/proof.png'] };

async function accepted(f, key = 'one') {
  // 每单用不同的 requestId，避免命中上一次发布的幂等结果。
  const id = await f.publish({ requestId: f.req('publish-' + key) }, 'poster');
  await f.service.acceptMail('rider', id, { requestId: f.req('accept-' + key) });
  return id;
}
async function delivered_(f, id, key = 'one') {
  await f.service.pickupMail('rider', id, { requestId: f.req('pickup-' + key), images: proof });
  await f.service.deliverMail('rider', id, { requestId: f.req('deliver-' + key), ...delivered });
}
async function completed(f, id, key = 'one') {
  await delivered_(f, id, key);
  await f.service.finishMail('poster', id, { requestId: f.req('confirm-' + key) });
}
const logs = (f, userId) => [...f.table('point_log').values()].filter(row => row.userId === userId);
const balance = (f, userId) => Number(f.table('user').get(userId).USER_POINTS) || 0;
function bindInvite(f, inviter, invitee, status = 1) {
  const id = f.store.key('crun', 'invite-accept', invitee);
  f.table('invite').set(id, {
    _id: id, _pid: 'crun', INV_KIND: 'accept', INV_USER_ID: inviter, INV_USER_NAME: inviter,
    INV_ACCEPT_USER_ID: invitee, INV_ACCEPT_USER_NAME: invitee, INV_CODE: 'ABCDEF',
    INV_STATUS: status, INV_REWARD_STATUS: 0, INV_ADD_TIME: 1, INV_ACCEPT_TIME: 1
  });
  return id;
}

test('发单人确认收货 +100，积分日志与余额在同一个事务里', async () => {
  const f = fixture(), id = await accepted(f);
  await completed(f, id);
  assert.equal(f.table('mail').get(id).MAIL_STATUS, 9);
  assert.equal(balance(f, 'poster'), 100);
  const rows = logs(f, 'poster');
  assert.equal(rows.length, 1);
  assert.deepEqual({ change: rows[0].change, reason: rows[0].reason, orderId: rows[0].orderId }, { change: 100, reason: 'post_complete', orderId: id });
  assert.ok(rows[0].at > 0);
  assert.equal(balance(f, 'rider'), 0, '接单骑手不加完成分');
});

test('送达满 8 小时自动确认收货同样 +100', async () => {
  const f = fixture(), id = await accepted(f);
  await delivered_(f, id);
  const mail = f.table('mail').get(id);
  mail.MAIL_DELIVERED_TIME = Date.now() - 8 * 3600000 - 1000;
  const Maintenance = f.load('maintenance_service.js');
  await new Maintenance()._sweep(id, 'auto_confirm');
  const row = f.table('mail').get(id);
  assert.equal(row.MAIL_STATUS, 9);
  assert.equal(row.MAIL_AUTO_CONFIRMED, true);
  assert.equal(balance(f, 'poster'), 100);
  assert.equal(logs(f, 'poster').length, 1);
});

test('重复请求、重放和二次调用都只发一次积分', async () => {
  const f = fixture(), id = await accepted(f);
  await delivered_(f, id);
  await f.service.finishMail('poster', id, { requestId: f.req('confirm') });
  assert.equal(balance(f, 'poster'), 100);
  // 同一个 requestId 重放：走幂等记录，不再加分。
  await f.service.finishMail('poster', id, { requestId: f.req('confirm') });
  assert.equal(balance(f, 'poster'), 100);
  // 新的 requestId 也不允许重复确认。
  await assert.rejects(() => f.service.finishMail('poster', id, { requestId: f.req('confirm-again') }), /仅发布者可确认/);
  // 直接重放积分发放逻辑：同键日志已存在，返回 false 且余额不变。
  const service = new (f.load('point_service.js'))();
  const replay = await f.store.transaction(tx => service.awardOrderCompleted(tx, f.table('mail').get(id)));
  assert.equal(replay.poster, false); assert.equal(replay.invite, false);
  assert.equal(balance(f, 'poster'), 100);
  assert.equal(logs(f, 'poster').length, 1);
});

test('被邀请人首单完成，双方各 +300；第二单不再给邀请奖励', async () => {
  const f = fixture();
  bindInvite(f, 'other', 'poster');
  const first = await accepted(f, 'first');
  await completed(f, first, 'first');
  assert.equal(balance(f, 'poster'), 400, '首单：完成 100 + 邀请 300');
  assert.equal(balance(f, 'other'), 300, '邀请人 +300');
  assert.equal(f.table('invite').get(f.store.key('crun', 'invite-accept', 'poster')).INV_REWARD_STATUS, 1);
  const inviteRows = [...f.table('point_log').values()].filter(row => row.reason === 'invite_first_order');
  assert.equal(inviteRows.length, 2);
  assert.deepEqual(inviteRows.map(row => row.userId).sort(), ['other', 'poster']);
  assert.ok(inviteRows.every(row => row.change === 300 && row.orderId === first));

  // 第二单只加完成分，邀请奖励不再发。
  const second = await accepted(f, 'second');
  await completed(f, second, 'second');
  assert.equal(balance(f, 'poster'), 500);
  assert.equal(balance(f, 'other'), 300);
  assert.equal([...f.table('point_log').values()].filter(row => row.reason === 'invite_first_order').length, 2);
});

test('骑手就是邀请人时，订单照常完成但不给邀请奖励', async () => {
  const f = fixture();
  bindInvite(f, 'rider', 'poster');
  const id = await accepted(f);
  await completed(f, id);
  assert.equal(balance(f, 'poster'), 100);
  assert.equal(balance(f, 'rider'), 0, '邀请人兼骑手不拿邀请奖励');
  assert.equal(f.table('invite').get(f.store.key('crun', 'invite-accept', 'poster')).INV_REWARD_STATUS, 0);
  assert.equal([...f.table('point_log').values()].filter(row => row.reason === 'invite_first_order').length, 0);
});

test('被邀请人只下单未完成：状态是「已使用」，但不给积分', async () => {
  const f = fixture();
  bindInvite(f, 'other', 'poster');
  const service = new (f.load('invite_service.js'))();
  const id = await f.publish({ requestId: f.req('publish-used') }, 'poster');
  const stat = await service.getMyInviteStat('other');
  assert.equal(stat.total, 1); assert.equal(stat.accepted, 1);
  assert.equal(stat.used, 1); assert.equal(stat.rewarded, 0); assert.equal(stat.pending, 0);
  const list = await service.getMyInviteList('other');
  assert.equal(list.list[0].state, 'used');
  assert.equal(list.list[0].stateText, '已使用');
  assert.equal(balance(f, 'poster'), 0);
  assert.equal(logs(f, 'other').length, 0);
  // 完成后转为「已得奖励」，双方各 +300。
  await f.service.acceptMail('rider', id, { requestId: f.req('accept-used') });
  await completed(f, id, 'used');
  const after = await service.getMyInviteStat('other');
  assert.equal(after.used, 1);
  assert.equal(after.rewarded, 1);
  assert.equal((await service.getMyInviteList('other')).list[0].stateText, '已得奖励');
  assert.equal(balance(f, 'other'), 300);
});

test('邀请关系未审核通过（待审核 / 未通过）时，首单完成不发邀请奖励', async () => {
  for (const [status, key] of [[0, 'pending'], [2, 'rejected']]) {
    const f = fixture();
    const inviteId = bindInvite(f, 'other', 'poster', status);
    const id = await accepted(f, key);
    await completed(f, id, key);
    assert.equal(balance(f, 'poster'), 100, '完成分照常发');
    assert.equal(balance(f, 'other'), 0, '邀请人不得分');
    assert.equal(f.table('invite').get(inviteId).INV_REWARD_STATUS, 0, '奖励状态保持未发放');
    assert.equal([...f.table('point_log').values()].filter(row => row.reason === 'invite_first_order').length, 0);
  }
});

test('假事务与真实云开发一致：事务里 where 查询直接报错', async () => {
  const f = fixture();
  await assert.rejects(() => f.store.transaction(tx => tx.collection('bx_mail').where({ MAIL_STATUS: 9 }).get()),
    /事务内只能按 _id 读写文档/);
});

test('未绑定邀请关系、或还没注册的好友不会产生邀请奖励', async () => {
  const f = fixture();
  const id = await accepted(f);
  await completed(f, id);
  assert.equal(balance(f, 'poster'), 100);
  assert.equal(balance(f, 'other'), 0);
  assert.equal([...f.table('point_log').values()].filter(row => row.reason === 'invite_first_order').length, 0);
});

test('point/my 只返回本人的余额与明细，并按时间倒序分页', async () => {
  const f = fixture(), service = new (f.load('point_service.js'))();
  await f.store.transaction(tx => service._award(tx, { userId: 'poster', change: 100, reason: 'post_complete', orderId: 'order-a' }));
  await f.store.transaction(tx => service._award(tx, { userId: 'poster', change: 300, reason: 'invite_first_order', orderId: 'order-b', relatedUserId: 'other' }));
  await f.store.transaction(tx => service._award(tx, { userId: 'other', change: 300, reason: 'invite_first_order', orderId: 'order-b', relatedUserId: 'poster' }));

  const mine = await service.my('poster', { page: 1, size: 1 });
  assert.equal(mine.points, 400);
  assert.equal(mine.list.length, 1);
  assert.equal(mine.hasMore, true);
  const second = await service.my('poster', { page: 2, size: 1 });
  assert.equal(second.list.length, 1);
  assert.equal(second.hasMore, false);
  assert.notEqual(second.list[0].id, mine.list[0].id);
  // 同一毫秒写入时按 _id 兜底排序，两页合起来正好是本人的两笔。
  assert.deepEqual([...mine.list, ...second.list].map(row => row.change).sort(), [100, 300]);

  const other = await service.my('other');
  assert.equal(other.points, 300);
  assert.deepEqual(other.list.map(row => row.orderId), ['order-b']);
  assert.ok(!other.list.some(row => row.reason === 'post_complete'));
});

// ---- 积分商城：兑换免费打印券 ----
// 兑换机制的用例按商品已上架处理；目录默认全部下架，见下方「下架」用例。
const redeemSvc = f => Object.assign(new (f.load('point_service.js'))(), { onShelf: () => true });
const setPoints = (f, userId, points) => { f.table('user').get(userId).USER_POINTS = points; };
const redeemRows = (f, userId) => logs(f, userId).filter(row => row.reason === 'redeem');

test('兑换成功：扣 100 分、生成 8 位券码、写一条负数积分日志', async () => {
  const f = fixture(), service = redeemSvc(f);
  setPoints(f, 'poster', 1968);
  const result = await service.redeem('poster', { itemId: 'print_free', requestId: f.req('redeem-a') });
  assert.equal(balance(f, 'poster'), 1868);
  assert.equal(result.points, 1868);
  assert.match(result.code, /^[A-Z0-9]{8}$/);
  assert.equal(result.statusText, '未使用');
  assert.equal(result.hint, '到打印店出示后点「确认核销」');
  assert.equal(result.icon, 'print');
  assert.equal(result.usedAt, '');
  const rows = redeemRows(f, 'poster');
  assert.equal(rows.length, 1);
  assert.deepEqual({ change: rows[0].change, reason: rows[0].reason, itemId: rows[0].itemId, itemName: rows[0].itemName, code: rows[0].code },
    { change: -100, reason: 'redeem', itemId: 'print_free', itemName: '免费打印券', code: result.code });
  assert.equal(rows[0]._id, f.store.schoolKey('crun', 'point', 'redeem', f.req('redeem-a'), 'poster'));
});

test('积分不足时拒绝，余额与日志都不变；商品必须存在，价格只认云端目录', async () => {
  const f = fixture(), service = redeemSvc(f);
  setPoints(f, 'poster', 99);
  await assert.rejects(() => service.redeem('poster', { itemId: 'print_free', requestId: f.req('poor') }), /积分不足，还差 1 积分/);
  assert.equal(balance(f, 'poster'), 99);
  assert.equal(redeemRows(f, 'poster').length, 0);
  await assert.rejects(() => service.redeem('poster', { itemId: 'nope', cost: 1, requestId: f.req('nope') }), /商品不存在/);
  await assert.rejects(() => service.redeem('poster', { itemId: 'print_free', requestId: 'short' }), /请求标识/);
  assert.deepEqual(JSON.parse(JSON.stringify((await service.items('poster')).items.map(({ id, name, cost, icon }) => ({ id, name, cost, icon })))), [
    { id: 'print_free', name: '免费打印券', cost: 100, icon: 'print' },
    { id: 'sto_minus3', name: '立减3元券', cost: 500, icon: 'sto' },
    { id: 'free_order', name: '免单特权', cost: 1000, icon: 'official' }
  ]);
  await assert.rejects(() => service.redeem('ghost', { itemId: 'print_free', requestId: f.req('ghost') }), /注册/);
});

test('同一个 requestId 重复提交只扣一次分，返回同一张券', async () => {
  const f = fixture(), service = redeemSvc(f);
  setPoints(f, 'poster', 250);
  const input = { itemId: 'print_free', requestId: f.req('same') };
  const first = await service.redeem('poster', input);
  const second = await service.redeem('poster', input);
  assert.equal(second.code, first.code);
  assert.equal(second.alreadyRedeemed, true);
  assert.equal(second.points, 150);
  assert.equal(balance(f, 'poster'), 150);
  assert.equal(redeemRows(f, 'poster').length, 1);
  // 同一时刻并发提交同一个请求也只成功一次。
  const [a, b] = await Promise.all([1, 2].map(() => service.redeem('poster', { itemId: 'print_free', requestId: f.req('parallel') })));
  assert.equal(a.code, b.code);
  assert.equal(balance(f, 'poster'), 50);
  assert.equal(redeemRows(f, 'poster').length, 2);
});

test('不同请求并发兑换：余额只够一张时只成功一张，余额不会变负', async () => {
  const f = fixture(), service = redeemSvc(f);
  setPoints(f, 'poster', 100);
  const results = await Promise.allSettled([1, 2, 3].map(i => service.redeem('poster', { itemId: 'print_free', requestId: f.req('race-' + i) })));
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(results.filter(item => item.status === 'rejected').length, 2);
  assert.equal(balance(f, 'poster'), 0);
  assert.equal(redeemRows(f, 'poster').length, 1);
});

test('兑换对新请求限流、重放不占额度；限流触发时不扣分', async () => {
  const f = fixture(), limited = [];
  f.store.limit = async (...args) => { limited.push(args); };
  setPoints(f, 'poster', 400);
  const service = redeemSvc(f);
  const input = { itemId: 'print_free', requestId: f.req('limit') };
  await service.redeem('poster', input);
  await service.redeem('poster', input);
  assert.equal(limited.length, 1, '重放不占用限流额度');
  assert.deepEqual(limited[0].slice(1), ['poster', 'point_redeem', 5, 60000]);
  f.store.limit = async () => { throw new Error('操作过于频繁，请稍后再试'); };
  await assert.rejects(() => service.redeem('poster', { itemId: 'print_free', requestId: f.req('limit-2') }), /频繁/);
  assert.equal(balance(f, 'poster'), 300);
});

test('point/vouchers 只返回本人的券，分页，且不接受客户端 userId', async () => {
  const f = fixture(), service = redeemSvc(f);
  setPoints(f, 'poster', 1000); setPoints(f, 'other', 1000);
  for (const i of [1, 2, 3]) await service.redeem('poster', { itemId: 'print_free', requestId: f.req('mine-' + i) });
  await service.redeem('other', { itemId: 'print_free', requestId: f.req('theirs') });
  await f.store.transaction(tx => service._award(tx, { userId: 'poster', change: 100, reason: 'post_complete', orderId: 'o1' }));
  const first = await service.vouchers('poster', { page: 1, size: 2 });
  assert.equal(first.total, 3);
  assert.equal(first.list.length, 2);
  assert.equal(first.hasMore, true);
  const second = await service.vouchers('poster', { page: 2, size: 2 });
  assert.equal(second.list.length, 1);
  const mineCodes = redeemRows(f, 'poster').map(row => row.code).sort();
  assert.deepEqual([...first.list, ...second.list].map(item => item.code).sort(), mineCodes);
  assert.ok(first.list.every(item => item.itemName === '免费打印券' && item.statusText === '未使用'));
  assert.equal((await service.vouchers('other')).total, 1);
  const controllerSource = fs.readFileSync(path.resolve(__dirname, '../../cloudfunctions/mcloud/project/crun/controller/point_controller.js'), 'utf8');
  assert.doesNotMatch(controllerSource.slice(controllerSource.indexOf('async vouchers')), /userId:/);
  const routes = fs.readFileSync(path.resolve(__dirname, '../../cloudfunctions/mcloud/project/crun/public/route.js'), 'utf8');
  for (const route of ['point/items', 'point/redeem', 'point/vouchers']) assert.ok(routes.includes("'" + route + "'"), route);
});

test('积分明细里能看到兑换扣分：兑换免费打印券 -100', async () => {
  const f = fixture(), service = redeemSvc(f);
  setPoints(f, 'poster', 0);
  await f.store.transaction(tx => service._award(tx, { userId: 'poster', change: 300, reason: 'invite_first_order', orderId: 'x', relatedUserId: 'other' }));
  await service.redeem('poster', { itemId: 'print_free', requestId: f.req('detail') });
  const mine = await service.my('poster');
  assert.equal(mine.points, 200);
  const row = mine.list.find(item => item.reason === 'redeem');
  assert.equal(row.change, -100);
  assert.equal(row.reasonText, '兑换免费打印券');
  assert.ok(mine.list.some(item => item.change === 300));
});

// ---- 防刷：跨校区重复绑定、互相邀请 ----
test('被邀请人在别的校区已经拿过首单奖励：本校区首单不再发邀请奖励', async () => {
  const f = fixture(), service = new (f.load('point_service.js'))();
  // 模拟另一个校区的首单奖励：被邀请人日志用学校内固定键，与校区无关。
  await f.store.transaction(tx => service._award(tx, { userId: 'poster', change: 300, reason: 'invite_first_order', orderId: 'campus-b-order', relatedUserId: 'rider2', key: 'invitee', role: 'invitee' }));
  bindInvite(f, 'other', 'poster');
  const id = await accepted(f);
  await completed(f, id);
  assert.equal(balance(f, 'poster'), 400, '只多了本单完成分 100');
  assert.equal(balance(f, 'other'), 0, '第二个邀请人拿不到');
  assert.equal(f.table('invite').get(f.store.key('crun', 'invite-accept', 'poster')).INV_REWARD_STATUS, 0);
});

test('被邀请人在别的校区已经完成过订单：本校区的单不算首单', async () => {
  const f = fixture(), service = new (f.load('point_service.js'))();
  // 别的校区的 mail 在本校区查不到，只能靠学校级的 point_log 识别。
  await f.store.transaction(tx => service._award(tx, { userId: 'poster', change: 100, reason: 'post_complete', orderId: 'campus-b-order' }));
  bindInvite(f, 'other', 'poster');
  const id = await accepted(f);
  await completed(f, id);
  assert.equal(balance(f, 'poster'), 200);
  assert.equal(balance(f, 'other'), 0);
});

test('首单奖励日志标明角色，邀请人按被邀请人去重', async () => {
  const f = fixture();
  bindInvite(f, 'other', 'poster');
  const id = await accepted(f);
  await completed(f, id);
  const rows = [...f.table('point_log').values()].filter(row => row.reason === 'invite_first_order');
  assert.deepEqual(rows.map(row => [row.userId, row.role]).sort(), [['other', 'inviter'], ['poster', 'invitee']]);
});

test('不能互相邀请：已被 B 邀请的 A，B 不能再用 A 的码', async () => {
  const f = fixture(), invite = new (f.load('invite_service.js'))();
  const { code: posterCode } = await invite.getOrCreateMyInviteCode('poster');
  const { code: otherCode } = await invite.getOrCreateMyInviteCode('other');
  const first = await invite.acceptInvite('poster', otherCode);
  assert.equal(first.accepted, true);
  const reverse = await invite.acceptInvite('other', posterCode);
  assert.equal(reverse.accepted, false);
  assert.match(reverse.reason, /互相邀请/);
  assert.equal(f.table('invite').get(f.store.key('crun', 'invite-accept', 'other')), undefined);
  // 第三个人照常可以用 poster 的码。
  assert.equal((await invite.acceptInvite('rider', posterCode)).accepted, true);
});

// ---- 超级管理员调整积分 ----
const admin = { _id: 'admin', ADMIN_NAME: '平台' };
test('超管赠送积分：写审计日志、加余额，同一请求重复提交只加一次', async () => {
  const f = fixture(), service = redeemSvc(f);
  const input = { userId: 'poster', amount: 500, note: '内测验证兑换', requestId: f.req('grant-a') };
  const result = await service.adminGrant(admin, input);
  assert.equal(result.points, 500); assert.equal(result.alreadyApplied, false);
  const again = await service.adminGrant(admin, input);
  assert.equal(again.alreadyApplied, true);
  assert.equal(balance(f, 'poster'), 500);
  const rows = logs(f, 'poster');
  assert.equal(rows.length, 1);
  assert.deepEqual({ change: rows[0].change, reason: rows[0].reason, adminId: rows[0].adminId, note: rows[0].note }, { change: 500, reason: 'admin_grant', adminId: 'admin', note: '内测验证兑换' });
  // 赠送后能直接兑换，明细显示「平台赠送」。
  await service.redeem('poster', { itemId: 'print_free', requestId: f.req('redeem-after-grant') });
  assert.equal(balance(f, 'poster'), 400);
  const mine = await service.my('poster');
  assert.ok(mine.list.some(row => row.reasonText === '平台赠送' && row.change === 500));
  await assert.rejects(() => service.adminGrant(admin, { ...input, amount: 600 }), /相同请求标识/);
});

test('超管扣回积分：显示「平台扣减」，余额不能扣成负数', async () => {
  const f = fixture(), service = redeemSvc(f);
  setPoints(f, 'poster', 300);
  await assert.rejects(() => service.adminGrant(admin, { userId: 'poster', amount: -301, note: '测试结束扣回', requestId: f.req('deduct-over') }), /余额不能为负/);
  assert.equal(balance(f, 'poster'), 300);
  assert.equal(logs(f, 'poster').length, 0);
  const done = await service.adminGrant(admin, { userId: 'poster', amount: -300, note: '测试结束扣回', requestId: f.req('deduct-ok') });
  assert.equal(done.points, 0);
  assert.equal((await service.my('poster')).list[0].reasonText, '平台扣减');
});

test('调整积分参数校验：非零整数、单次 ±1000、必须写原因、用户必须存在', async () => {
  const f = fixture(), service = redeemSvc(f);
  const base = { userId: 'poster', amount: 100, note: '补偿', requestId: f.req('grant-check') };
  for (const amount of [0, 1001, -1001, 1.5, NaN]) await assert.rejects(() => service.adminGrant(admin, { ...base, amount }), /非零整数/);
  await assert.rejects(() => service.adminGrant(admin, { ...base, note: '  ' }), /调整原因/);
  await assert.rejects(() => service.adminGrant(admin, { ...base, userId: 'nobody' }), /用户不存在/);
  await assert.rejects(() => service.adminGrant(admin, { ...base, requestId: 'short' }), /请求标识/);
  await assert.rejects(() => service.adminGrant(null, base), /管理员/);
  assert.equal(balance(f, 'poster'), 0);
});

test('调整积分接口只给初始管理员和超管：控制器校验角色，客服和管理员被拒绝', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../cloudfunctions/mcloud/project/crun/controller/admin/admin_user_controller.js'), 'utf8');
  const body = source.slice(source.indexOf('async pointGrant()'));
  assert.match(body, /Roles\.operatorRole\(this\._admin\)/);
  assert.match(body, /role !== 'root' && role !== 'super'/);
  const routes = require('../../cloudfunctions/mcloud/project/crun/public/route.js');
  assert.equal(routes['admin/user_point_grant'], 'admin/admin_user_controller@pointGrant#demo');
  const roles = require('../../cloudfunctions/mcloud/project/crun/service/admin/admin_roles.js');
  assert.equal(roles.operatorRole({ ADMIN_ROLE: 'admin' }), 'admin');
  assert.equal(roles.operatorRole({ ADMIN_ROLE: 'service' }), 'service');
  assert.equal(roles.operatorRole({ ADMIN_ROLE: 'super' }), 'super');
});

// ---- 核销：本人当面确认，记录使用时间 ----
test('核销：未使用 → 已使用并记录使用时间；重复核销返回 alreadyUsed 且保留第一次时间；不改余额', async () => {
  const f = fixture(), service = redeemSvc(f);
  setPoints(f, 'poster', 1600);
  const sto = await service.redeem('poster', { itemId: 'sto_minus3', requestId: f.req('use-sto') });
  const free = await service.redeem('poster', { itemId: 'free_order', requestId: f.req('use-free') });
  assert.deepEqual([sto.icon, free.icon, sto.status, sto.usedAt], ['sto', 'official', 'unused', '']);
  assert.equal(balance(f, 'poster'), 100);
  const used = await service.useVoucher('poster', { id: sto.id });
  assert.deepEqual([used.status, used.statusText, used.alreadyUsed], ['used', '已使用', false]);
  assert.ok(used.usedAt, '核销后返回使用时间');
  const firstAt = redeemRows(f, 'poster').find(row => row.itemId === 'sto_minus3').usedAt;
  assert.ok(firstAt > 0);
  const again = await service.useVoucher('poster', { id: sto.id });
  assert.equal(again.alreadyUsed, true);
  assert.equal(redeemRows(f, 'poster').find(row => row.itemId === 'sto_minus3').usedAt, firstAt);
  assert.equal(balance(f, 'poster'), 100);
  // 已兑换列表里能看到使用时间，另一张仍是未使用。
  const list = (await service.vouchers('poster')).list;
  const stoView = list.find(item => item.id === sto.id), freeView = list.find(item => item.id === free.id);
  assert.deepEqual([stoView.status, stoView.usedAt], ['used', used.usedAt]);
  assert.deepEqual([freeView.status, freeView.usedAt], ['unused', '']);
});

test('核销：别人的券、不存在的券、非兑换记录都报「券不存在」，且限流', async () => {
  const f = fixture(), limited = [];
  const service = redeemSvc(f);
  setPoints(f, 'poster', 100); setPoints(f, 'other', 100);
  const mine = await service.redeem('poster', { itemId: 'print_free', requestId: f.req('own') });
  await f.store.transaction(tx => service._award(tx, { userId: 'other', change: 100, reason: 'post_complete', orderId: 'o9' }));
  const awardId = logs(f, 'other').find(row => row.reason === 'post_complete')._id;
  await assert.rejects(() => service.useVoucher('other', { id: mine.id }), /券不存在/);
  await assert.rejects(() => service.useVoucher('poster', { id: 'missing' }), /券不存在/);
  await assert.rejects(() => service.useVoucher('other', { id: awardId }), /券不存在/);
  await assert.rejects(() => service.useVoucher('poster', { id: '' }), /券不存在/);
  await assert.rejects(() => service.useVoucher('ghost', { id: mine.id }), /注册/);
  assert.equal(redeemRows(f, 'poster')[0].usedAt, 0);
  f.store.limit = async (...args) => { limited.push(args); };
  await service.useVoucher('poster', { id: mine.id });
  assert.deepEqual(limited[0].slice(1), ['poster', 'point_use', 10, 60000]);
  const routes = fs.readFileSync(path.resolve(__dirname, '../../cloudfunctions/mcloud/project/crun/public/route.js'), 'utf8');
  assert.ok(routes.includes("'point/use': 'point_controller@use'"));
});

test('积分商品全部下架：列表不返回商品，兑换被拒绝且不扣分；已兑换的券仍可核销', async () => {
  const f = fixture(), shelf = new (f.load('point_service.js'))(), open = redeemSvc(f);
  setPoints(f, 'poster', 2000);
  const voucher = await open.redeem('poster', { itemId: 'print_free', requestId: f.req('before-off-shelf') });
  const listed = await shelf.items('poster');
  assert.deepEqual(JSON.parse(JSON.stringify(listed.items)), []);
  await assert.rejects(() => shelf.redeem('poster', { itemId: 'sto_minus3', requestId: f.req('off-shelf') }), /待上架/);
  assert.equal(balance(f, 'poster'), 1900);
  assert.equal(redeemRows(f, 'poster').length, 1);
  // 同一请求的重试仍返回第一次的券码，不因下架报错。
  assert.equal((await shelf.redeem('poster', { itemId: 'print_free', requestId: f.req('before-off-shelf') })).code, voucher.code);
  await shelf.useVoucher('poster', { id: voucher.id });
  const page = fs.readFileSync(path.resolve(__dirname, '../../miniprogram/projects/crun/pages/my/wallet/wallet.wxml'), 'utf8');
  assert.match(page, /<text class="mall-empty-title">商品待上架<\/text>/);
  assert.doesNotMatch(page, /onShelf|mall-off-tag|mall-card-off/);
  assert.doesNotMatch(fs.readFileSync(path.resolve(__dirname, '../../miniprogram/projects/crun/pages/my/wallet/wallet.js'), 'utf8'), /onShelf|offShelf/);
});
