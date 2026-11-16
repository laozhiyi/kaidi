'use strict';

const BaseProjectController = require('./base_project_controller.js');
const PointService = require('../service/point_service.js');

class PointController extends BaseProjectController {

	/** 我的积分：余额与最近明细（分页） */
	async my() {
		let rules = {
			page: 'must|int|default=1',
			size: 'int|default=20',
		};

		let input = this.validateData(rules);

		let service = new PointService();
		return await service.my(this._userId, input);
	}

	/** 商品目录与当前余额（价格以云端为准） */
	async items() {
		return await new PointService().items(this._userId);
	}

	/** 兑换商品：requestId 由客户端生成，同一请求重复提交只扣一次分 */
	async redeem() {
		let rules = {
			itemId: 'must|string|min:1|max:32|name=商品',
			requestId: 'must|string|min:16|max:100|name=请求标识',
		};

		let input = this.validateData(rules);
		return await new PointService().redeem(this._userId, input);
	}

	/** 已兑换的券：只返回本人记录，不接受客户端传入 userId */
	async vouchers() {
		let rules = {
			page: 'must|int|default=1',
			size: 'int|default=20',
		};

		let input = this.validateData(rules);
		return await new PointService().vouchers(this._userId, input);
	}
}

module.exports = PointController;
