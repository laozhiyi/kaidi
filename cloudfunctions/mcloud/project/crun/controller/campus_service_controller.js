/**
 * Notes: 校区客服模块控制器
 * Ver : CCMiniCloud Framework 2.0.1
 * Date: 2026-09-06
 */

const BaseProjectController = require('./base_project_controller.js');
const CampusServiceService = require('../service/campus_service_service.js');

class CampusServiceController extends BaseProjectController {

	/** 取得校区客服列表 */
	async getCampusServiceList() {
		// 数据校验
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

		// 取得数据
		let input = this.validateData(rules);

		let service = new CampusServiceService();
		return await service.getCampusServiceList(input);
	}

	/** 取得校区客服详情 */
	async getCampusServiceDetail() {
		let rules = {
			id: 'must|id',
		};

		let input = this.validateData(rules);

		let service = new CampusServiceService();
		return await service.getCampusServiceDetail(input.id);
	}
}

module.exports = CampusServiceController;
