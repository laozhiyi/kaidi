/**
 * Notes: 反馈投诉模块后台管理-控制器
 * Ver : CCMiniCloud Framework 2.0.1
 * Date: 2026-09-06
 */

const BaseProjectAdminController = require('./base_project_admin_controller.js');
const FeedbackService = require('../../service/feedback_service.js');
const contentCheck = require('../../../../framework/validate/content_check.js');

class AdminFeedbackController extends BaseProjectAdminController {

	/** 反馈列表 */
	async getAdminFeedbackList() {
		await this.isAdmin();

		let rules = {
			search: 'string|min:1|max:30|name=搜索条件',
			sortType: 'string|name=搜索类型',
			sortVal: 'name=搜索类型值',
			orderBy: 'object|name=排序',
			whereEx: 'object|name=附加查询条件',
			page: 'must|int|default=1',
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
		};

		let input = this.validateData(rules);

		// 内容审核
		await contentCheck.checkTextMultiAdmin(input);

		let service = new FeedbackService();
		return await service.replyFeedback(input.id, input.reply);
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
