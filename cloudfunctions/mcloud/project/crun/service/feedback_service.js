/**
 * Notes: 反馈投诉模块业务逻辑
 * Ver : CCMiniCloud Framework 2.0.1
 * Date: 2026-09-06
 */

const BaseProjectService = require('./base_project_service.js');
const util = require('../../../framework/utils/util.js');
const timeUtil = require('../../../framework/utils/time_util.js');
const FeedbackModel = require('../model/feedback_model.js');
const UserModel = require('../model/user_model.js');

class FeedbackService extends BaseProjectService {

	/** 提交反馈 */
	async insertFeedback(userId, {
		type,
		title,
		content,
		contact,
		img
	}) {
		if (!title) this.AppError('请填写反馈标题');
		if (!content) this.AppError('请填写反馈内容');
		if (!type) this.AppError('请选择反馈类型');

		// 取用户信息
		let userWhere = { USER_MINI_OPENID: userId };
		let user = await UserModel.getOne(userWhere, 'USER_NAME,USER_MOBILE');

		const fbId = 'FB' + Date.now() + Math.random().toString(36).substr(2, 9);

		let data = {
			FB_ID: fbId,
			FB_USER_ID: userId,
			FB_USER_NAME: user ? user.USER_NAME : '',
			FB_USER_MOBILE: user ? user.USER_MOBILE : '',
			FB_TYPE: type,
			FB_TITLE: title,
			FB_CONTENT: content,
			FB_CONTACT: (contact || '').trim(),
			FB_IMG: img || [],
			FB_STATUS: FeedbackModel.STATUS.PENDING,
			FB_REPLY: '',
			FB_REPLY_TIME: 0,
			FB_ADD_TIME: this._timestamp,
			FB_EDIT_TIME: this._timestamp,
		};
		await FeedbackModel.insert(data);
		return { id: fbId };
	}

	/** 我的反馈列表 */
	async getMyFeedbackList(userId, {
		search,
		sortType,
		sortVal,
		orderBy,
		page,
		size,
		isTotal = true,
		oldTotal
	}) {

		orderBy = orderBy || {
			'FB_ADD_TIME': 'desc'
		};
		let fields = 'FB_TYPE,FB_TITLE,FB_CONTENT,FB_CONTACT,FB_IMG,FB_STATUS,FB_REPLY,FB_REPLY_TIME,FB_ADD_TIME';

		let where = {};
		where.and = {
			_pid: this.getProjectId(),
			FB_USER_ID: userId
		};

		if (util.isDefined(search) && search) {
			where.or = [
				{ FB_TITLE: ['like', search] },
				{ FB_CONTENT: ['like', search] }
			];
		}

		return await FeedbackModel.getList(where, fields, orderBy, page, size, isTotal, oldTotal);
	}

	/** 我的反馈详情 */
	async getMyFeedbackDetail(userId, id) {
		let where = {
			_id: id,
			FB_USER_ID: userId
		};
		let feedback = await FeedbackModel.getOne(where, '*');
		if (feedback && feedback.FB_REPLY_TIME > 0) {
			feedback.FB_REPLY_TIME = timeUtil.timestamp2Time(feedback.FB_REPLY_TIME, 'Y-M-D h:m');
		}
		return feedback;
	}

	/** 取得反馈分页列表（管理端） */
	async getAdminFeedbackList({
		search,
		sortType,
		sortVal,
		orderBy,
		whereEx,
		page,
		size,
		isTotal = true,
		oldTotal
	}) {

		orderBy = orderBy || {
			'FB_ADD_TIME': 'desc'
		};
		let fields = 'FB_USER_ID,FB_USER_NAME,FB_USER_MOBILE,FB_TYPE,FB_TITLE,FB_CONTENT,FB_CONTACT,FB_IMG,FB_STATUS,FB_REPLY,FB_REPLY_TIME,FB_ADD_TIME';

		let where = {};
		where.and = {
			_pid: this.getProjectId()
		};

		if (util.isDefined(search) && search) {
			where.or = [
				{ FB_TITLE: ['like', search] },
				{ FB_CONTENT: ['like', search] },
				{ FB_USER_NAME: ['like', search] }
			];
		} else if (sortType && util.isDefined(sortVal)) {
			switch (sortType) {
				case 'status': {
					where.and.FB_STATUS = Number(sortVal);
					break;
				}
				case 'type': {
					where.and.FB_TYPE = String(sortVal);
					break;
				}
			}
		}

		if (whereEx && typeof whereEx === 'object') {
			for (let k in whereEx) {
				where.and[k] = whereEx[k];
			}
		}

		let result = await FeedbackModel.getList(where, fields, orderBy, page, size, isTotal, oldTotal);

		// 格式化
		let list = result.list || [];
		for (let k = 0; k < list.length; k++) {
			list[k].FB_ADD_TIME = timeUtil.timestamp2Time(list[k].FB_ADD_TIME, 'Y-M-D h:m');
			if (list[k].FB_REPLY_TIME > 0)
				list[k].FB_REPLY_TIME = timeUtil.timestamp2Time(list[k].FB_REPLY_TIME, 'Y-M-D h:m');
		}
		result.list = list;
		return result;
	}

	/** 回复反馈 */
	async replyFeedback(id, reply) {
		if (!id) this.AppError('id不能为空');
		await FeedbackModel.edit(id, {
			FB_STATUS: FeedbackModel.STATUS.DONE,
			FB_REPLY: reply || '',
			FB_REPLY_TIME: this._timestamp,
			FB_EDIT_TIME: this._timestamp
		});
		return { id };
	}

	/** 修改状态 */
	async statusFeedback(id, status) {
		if (!id) this.AppError('id不能为空');
		await FeedbackModel.edit(id, {
			FB_STATUS: Number(status),
			FB_EDIT_TIME: this._timestamp
		});
		return { id };
	}

	/** 删除反馈 */
	async delFeedback(id) {
		if (!id) this.AppError('id不能为空');
		await FeedbackModel.del(id);
		return { id };
	}
}

module.exports = FeedbackService;
