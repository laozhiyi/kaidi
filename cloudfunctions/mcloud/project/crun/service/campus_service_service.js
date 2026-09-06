/**
 * Notes: 校区客服模块业务逻辑
 * Ver : CCMiniCloud Framework 2.0.1
 * Date: 2026-09-06
 */

const BaseProjectService = require('./base_project_service.js');
const util = require('../../../framework/utils/util.js');
const CampusServiceModel = require('../model/campus_service_model.js');

class CampusServiceService extends BaseProjectService {

	/** 取得校区客服列表 */
	async getCampusServiceList({
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
			'CS_ORDER': 'asc',
			'CS_ADD_TIME': 'desc'
		};
		let fields = 'CS_CAMPUS,CS_NAME,CS_MOBILE,CS_WECHAT,CS_QQ,CS_WORK_TIME,CS_QR,CS_ORDER,CS_STATUS';

		let where = {};
		where.and = {
			_pid: this.getProjectId()
		};
		where.and.CS_STATUS = 1;

		if (util.isDefined(search) && search) {
			where.or = [
				{ CS_CAMPUS: ['like', search] },
				{ CS_NAME: ['like', search] }
			];
		}

		return await CampusServiceModel.getList(where, fields, orderBy, page, size, isTotal, oldTotal);
	}

	/** 获取单个校区客服详情 */
	async getCampusServiceDetail(id) {
		let where = {
			_id: id,
			CS_STATUS: 1
		};
		return await CampusServiceModel.getOne(where, '*');
	}

	// ==================== 管理员端 ====================

	/** 管理员-校区客服列表(不过滤状态,显示全部) */
	async getAdminCampusServiceList({
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
			'CS_ORDER': 'asc',
			'CS_ADD_TIME': 'desc'
		};
		let fields = 'CS_CAMPUS,CS_NAME,CS_MOBILE,CS_WECHAT,CS_QQ,CS_WORK_TIME,CS_QR,CS_ORDER,CS_STATUS,CS_ADD_TIME';

		let where = {};
		where.and = {
			_pid: this.getProjectId()
		};

		if (util.isDefined(search) && search) {
			where.or = [
				{ CS_CAMPUS: ['like', search] },
				{ CS_NAME: ['like', search] }
			];
		}

		return await CampusServiceModel.getList(where, fields, orderBy, page, size, isTotal, oldTotal);
	}

	/** 管理员-校区客服详情 */
	async getAdminCampusServiceDetail(id) {
		return await CampusServiceModel.getOne({ _id: id }, '*');
	}

	/** 管理员-添加校区客服 */
	async insertCampusService({
		campus,
		name,
		mobile,
		wechat,
		qq,
		workTime,
		qr,
		order
	}) {
		if (!campus) this.AppError('请填写校区名称');
		if (!name) this.AppError('请填写负责人姓名');
		if (!mobile) this.AppError('请填写手机号');

		const csId = 'CS' + Date.now() + Math.random().toString(36).substr(2, 9);

		let data = {
			CS_ID: csId,
			CS_CAMPUS: campus.trim(),
			CS_NAME: name.trim(),
			CS_MOBILE: mobile.trim(),
			CS_WECHAT: (wechat || '').trim(),
			CS_QQ: (qq || '').trim(),
			CS_WORK_TIME: (workTime || '').trim(),
			CS_QR: qr || '',
			CS_ORDER: Number(order) || 9999,
			CS_STATUS: 1,
			CS_ADD_TIME: this._timestamp,
			CS_EDIT_TIME: this._timestamp,
		};
		await CampusServiceModel.insert(data);
		return { id: csId };
	}

	/** 管理员-更新校区客服 */
	async updateCampusService(id, {
		campus,
		name,
		mobile,
		wechat,
		qq,
		workTime,
		qr,
		order
	}) {
		if (!id) this.AppError('id不能为空');
		if (!campus) this.AppError('请填写校区名称');
		if (!name) this.AppError('请填写负责人姓名');
		if (!mobile) this.AppError('请填写手机号');

		await CampusServiceModel.edit(id, {
			CS_CAMPUS: campus.trim(),
			CS_NAME: name.trim(),
			CS_MOBILE: mobile.trim(),
			CS_WECHAT: (wechat || '').trim(),
			CS_QQ: (qq || '').trim(),
			CS_WORK_TIME: (workTime || '').trim(),
			CS_QR: qr || '',
			CS_ORDER: Number(order) || 9999,
			CS_EDIT_TIME: this._timestamp,
		});
		return { id };
	}

	/** 管理员-删除校区客服 */
	async delCampusService(id) {
		if (!id) this.AppError('id不能为空');
		await CampusServiceModel.del(id);
		return { id };
	}
}

module.exports = CampusServiceService;
