'use strict';
const { summarize } = require('../../cloudfunctions/mcloud/project/crun/service/reputation_rules.js');
const MailUI = require('../../miniprogram/projects/crun/biz/mail_ui_biz.js');
function summary(reviews = [0, 0, 0, 0, 0], admin = [0, 0, 0, 0, 0]) {
  const result = summarize(reviews, admin), signed = value => value > 0 ? '+' + value : String(value);
  for (const key of ['reviews', 'admin']) Object.assign(result[key], { pointsText: signed(result[key].points), averageText: result[key].average === null ? '暂无' : result[key].average + ' 星' });
  result.rules = result.rules.map(rule => ({ ...rule, pointsText: signed(rule.points) }));
  return result;
}
function scenarios() {
  const order = { _id: 'favorite-order', MAIL_STATUS: 0, MAIL_PAYMENT_MODE: 'offline', MAIL_END_TIME: Date.now() + 86400000, MAIL_FAV_CNT: 12, MAIL_IS_FAV: true, MAIL_CAN_FAV: true,
    MAIL_OBJ: { title: '快递代取', campus: '育才校区', small: 1, price: 2 }, canAccept: true };
  const context = { orderId: 'order', orderTitle: '快递代取', targetName: '小陈同学', targetRole: '发布者', canReview: true, reviewed: false };
  return [
    { page: 'my/index/my_index', data: { user: { USER_NAME: '同学', USER_STATUS: 1 } }, expected: '我的信誉分' },
    { page: 'order/index/order_index', data: { isLoad: true, tabIndex: 0, dataList: { list: [order], total: 1 } }, expected: '人收藏', absent: ['fab-publish'] },
    { page: 'mail/detail/mail_detail', data: { isLoad: true, mail: order, detailUI: MailUI.detail(order) }, expected: '已收藏' },
    { page: 'my/reputation/my_reputation', data: { isLoad: true, summary: summary() }, expected: '你的信誉从 80 分开始' },
    { page: 'my/reputation/my_reputation', data: { loading: true }, expected: '正在获取信誉分' },
    { page: 'my/reputation/my_reputation', data: { error: true }, expected: '重新加载' },
    { page: 'my/reputation/my_reputation', data: { isLoad: true, summary: summary([0, 0, 0, 0, 7]) }, expected: '已按上下限显示' },
    { page: 'my/reputation/my_reputation', data: { isLoad: true, source: 'admin', summary: summary([0, 0, 0, 0, 1], [1, 0, 0, 0, 0]), list: [{ _id: 'decision', name: '管理员审核', score: 1, points: -4, pointsText: '-4', stars: '★☆☆☆☆', content: '已核实服务不符合约定', orderId: 'order', time: '2026-09-14 18:00' }] }, expected: '已核实服务不符合约定' },
    { page: 'my/review_add/review_add', data: { context, score: 5 }, expected: '提交评价' },
    { page: 'my/review_add/review_add', data: { context: { ...context, canReview: false, reviewed: true, review: { score: 4, time: '2026-09-14 18:00' } }, score: 4, content: '配合及时' }, expected: '我给出的评价', absent: ['提交评价'] },
    { page: 'feedback/index/feedback_index', data: { orderTarget: { name: '小林同学', role: '发布者' }, orderLoaded: true }, expected: '申诉对象', absent: ['自定义', '功能反馈'] },
    { page: 'feedback/detail/feedback_detail', data: { isLoad: true, detail: { FB_STATUS: 1, FB_REPLY: '核实后给出三星', FB_REVIEW_SCORE: 3, FB_REVIEW_POINTS: 0, _reviewStars: '★★★☆☆', FB_TARGET_NAME: '小陈' } }, expected: '对应信誉分：0 分' },
    { page: 'admin/feedback/detail/admin_feedback_detail', data: { isAdmin: true, detail: { _id: 'fb', FB_CAN_RATE: true, FB_TARGET_NAME: '小陈同学', FB_TARGET_ROLE: '接单人', FB_STATUS: 0, history: [] }, actionIndex: 0, ratingIndex: 1, reviewScore: 1 }, expected: '1 星，对应 -4 分' }
  ];
}
module.exports = { scenarios };
