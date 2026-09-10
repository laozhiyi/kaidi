'use strict';
const Base = require('./base_project_service.js');
const store = require('./operation_store.js');
const Mail = require('./mail_service.js');
const rules = require('./order_rules.js');

class ReviewService extends Base {
  async insert(userId, input) {
    const user = await new Mail()._user(userId);
    const score = Number(input.score);
    if (!Number.isInteger(score) || score < 1 || score > 5) this.AppError('评分必须是1至5分');
    const content = rules.text(input.content || '', '评价内容', 300, false);
    const mail = await store.get(store.database(), 'mail', input.orderId);
    if (!mail || mail._pid !== this.getProjectId() || mail.MAIL_STATUS !== 9 || ![mail.MAIL_USER_ID, mail.MAIL_ACCEPT_USER_ID].includes(userId)) {
      this.AppError('只有已完成订单的参与者可以评价');
    }
    const toUserId = mail.MAIL_USER_ID === userId ? mail.MAIL_ACCEPT_USER_ID : mail.MAIL_USER_ID;
    if (!toUserId) this.AppError('订单缺少评价对象');
    const id = store.key(this.getProjectId(), input.orderId, userId);
    const old = await store.get(store.database(), 'order_review', id);
    if (old) this.AppError('本订单已经评价过了');
    await store.set(store.database(), 'order_review', id, {
      _pid: this.getProjectId(),
      REVIEW_ID: id,
      REVIEW_ORDER_ID: mail._id,
      REVIEW_FROM_USER_ID: userId,
      REVIEW_TO_USER_ID: toUserId,
      REVIEW_FROM_NAME: user.USER_NAME || '',
      REVIEW_TO_NAME: mail.MAIL_USER_ID === userId ? (mail.MAIL_ACCEPT_USER_NAME || '') : (mail.MAIL_USER_NAME || ''),
      REVIEW_SCORE: score,
      REVIEW_CONTENT: content,
      REVIEW_ADD_TIME: Date.now()
    });
    return { id };
  }

  async myList(userId, page = 1) {
    await new Mail()._user(userId);
    const result = await new (require('./operations_service.js'))().list('order_review', { REVIEW_FROM_USER_ID: userId }, page, 'REVIEW_ADD_TIME');
    result.list = result.list.map(item => ({
      ...item,
      REVIEW_ADD_TIME_TEXT: new Date(item.REVIEW_ADD_TIME).toLocaleString('zh-CN', { hour12: false })
    }));
    return result;
  }
}
module.exports = ReviewService;
