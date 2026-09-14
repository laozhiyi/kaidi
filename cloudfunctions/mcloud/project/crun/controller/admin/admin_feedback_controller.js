/**
 * Notes: 反馈投诉模块后台管理-控制器
 * Ver : CCMiniCloud Framework 2.0.1
 * Date: 2026-09-06
 */

const BaseProjectAdminController = require('./base_project_admin_controller.js');
const FeedbackService = require('../../service/feedback_service.js');
const contentCheck = require('../../../../framework/validate/content_check.js');

class AdminFeedbackController extends BaseProjectAdminController {
 async getAdminFeedbackDetail(){await this.isAdmin();const p=this.validateData({id:'must|id'});return new FeedbackService().getAdminFeedbackDetail(p.id);}

	/** 反馈列表 */
	async getAdminFeedbackList() {
		await this.isAdmin();

		let rules = {
			search: 'string|max:50|name=搜索条件',
			status: 'int',
			type: 'string|max:30',
			sortType: 'string|name=搜索类型',
			sortVal: 'name=搜索类型值',
			orderBy: 'object|name=排序',
			whereEx: 'object|name=附加查询条件',
			page: 'must|int|default=1|min:1|max:500',
			size: 'int',
			isTotal: 'bool',
			oldTotal: 'int',
		};

		let input = this.validateData(rules);

		let service = new FeedbackService();
		return await service.getAdminFeedbackList(input);
	}

	/** 回复反馈 */
	async replyFeedback() {
		await this.isAdmin();

		let rules = {
			id: 'must|id',
			reply: 'must|string|min:1|max:500|name=回复内容',
			version:'must|int', requestId:'must|string|min:16|max:100', status:'int|default=1',
			ratingAction: 'string|max:10', reviewScore: 'int|min:1|max:5',
		};

		let input = this.validateData(rules);

		// 内容审核
		await contentCheck.checkTextMultiAdmin(input);

		let service = new FeedbackService();
		return await service.replyFeedback(input.id, input.reply, this._adminId, input.version, input.requestId, input.status, { ratingAction: input.ratingAction, reviewScore: input.reviewScore });
	}

	/** 修改状态 */
	async statusFeedback() {
		await this.isAdmin();

		let rules = {
			id: 'must|id',
			status: 'must|int',
		};

		let input = this.validateData(rules);

		let service = new FeedbackService();
		return await service.statusFeedback(input.id, input.status);
	}

	/** 删除反馈 */
	async delFeedback() {
		await this.isAdmin();

		let rules = {
			id: 'must|id',
		};

		let input = this.validateData(rules);

		let service = new FeedbackService();
		return await service.delFeedback(input.id);
	}
}

module.exports = AdminFeedbackController;
