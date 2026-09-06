/**
 * Notes: 校区客服模块后台管理-控制器
 * Ver : CCMiniCloud Framework 2.0.1
 * Date: 2026-09-06
 */

const BaseProjectAdminController = require('./base_project_admin_controller.js');
const CampusServiceService = require('../../service/campus_service_service.js');

class AdminCampusServiceController extends BaseProjectAdminController {

	/** 校区客服列表 */
	async getAdminCampusServiceList() {
		await this.isAdmin();

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

		let service = new CampusServiceService();
		return await service.getAdminCampusServiceList(input);
	}

	/** 校区客服详情 */
	async getAdminCampusServiceDetail() {
		await this.isAdmin();

		let rules = {
			id: 'must|id',
		};

		let input = this.validateData(rules);

		let service = new CampusServiceService();
		return await service.getAdminCampusServiceDetail(input.id);
	}

	/** 添加校区客服 */
	async insertCampusService() {
		await this.isAdmin();

		let rules = {
			campus: 'must|string|min:1|max:50|name=校区名称',
			name: 'must|string|min:1|max:30|name=负责人姓名',
			mobile: 'must|mobile|name=手机号',
			wechat: 'string|min:1|max:40|name=微信号',
			qq: 'string|min:1|max=20|name=QQ号',
			workTime: 'string|min:1|max:50|name=工作时间',
			qr: 'string|name=客服二维码',
			order: 'int|default=9999|name=排序',
		};

		let input = this.validateData(rules);

		let service = new CampusServiceService();
		return await service.insertCampusService(input);
	}

	/** 更新校区客服 */
	async updateCampusService() {
		await this.isAdmin();

		let rules = {
			id: 'must|id',
			campus: 'must|string|min:1|max:50|name=校区名称',
			name: 'must|string|min:1|max:30|name=负责人姓名',
			mobile: 'must|mobile|name=手机号',
			wechat: 'string|min:1|max:40|name=微信号',
			qq: 'string|min:1|max:20|name=QQ号',
			workTime: 'string|min:1|max:50|name=工作时间',
			qr: 'string|name=客服二维码',
			order: 'int|default=9999|name=排序',
		};

		let input = this.validateData(rules);

		let service = new CampusServiceService();
		return await service.updateCampusService(input.id, input);
	}

	/** 删除校区客服 */
	async delCampusService() {
		await this.isAdmin();

		let rules = {
			id: 'must|id',
		};

		let input = this.validateData(rules);

		let service = new CampusServiceService();
		return await service.delCampusService(input.id);
	}
}

module.exports = AdminCampusServiceController;
