/**
 * Notes: 在线客服（后台客服工作台）控制器
 * 客服角色只能访问本控制器内的会话接口，其余后台接口由基类统一拦截。
 */

const BaseProjectAdminController = require('./base_project_admin_controller.js');
const CustomerService = require('../../service/customer_service_service.js');

class AdminCustomerServiceController extends BaseProjectAdminController {

	/** 会话池 */
	async sessions() {
		await this.isAdmin();
		const input = this.validateData({
			search: 'string|min:1|max:50|name=搜索条件',
			page: 'must|int|min:1|default=1',
			size: 'int|min:1|max:50|default=20'
		});
		return await new CustomerService().getSessions(input);
	}

	/** 会话详情 */
	async chat() {
		await this.isAdmin();
		const input = this.validateData({
			sessionId: 'must|string|min:1|max:200',
			before: 'string|max:100',
			limit: 'int|min:1|max:100|default=50'
		});
		return await new CustomerService().getAdminChat(input.sessionId, input);
	}

	/** 回复会话 */
	async reply() {
		await this.isAdmin();
		const input = this.validateData({
			sessionId: 'must|string|min:1|max:200',
			content: 'must|string|min:1|max:500|name=回复内容',
			requestId: 'must|string|min:16|max:100'
		});
		return await new CustomerService().reply(input.sessionId, input.content, input.requestId, this._adminId);
	}

	/** 待回复总数 */
	async badge() {
		await this.isAdmin();
		this.validateData({});
		return await new CustomerService().getStaffBadge();
	}

	/** 生成客服邀请码：仅管理员及以上可发，客服无授权入口；有效期固定 2 小时 */
	async inviteCreate() {
		await this.isManager();
		const input = this.validateData({ hours: 'int|min:1|max:2|default=2' });
		return await require('../../service/admin/staff_invite_service.js').create(this._adminId, input.hours);
	}
}

module.exports = AdminCustomerServiceController;
