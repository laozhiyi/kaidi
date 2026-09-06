/**
 * Notes: 反馈投诉模块控制器
 * Ver : CCMiniCloud Framework 2.0.1
 * Date: 2026-09-06
 */

const BaseProjectController = require('./base_project_controller.js');
const FeedbackService = require('../service/feedback_service.js');
const timeUtil = require('../../../framework/utils/time_util.js');
const contentCheck = require('../../../framework/validate/content_check.js');

class FeedbackController extends BaseProjectController {

	/** 提交反馈 */
	async insertFeedback() {
		let rules = {
			type: 'string|must|name=反馈类型',
			title: 'must|string|min:1|max:60|name=反馈标题',
			content: 'must|string|min:1|max:1000|name=反馈内容',
			contact: 'string|min:1|max:40|name=联系方式',
			img: 'array|name=图片'
		};

		let input = this.validateData(rules);

		// 内容审核
		await contentCheck.checkTextMultiClient(input);

		let service = new FeedbackService();
		return await service.insertFeedback(this._userId, input);
	}

	/** 我的反馈列表 */
	async getMyFeedbackList() {
		let rules = {
			search: 'string|min:1|max:30|name=搜索条件',
			sortType: 'string|name=搜索类型',
			sortVal: 'name=搜索类型值',
			orderBy: 'object|name=排序',
			page: 'must|int|default=1',
			size: 'int',
			isTotal: 'bool',
			oldTotal: 'int',
		};

		let input = this.validateData(rules);

		let service = new FeedbackService();
		let result = await service.getMyFeedbackList(this._userId, input);

		let list = result.list || [];
		for (let k = 0; k < list.length; k++) {
			list[k].FB_ADD_TIME = timeUtil.timestamp2Time(list[k].FB_ADD_TIME, 'Y-M-D h:m');
			if (list[k].FB_REPLY_TIME > 0)
				list[k].FB_REPLY_TIME = timeUtil.timestamp2Time(list[k].FB_REPLY_TIME, 'Y-M-D h:m');
		}
		result.list = list;
		return result;
	}

	/** 我的反馈详情 */
	async getMyFeedbackDetail() {
		let rules = {
			id: 'must|id',
		};

		let input = this.validateData(rules);

		let service = new FeedbackService();
		return await service.getMyFeedbackDetail(this._userId, input.id);
	}
}

module.exports = FeedbackController;
