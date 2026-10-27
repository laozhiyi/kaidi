/**
 * Notes: 在线客服（用户端）控制器
 */

const BaseProjectController = require('./base_project_controller.js');
const CustomerService = require('../service/customer_service_service.js');

class CustomerServiceController extends BaseProjectController {

	/** 我的会话消息 */
	async getChat() {
		const input = this.validateData({
			before: 'string|max:100',
			limit: 'int|min:1|max:100|default=50'
		});
		return await new CustomerService().getChat(this._userId, input);
	}

	/** 发送咨询 */
	async sendMessage() {
		const input = this.validateData({
			requestId: 'must|string|min:16|max:100',
			content: 'must|string|min:1|max:500|name=咨询内容'
		});
		return await new CustomerService().sendMessage(this._userId, input.content, input.requestId);
	}

	/** 未读红点 */
	async badge() {
		this.validateData({});
		return await new CustomerService().getUserBadge(this._userId);
	}
}

module.exports = CustomerServiceController;
