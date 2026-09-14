'use strict';
const Base = require('./base_project_service.js');
const store = require('./operation_store.js');
const Mail = require('./mail_service.js');
const Operations = require('./operations_service.js');
const reputation = require('./reputation_rules.js');
const time = require('../../../framework/utils/time_util.js');

class ReputationService extends Base {
  async summary(userId) {
    await new Mail()._user(userId);
    const db = store.database(), pid = this.getProjectId();
    // Derive totals from the effective source records: retries, later replies and
    // rating corrections cannot increment the score a second time.
    const counts = await Promise.all([1, 2, 3, 4, 5].map(async score => {
      const [reviews, admin] = await Promise.all([
        db.collection(store.collection('order_review')).where({ _pid: pid, REVIEW_TO_USER_ID: userId, REVIEW_SCORE: score }).count(),
        db.collection(store.collection('feedback')).where({ _pid: pid, FB_TARGET_USER_ID: userId, FB_STATUS: 1, FB_REVIEW_SCORE: score }).count()
      ]);
      return [reviews.total, admin.total];
    }));
    return { ...reputation.summarize(counts.map(row => row[0]), counts.map(row => row[1])), updatedAt: Date.now() };
  }
  async records(userId, { source = 'review', page = 1, size = 20 } = {}) {
    await new Mail()._user(userId);
    if (!['review', 'admin'].includes(source)) this.AppError('信誉记录类型无效');
    const isReview = source === 'review', scoreField = isReview ? 'REVIEW_SCORE' : 'FB_REVIEW_SCORE';
    const where = isReview ? { REVIEW_TO_USER_ID: userId } : { FB_TARGET_USER_ID: userId, FB_STATUS: 1 };
    where[scoreField] = store.database().command.in([1, 2, 3, 4, 5]);
    const result = await new Operations().list(isReview ? 'order_review' : 'feedback', where, page,
      isReview ? 'REVIEW_ADD_TIME' : 'FB_REVIEW_TIME', size);
    // A rated user sees the decision and order, not the complainant's phone,
    // private evidence files or unrelated feedback history.
    result.list = result.list.map(row => ({
      _id: row._id, source, score: row[scoreField], points: reputation.points(row[scoreField]),
      name: isReview ? row.REVIEW_FROM_NAME || '订单参与者' : '管理员审核',
      role: isReview ? row.REVIEW_FROM_ROLE || '' : '',
      orderId: isReview ? row.REVIEW_ORDER_ID : row.FB_ORDER_ID,
      content: isReview ? row.REVIEW_CONTENT || '' : row.FB_REVIEW_REASON || row.FB_REPLY || '',
      time: time.timestamp2Time(isReview ? row.REVIEW_ADD_TIME : row.FB_REVIEW_TIME, 'Y-M-D h:m')
    }));
    return result;
  }
}
module.exports = ReputationService;
