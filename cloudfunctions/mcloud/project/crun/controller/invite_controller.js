/**
 * Notes: 邀请好友模块控制器
 * Ver : CCMiniCloud Framework 2.0.1
 * Date: 2026-09-06
 */

const BaseProjectController = require('./base_project_controller.js');
const InviteService = require('../service/invite_service.js');

class InviteController extends BaseProjectController {

	/** 取得/创建我的邀请码 */
	async getMyInviteCode() {
		let service = new InviteService();
		return await service.getOrCreateMyInviteCode(this._userId);
	}

	/** 我的邀请列表 */
	async getMyInviteList() {
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

		let service = new InviteService();
		return await service.getMyInviteList(this._userId, input);
	}

	/** 我的邀请统计 */
	async getMyInviteStat() {
		let service = new InviteService();
		return await service.getMyInviteStat(this._userId);
	}

	/** 接受邀请（注册时绑定） */
	async acceptInvite() {
		let rules = {
			code: 'must|string|min:4|max:20|name=邀请码',
		};

		let input = this.validateData(rules);

		let service = new InviteService();
		return await service.acceptInvite(this._userId, input.code);
	}
}

module.exports = InviteController;
