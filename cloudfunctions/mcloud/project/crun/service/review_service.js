'use strict';
const Base = require('./base_project_service.js');
const store = require('./operation_store.js');
const Mail = require('./mail_service.js');
const rules = require('./order_rules.js');
const time = require('../../../framework/utils/time_util.js');

class ReviewService extends Base {
  _target(mail, userId) {
    if (!mail || mail._pid !== this.getProjectId() || mail.MAIL_STATUS !== 9 || ![mail.MAIL_USER_ID, mail.MAIL_ACCEPT_USER_ID].includes(userId)) {
      this.AppError('只有已完成订单的参与者可以评价');
    }
    const poster = mail.MAIL_USER_ID === userId;
    const id = poster ? mail.MAIL_ACCEPT_USER_ID : mail.MAIL_USER_ID;
    if (!id || id === userId) this.AppError('订单缺少有效的评价对象');
    return { id, name: poster ? mail.MAIL_ACCEPT_USER_NAME || '接单人' : mail.MAIL_USER_NAME || (mail.MAIL_OBJ || {}).poster || '发布者',
      role: poster ? '接单人' : '发布者', fromRole: poster ? '发布者' : '接单人' };
  }
  async context(userId, orderId) {
    await new Mail()._user(userId);
    const mail = await store.get(store.database(), 'mail', orderId), target = this._target(mail, userId);
    const review = await store.get(store.database(), 'order_review', store.key(this.getProjectId(), orderId, userId));
    // 已完成订单不再向对方展示称呼，评价页只显示「匿名用户」和对方角色。
    return { orderId, orderTitle: (mail.MAIL_OBJ || {}).title || '快递代取', targetName: '匿名用户', targetRole: target.role,
      canReview: !review, reviewed: !!review,
      review: review ? { score: review.REVIEW_SCORE, content: review.REVIEW_CONTENT || '', time: time.timestamp2Time(review.REVIEW_ADD_TIME, 'Y-M-D h:m') } : null };
  }
  async decorateOrders(userId, orders) {
    const completed = orders.filter(mail => userId && mail.MAIL_STATUS === 9 && mail.MAIL_USER_ID && mail.MAIL_ACCEPT_USER_ID
      && mail.MAIL_USER_ID !== mail.MAIL_ACCEPT_USER_ID && [mail.MAIL_USER_ID, mail.MAIL_ACCEPT_USER_ID].includes(userId));
    const db = store.database();
    const reviews = completed.length ? await db.collection(store.collection('order_review')).where({
      _pid: this.getProjectId(), REVIEW_FROM_USER_ID: userId, REVIEW_ORDER_ID: db.command.in(completed.map(mail => mail._id))
    }).limit(100).get() : { data: [] };
    const reviewed = new Map(reviews.data.map(row => [row.REVIEW_ORDER_ID, row])), eligible = new Set(completed.map(mail => mail._id));
    for (const mail of orders) {
      mail.MAIL_REVIEWED = eligible.has(mail._id) && reviewed.has(mail._id);
      mail.MAIL_CAN_REVIEW = eligible.has(mail._id) && !mail.MAIL_REVIEWED;
      // 「已完成」卡片据此显示「已评价」或「已自动好评」（完成满 12 小时由系统补的 5 星）。
      mail.MAIL_REVIEW_AUTO = mail.MAIL_REVIEWED && reviewed.get(mail._id).REVIEW_AUTO === true;
    }
  }
  async insert(userId, input) {
    const user = await new Mail()._user(userId);
    new Mail()._request(input.requestId);
    const score = Number(input.score);
    if (!Number.isInteger(score) || score < 1 || score > 5) this.AppError('评分必须是1至5分');
    const content = rules.text(input.content || '', '评价内容', 300, false);
    const id = store.key(this.getProjectId(), input.orderId, userId);
    const fingerprint = store.key(input.orderId, score, content);
    return store.transaction(async tx => {
      const currentUser = await new Mail()._actor(tx, { userId, user });
      const mail = await store.get(tx, 'mail', input.orderId), target = this._target(mail, userId);
      const old = await store.get(tx, 'order_review', id);
      if (old) {
        if (old.REVIEW_REQUEST_ID === input.requestId && old.REVIEW_FINGERPRINT === fingerprint) return { id, alreadyReviewed: true };
        this.AppError('本订单已经评价过了');
      }
      const requestKey = store.key(this.getProjectId(), userId, input.requestId);
      if (await store.get(tx, 'review_request', requestKey)) this.AppError('请求标识已被使用');
      await store.assertRequestOpen(tx, this.getProjectId(), userId, 'review/insert', input.requestId);
      await store.limitInTransaction(tx, this.getProjectId(), userId, 'review', 20, 60000);
      await store.set(tx, 'order_review', id, {
        _pid: this.getProjectId(), REVIEW_ID: id, REVIEW_ORDER_ID: mail._id,
        REVIEW_FROM_USER_ID: userId, REVIEW_TO_USER_ID: target.id,
        REVIEW_FROM_NAME: currentUser.USER_NAME || '', REVIEW_TO_NAME: target.name,
        REVIEW_FROM_ROLE: target.fromRole, REVIEW_TO_ROLE: target.role,
        REVIEW_SCORE: score, REVIEW_CONTENT: content, REVIEW_ADD_TIME: Date.now(),
        REVIEW_REQUEST_ID: input.requestId, REVIEW_FINGERPRINT: fingerprint
      });
      await store.set(tx, 'review_request', requestKey, { _pid: this.getProjectId(), reviewId: id, createdAt: Date.now() });
      // 评价后「已完成」卡片不再显示评价按钮；标记与评价写在同一个事务里。
      await store.set(tx, 'mail', input.orderId, { ...mail, [mail.MAIL_USER_ID === userId ? 'MAIL_POSTER_REVIEWED' : 'MAIL_RIDER_REVIEWED']: true });
      return { id };
    });
  }

  /**
   * 完成满 12 小时仍未评价：替未评价的一方写一条 5 星评价（内容为空，标记 REVIEW_AUTO），
   * 并打上已评价标记，订单仍留在「已完成」直到本人删除。由定时任务在事务内调用；已有评价的一方不动。
   */
  async autoReview(tx, mail, id, now = Date.now()) {
    if (!mail || mail.MAIL_STATUS !== 9 || !mail.MAIL_USER_ID || !mail.MAIL_ACCEPT_USER_ID || mail.MAIL_USER_ID === mail.MAIL_ACCEPT_USER_ID) return 0;
    if (!(mail.MAIL_OVER_TIME > 0) || mail.MAIL_OVER_TIME > now - Mail.REVIEW_WINDOW_MS) return 0;
    const next = { ...mail };
    let written = 0;
    for (const poster of [true, false]) {
      const flag = poster ? 'MAIL_POSTER_REVIEWED' : 'MAIL_RIDER_REVIEWED';
      if (mail[flag] === true) continue;
      const from = poster ? mail.MAIL_USER_ID : mail.MAIL_ACCEPT_USER_ID, target = this._target(mail, from);
      const reviewId = store.key(this.getProjectId(), id, from);
      if (!await store.get(tx, 'order_review', reviewId)) {
        await store.set(tx, 'order_review', reviewId, {
          _pid: this.getProjectId(), REVIEW_ID: reviewId, REVIEW_ORDER_ID: id,
          REVIEW_FROM_USER_ID: from, REVIEW_TO_USER_ID: target.id,
          REVIEW_FROM_NAME: poster ? mail.MAIL_USER_NAME || '' : mail.MAIL_ACCEPT_USER_NAME || '', REVIEW_TO_NAME: target.name,
          REVIEW_FROM_ROLE: target.fromRole, REVIEW_TO_ROLE: target.role,
          REVIEW_SCORE: 5, REVIEW_CONTENT: '', REVIEW_ADD_TIME: now, REVIEW_AUTO: true
        });
        written++;
      }
      next[flag] = true;
    }
    await store.set(tx, 'mail', id, next);
    return written;
  }

  async myList(userId, page = 1, direction = 'sent', size = 20) {
    await new Mail()._user(userId);
    if (!['sent', 'received'].includes(direction)) this.AppError('评价类型无效');
    const result = await new (require('./operations_service.js'))().list('order_review', { [direction === 'received' ? 'REVIEW_TO_USER_ID' : 'REVIEW_FROM_USER_ID']: userId }, page, 'REVIEW_ADD_TIME', size);
    const personField = direction === 'received' ? 'REVIEW_FROM_USER_ID' : 'REVIEW_TO_USER_ID';
    const nameField = direction === 'received' ? 'REVIEW_FROM_NAME' : 'REVIEW_TO_NAME';
    const personIds = [...new Set(result.list.map(item => item[personField]).filter(id => typeof id === 'string' && id))];
    const db = store.database();
    const people = personIds.length ? await db.collection(store.collection('user')).where({
      _pid: this.getProjectId(), USER_MINI_OPENID: db.command.in(personIds)
    }).field({ USER_MINI_OPENID: true, USER_NAME: true, USER_PIC: true }).limit(personIds.length).get() : { data: [] };
    const profiles = new Map(people.data.map(person => [person.USER_MINI_OPENID, person]));
    // Review lists expose display fields only; order and account identifiers stay on the server.
    result.list = result.list.map(item => {
      const person = profiles.get(item[personField]);
      return {
        _id: item._id,
        REVIEW_NAME: person && person.USER_NAME || item[nameField] || '用户',
        REVIEW_PIC: person && person.USER_PIC || '',
        REVIEW_SCORE: item.REVIEW_SCORE,
        REVIEW_CONTENT: item.REVIEW_CONTENT || ''
      };
    });
    return result;
  }
}
module.exports = ReviewService;
