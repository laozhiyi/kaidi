'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('../test-support/operations-fixture.cjs');

async function complete(f, label = 'one', poster = 'poster', rider = 'rider') {
  const id = await f.publish({ requestId: f.req('publish-' + label) }, poster);
  await f.service.acceptMail(rider, id, { requestId: f.req('accept-' + label) });
  await f.service.pickupMail(rider, id, { requestId: f.req('pickup-' + label) });
  await f.service.deliverMail(rider, id, { requestId: f.req('deliver-' + label), note: '放在门口', images: ['cloud://delivery-proof'] });
  await f.service.finishMail(poster, id, { requestId: f.req('finish-' + label) });
  return id;
}
const review = (f, orderId, score = 5, request = 'review') => ({ orderId, score, content: '沟通及时', requestId: f.req(request) });
async function complaint(f, orderId, userId = 'poster', request = 'complaint') {
  const service = new (f.load('feedback_service.js'))();
  const { id } = await service.insertFeedback(userId, { orderId, type: 'complain', title: '订单申诉', content: '请核实本次服务', requestId: f.req(request) });
  return { id, service };
}

test('order favorites are durable, idempotent under racing taps, visible to every viewer and removable after acceptance', async () => {
  const f = fixture(), id = await f.publish(), service = new (f.load('fav_service.js'))();
  await Promise.all([service.updateFav('rider', id, 'mail', true), service.updateFav('rider', id, 'mail', true), service.updateFav('other', id, 'mail', true)]);
  assert.equal(f.table('fav').size, 2);
  const mine = (await service.orderStats('rider', [id])).list[0];
  assert.equal(mine.count, 2); assert.equal(mine.isFav, true); assert.equal(mine.available, true);
  const publicStat = (await service.orderStats('', [id])).list[0];
  assert.equal(publicStat.count, 2); assert.equal(publicStat.isFav, false);
  const list = await f.service.getMailList('rider2', { sortType: 'wait' });
  assert.equal(list.list[0].MAIL_FAV_CNT, 2); assert.equal(list.list[0].MAIL_IS_FAV, false);
  const detail = await f.service.viewMail('rider', id);
  assert.equal(detail.MAIL_FAV_CNT, 2); assert.equal(detail.MAIL_IS_FAV, true);
  assert.equal(detail.MAIL_OBJ.code, undefined); assert.equal(detail.MAIL_FAV_LIST, undefined);
  const saved = (await service.getMyFavList('rider')).list[0];
  assert.equal(saved.FAV_IS_ORDER, true); assert.equal(saved.FAV_ORDER_STATUS, '可接单'); assert.equal(saved.FAV_COUNT, 2);
  await f.service.acceptMail('rider2', id, { requestId: f.req('accept') });
  await assert.rejects(service.updateFav('poster', id, 'mail', true), /不可接单/);
  await service.updateFav('rider', id, 'mail', false);
  assert.equal((await service.orderStats('', [id])).list[0].count, 1);
  await service.delFav('other', id);
  assert.equal((await service.orderStats('', [id])).list[0].count, 0);
});

test('legacy order favorites count immediately, while missing and foreign orders cannot be collected', async () => {
  const f = fixture(), id = await f.publish(), service = new (f.load('fav_service.js'))();
  f.table('fav').set('old', { _id: 'old', _pid: 'crun', FAV_USER_ID: 'rider', FAV_OID: id, FAV_TYPE: '快递代取', FAV_TITLE: '旧收藏', FAV_ADD_TIME: 1 });
  f.table('fav').set('foreign', { _id: 'foreign', _pid: 'other', FAV_USER_ID: 'other', FAV_OID: id, FAV_TYPE: 'mail' });
  assert.equal((await service.orderStats('rider', [id])).list[0].count, 1);
  await service.updateFav('rider', id, 'mail', true); assert.equal(f.table('fav').size, 2);
  await assert.rejects(service.updateFav('poster', id, 'mail', true), /不可接单/);
  await assert.rejects(service.updateFav('guest', id, 'mail', true), /注册/);
  f.table('mail').get(id).MAIL_END_TIME = Date.now() - 1;
  await assert.rejects(service.updateFav('other', id, 'mail', true), /不可接单/);
  f.table('mail').get(id)._pid = 'elsewhere';
  assert.equal((await service.orderStats('rider', [id])).list[0].count, 0);
  await assert.rejects(service.updateFav('other', id, 'mail', true), /不存在/);
  f.table('mail').delete(id);
  const saved = (await service.getMyFavList('rider')).list[0];
  assert.equal(saved.FAV_MISSING, true); assert.equal(saved.FAV_PATH, '');
  assert.equal((await service.delFav('rider', id)).effect, 1);
  assert.equal((await service.delFav('rider', id)).effect, 0);
  await assert.rejects(service.orderStats('', Array(51).fill(id)), /最多/);
  await assert.rejects(service.orderStats('', [{ id }]), /编号/);
  await assert.rejects(service.updateFav('rider', id, 'mail', 'true'), /收藏状态/);
});

test('every order participant can rate the other user after completion and only received ratings affect reputation', async () => {
  const f = fixture(), id = await complete(f), service = new (f.load('review_service.js'))(), reputation = new (f.load('reputation_service.js'))();
  assert.equal((await reputation.summary('rider')).score, 80);
  assert.equal((await service.context('poster', id)).targetRole, '接单人');
  assert.equal((await service.context('rider', id)).targetRole, '发布者');
  await service.insert('poster', review(f, id, 5));
  await service.insert('rider', review(f, id, 1));
  assert.equal((await reputation.summary('rider')).score, 84);
  assert.equal((await reputation.summary('poster')).score, 76);
  assert.equal((await reputation.summary('other')).score, 80);
  const view = await f.service.viewMail('poster', id);
  assert.equal(view.MAIL_REVIEWED, true); assert.equal(view.MAIL_CAN_REVIEW, false);
  assert.equal((await f.service.viewMail('other', id)).MAIL_REVIEWED, undefined);
  assert.equal((await service.context('rider', id)).canReview, false);
  assert.equal((await service.myList('rider', 1, 'received')).list[0].REVIEW_SCORE, 5);
  assert.equal((await service.myList('rider')).list[0].REVIEW_SCORE, 1);
  assert.equal((await service.myList('rider', 1, 'received')).list[0].REVIEW_REQUEST_ID, undefined);
  const records = await reputation.records('rider');
  assert.equal(records.list[0].points, 4); assert.equal(records.list[0].role, '发布者');
  await assert.rejects(service.context('other', id), /参与者/);
});

test('sent and received review lists expose public profiles and ratings without order or account metadata', async () => {
  const f = fixture();
  f.user('poster', { USER_NAME: '林同学', USER_PIC: 'cloud://lin-avatar', USER_MOBILE: '13911112222', USER_FORMS: [...f.table('user').get('poster').USER_FORMS, { mark: 'address', val: 'private-address' }] });
  f.user('rider', { USER_NAME: '陈同学', USER_PIC: 'cloud://chen-avatar' });
  const id = await complete(f), service = new (f.load('review_service.js'))();
  await service.insert('poster', review(f, id, 5));
  await service.insert('rider', review(f, id, 4));
  f.table('user').set('foreign-profile', { _id: 'foreign-profile', _pid: 'elsewhere', USER_MINI_OPENID: 'rider', USER_NAME: 'foreign-name', USER_PIC: 'foreign-avatar' });
  for (const [user, direction, name, avatar, score] of [
    ['poster', 'sent', '陈同学', 'cloud://chen-avatar', 5],
    ['poster', 'received', '陈同学', 'cloud://chen-avatar', 4],
    ['rider', 'sent', '林同学', 'cloud://lin-avatar', 4],
    ['rider', 'received', '林同学', 'cloud://lin-avatar', 5]
  ]) {
    const result = await service.myList(user, 1, direction);
    assert.equal(result.list.length, 1);
    const row = result.list[0];
    assert.deepEqual(Object.keys(row).sort(), ['_id', 'REVIEW_NAME', 'REVIEW_PIC', 'REVIEW_SCORE', 'REVIEW_CONTENT'].sort());
    assert.equal(row.REVIEW_NAME, name); assert.equal(row.REVIEW_PIC, avatar); assert.equal(row.REVIEW_SCORE, score); assert.equal(row.REVIEW_CONTENT, '沟通及时');
    assert.ok(!JSON.stringify(result).includes(id));
  }
  assert.equal((await service.myList('other', 1, 'received')).total, 0);
  await assert.rejects(service.myList('poster', 1, 'all'), /评价类型/);
  await assert.rejects(service.myList('guest'), /注册/);
  assert.equal(f.table('order_review').get(f.store.key('crun', id, 'poster')).REVIEW_ORDER_ID, id);
});

test('historical reviews remain readable when the order is unavailable or the counterpart has no profile', async () => {
  const f = fixture(), id = await complete(f), service = new (f.load('review_service.js'))();
  await service.insert('poster', review(f, id));
  f.table('mail').delete(id);
  f.table('user').delete('rider');
  const result = await service.myList('poster');
  assert.equal(result.list.length, 1); assert.equal(result.list[0].REVIEW_NAME, 'rider');
  assert.equal(result.list[0].REVIEW_PIC, ''); assert.equal(result.list[0].REVIEW_CONTENT, '沟通及时');
  assert.equal(result.list[0].REVIEW_ORDER_ID, undefined);
});

test('review retries and competing submissions cannot overwrite a rating or count it twice', async () => {
  const f = fixture(), id = await complete(f), service = new (f.load('review_service.js'))();
  const input = review(f, id);
  const [a, b] = await Promise.all([service.insert('poster', input), service.insert('poster', input)]);
  assert.equal(a.id, b.id); assert.equal(f.table('order_review').size, 1);
  await assert.rejects(service.insert('poster', { ...input, score: 1 }), /已经评价/);
  await assert.rejects(service.insert('poster', review(f, id, 1, 'new-request')), /已经评价/);
  const id2 = await complete(f, 'two');
  const results = await Promise.allSettled([service.insert('rider', review(f, id2, 1, 'a')), service.insert('rider', review(f, id2, 5, 'b'))]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(f.table('order_review').size, 2);
  assert.equal((await new (f.load('reputation_service.js'))().summary('rider')).reviews.count, 1);
});

test('unfinished, self, unrelated and foreign orders, invalid stars and revoked accounts cannot submit reviews', async () => {
  const f = fixture(), id = await f.publish(), service = new (f.load('review_service.js'))();
  await assert.rejects(service.insert('poster', review(f, id)), /已完成/);
  const completed = await complete(f, 'valid');
  for (const score of [0, 6, 2.5, NaN]) await assert.rejects(service.insert('poster', review(f, completed, score)), /评分/);
  await assert.rejects(service.insert('other', review(f, completed)), /参与者/);
  await assert.rejects(service.insert('poster', { ...review(f, completed), content: '文'.repeat(301) }), /评价内容/);
  await assert.rejects(service.insert('poster', { ...review(f, completed), requestId: 'short' }), /请求标识/);
  f.table('mail').get(completed).MAIL_ACCEPT_USER_ID = 'poster';
  await assert.rejects(service.insert('poster', review(f, completed)), /评价对象/);
  f.table('mail').get(completed)._pid = 'other';
  await assert.rejects(service.insert('poster', review(f, completed)), /参与者/);
  f.user('poster', { USER_STATUS: 9 });
  await assert.rejects(service.insert('poster', review(f, completed)), /注册/);
  assert.equal(f.table('order_review').size, 0);
});

test('review authorization is rechecked inside the transaction after a concurrent account suspension', async () => {
  const f = fixture(), id = await complete(f), service = new (f.load('review_service.js'))();
  const transaction = f.store.transaction;
  f.store.transaction = fn => { f.user('poster', { USER_STATUS: 9 }); return transaction(fn); };
  await assert.rejects(service.insert('poster', review(f, id)), /状态已变更/);
  assert.equal(f.table('order_review').size, 0);
});

test('pending complaints do not change reputation; reviewed stars target the counterpart and revisions replace the prior rating', async () => {
  const f = fixture(), orderId = await complete(f), { id, service } = await complaint(f, orderId), reputation = new (f.load('reputation_service.js'))();
  assert.equal(f.table('feedback').get(id).FB_TARGET_USER_ID, 'rider');
  assert.equal((await reputation.summary('rider')).score, 80);
  assert.equal((await service.getAdminFeedbackDetail(id)).FB_CAN_RATE, true);
  await service.replyFeedback(id, '已核实，服务不符合约定', 'admin', 0, f.req('rate'), 1, { ratingAction: 'rate', reviewScore: 1 });
  assert.equal((await reputation.summary('rider')).score, 76);
  assert.equal((await reputation.summary('poster')).score, 80);
  await service.replyFeedback(id, '已核实，服务不符合约定', 'admin', 0, f.req('rate'), 1, { ratingAction: 'rate', reviewScore: 1 });
  assert.equal((await reputation.summary('rider')).admin.count, 1);
  assert.equal([...f.table('notification').values()].filter(row => row.reputation).length, 1);
  await service.replyFeedback(id, '补充处理进度', 'admin', 1, f.req('follow'), 1);
  assert.equal((await reputation.summary('rider')).score, 76);
  assert.equal((await reputation.records('rider', { source: 'admin' })).list[0].content, '已核实，服务不符合约定');
  await service.replyFeedback(id, '依据补充材料，重新评定', 'admin', 2, f.req('revise'), 1, { ratingAction: 'rate', reviewScore: 5 });
  const summary = await reputation.summary('rider');
  assert.equal(summary.score, 84); assert.equal(summary.admin.count, 1); assert.equal(summary.admin.average, 5);
  const records = await reputation.records('rider', { source: 'admin' });
  assert.equal(records.list.length, 1); assert.equal(records.list[0].points, 4);
  for (const privateField of ['FB_IMG', 'FB_CONTACT', 'FB_USER_MOBILE', 'FB_HISTORY', 'FB_USER_ID']) assert.equal(records.list[0][privateField], undefined);
  assert.equal(f.table('feedback').get(id).FB_HISTORY[2].previousScore, 1);
  await assert.rejects(service.replyFeedback(id, '旧版本再次处理', 'admin', 1, f.req('stale'), 1, { ratingAction: 'rate', reviewScore: 2 }), /刷新/);
});

test('reopening, rejecting or explicitly revoking an adjudication removes its contribution without losing its audit', async () => {
  const f = fixture(), orderId = await complete(f), { id, service } = await complaint(f, orderId), reputation = new (f.load('reputation_service.js'))();
  await service.replyFeedback(id, '首次评分', 'admin', 0, f.req('first'), 1, { ratingAction: 'rate', reviewScore: 2 });
  await service.replyFeedback(id, '需要进一步核实', 'admin', 1, f.req('reopen'), 0);
  assert.equal((await reputation.summary('rider')).score, 80); assert.equal((await reputation.records('rider', { source: 'admin' })).total, 0);
  await service.replyFeedback(id, '仅补充回复，不评分', 'admin', 2, f.req('reply-only'), 1);
  assert.equal((await reputation.summary('rider')).admin.count, 0);
  await service.replyFeedback(id, '重新核实后给三星', 'admin', 3, f.req('neutral'), 1, { ratingAction: 'rate', reviewScore: 3 });
  assert.equal((await reputation.summary('rider')).admin.count, 1);
  await service.replyFeedback(id, '撤销评分', 'admin', 4, f.req('clear'), 1, { ratingAction: 'clear' });
  assert.equal((await reputation.summary('rider')).admin.count, 0);
  assert.equal(f.table('feedback').get(id).FB_HISTORY.length, 5);
  assert.equal(f.table('feedback').get(id).FB_HISTORY[4].previousScore, 3);
});

test('both roles can submit targeted complaints, but unlinked feedback and unaudited decisions cannot rate a user', async () => {
  const f = fixture(), orderId = await complete(f), { id, service } = await complaint(f, orderId, 'rider'), reputation = new (f.load('reputation_service.js'))();
  assert.equal(f.table('feedback').get(id).FB_TARGET_USER_ID, 'poster');
  await service.replyFeedback(id, '已核实双方配合情况', 'admin', 0, f.req('rate-poster'), 1, { ratingAction: 'rate', reviewScore: 4 });
  assert.equal((await reputation.summary('poster')).score, 82);
  await assert.rejects(service.replyFeedback(id, '尚未审核', 'admin', 1, f.req('pending-rate'), 0, { ratingAction: 'rate', reviewScore: 1 }), /审核/);
  await assert.rejects(service.replyFeedback(id, '无权限评分', 'other', 1, f.req('non-admin'), 1, { ratingAction: 'rate', reviewScore: 1 }), /管理员/);
  const general = await service.insertFeedback('poster', { type: 'complain', title: '一般反馈', content: '未关联订单', requestId: f.req('unlinked'), targetUserId: 'rider' });
  await assert.rejects(service.replyFeedback(general.id, '尝试对他人评分', 'admin', 0, f.req('unlinked-rate'), 1, { ratingAction: 'rate', reviewScore: 1 }), /真实订单/);
  assert.equal((await service.getAdminFeedbackDetail(general.id)).FB_CAN_RATE, false);
  assert.equal(f.table('feedback').get(general.id).FB_VERSION, 0);
});

test('racing administrator decisions apply once and changed payloads cannot reuse a request id', async () => {
  const f = fixture(), orderId = await complete(f), { id, service } = await complaint(f, orderId), reputation = new (f.load('reputation_service.js'))();
  const results = await Promise.allSettled([
    service.replyFeedback(id, '决定一', 'admin', 0, f.req('decision-one'), 1, { ratingAction: 'rate', reviewScore: 1 }),
    service.replyFeedback(id, '决定二', 'admin', 0, f.req('decision-two'), 1, { ratingAction: 'rate', reviewScore: 5 })
  ]);
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal((await reputation.summary('rider')).admin.count, 1);
  await assert.rejects(service.replyFeedback(id, '决定一', 'admin', 0, f.req('decision-one'), 1, { ratingAction: 'rate', reviewScore: 5 }), /请求标识/);
  assert.equal(f.table('feedback').get(id).FB_VERSION, 1);
});

test('a complaint submitted before acceptance cannot later be assigned to a new rider', async () => {
  const f = fixture(), orderId = await f.publish(), { id, service } = await complaint(f, orderId);
  assert.equal(f.table('feedback').get(id).FB_TARGET_USER_ID, '');
  await f.service.acceptMail('rider', orderId, { requestId: f.req('later-accept') });
  assert.equal((await service.getAdminFeedbackDetail(id)).FB_CAN_RATE, false);
  await assert.rejects(service.replyFeedback(id, '不得归给后来接单的人', 'admin', 0, f.req('later-rating'), 1, { ratingAction: 'rate', reviewScore: 1 }), /真实订单/);
  assert.equal((await new (f.load('reputation_service.js'))().summary('rider')).score, 80);
});

test('reputation includes all historical ratings, clamps only the final total and isolates pagination by recipient and project', async () => {
  const f = fixture(), reputation = new (f.load('reputation_service.js'))();
  for (let i = 0; i < 61; i++) f.table('order_review').set('r' + i, { _id: 'r' + i, _pid: 'crun', REVIEW_TO_USER_ID: 'rider', REVIEW_SCORE: 5, REVIEW_ADD_TIME: 1000 + i });
  f.table('order_review').set('foreign', { _id: 'foreign', _pid: 'elsewhere', REVIEW_TO_USER_ID: 'rider', REVIEW_SCORE: 1 });
  f.table('feedback').set('pending', { _id: 'pending', _pid: 'crun', FB_TARGET_USER_ID: 'rider', FB_STATUS: 0, FB_REVIEW_SCORE: 1 });
  const high = await reputation.summary('rider');
  assert.equal(high.reviews.count, 61); assert.equal(high.rawScore, 324); assert.equal(high.score, 100); assert.equal(high.admin.count, 0);
  const last = await reputation.records('rider', { page: 4 });
  assert.equal(last.list.length, 1); assert.equal(last.hasMore, false); assert.equal(last.total, 61);
  assert.equal((await reputation.records('other')).total, 0);
  for (let i = 0; i < 22; i++) f.table('order_review').set('negative-' + i, { _id: 'negative-' + i, _pid: 'crun', REVIEW_TO_USER_ID: 'poster', REVIEW_SCORE: 1 });
  assert.equal((await reputation.summary('poster')).score, 0);
  await assert.rejects(reputation.records('rider', { source: '../user' }), /类型/);
  await assert.rejects(reputation.records('rider', { page: 0 }), /分页/);
  await assert.rejects(reputation.summary('guest'), /注册/);
});
