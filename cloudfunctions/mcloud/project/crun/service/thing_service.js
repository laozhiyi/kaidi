/**
 * Notes: 兼职模块业务逻辑
 * Ver : CCMiniCloud Framework 2.0.1 ALL RIGHTS RESERVED BY cclinux0730 (wechat)
 * Date: 2024-03-23 04:00:00 
 */

const BaseProjectService = require('./base_project_service.js');
const dataUtil = require('../../../framework/utils/data_util.js');
const timeUtil = require('../../../framework/utils/time_util.js');
const util = require('../../../framework/utils/util.js');
const cloudUtil = require('../../../framework/cloud/cloud_util.js');
const ThingModel = require('../model/thing_model.js');
const UserModel = require('../model/user_model.js');

class ThingService extends BaseProjectService {

	// 获取当前状态
	getStatusDesc(thing) {
		 
	}

	/** 接单 */
	async acceptThing(userId, id) {
		if (!id) this.AppError('id不能为空');

		let thing = await ThingModel.getOne(id);
		if (!thing) this.AppError('订单不存在');

		if (thing.THING_STATUS !== 0) this.AppError('该订单已被接单或不在可接状态');
		if (thing.THING_ACCEPT_USER_ID) this.AppError('该订单已被接');

		let user = await UserModel.getOne({ USER_MINI_OPENID: userId }, 'USER_NAME,USER_PAY_PIC');
		let userName = user ? user.USER_NAME : '';
		let userPayPic = user ? user.USER_PAY_PIC : '';

		let data = {
			THING_STATUS: 1,
			THING_ACCEPT_USER_ID: userId,
			THING_ACCEPT_USER_NAME: userName,
			THING_ACCEPT_PAY_PIC: userPayPic,
			THING_ACCEPT_TIME: this._timestamp,
			THING_EDIT_TIME: this._timestamp,
		};
		await ThingModel.edit(id, data);

		return { id };
	}

	/** 取消我的订单 */
	async cancelThing(userId, id) {
		if (!id) this.AppError('id不能为空');

		let thing = await ThingModel.getOne(id);
		if (!thing) this.AppError('订单不存在');

		if (thing.THING_USER_ID !== userId && thing.THING_ACCEPT_USER_ID !== userId) {
			this.AppError('无权限取消该订单');
		}

		let data = {
			THING_STATUS: 99,
			THING_CANCEL_USER_ID: userId,
			THING_CANCEL_TIME: this._timestamp,
			THING_EDIT_TIME: this._timestamp,
		};
		await ThingModel.edit(id, data);

		return { id };
	}

	/** 浏览 */
	async viewThing(id) {
		let fields = '*';

		let where = {
			_id: id,
			//THING_STATUS: 1
		}

		let thing = await ThingModel.getOne(where, fields);
		if (!thing) return null;

		// 接单人信息
		if (thing.THING_STATUS > 0 && thing.THING_ACCEPT_USER_ID) {
			thing.acceptUser = await UserModel.getOne({ USER_MINI_OPENID: thing.THING_ACCEPT_USER_ID }, 'USER_NAME,USER_MOBILE');
		}

		ThingModel.inc(id, 'THING_VIEW_CNT', 1);

		return thing;
	}

	/** 获取 */
	async getThingDetail(id) {
		return await ThingModel.getOne(id);
	}

	/**修改状态 */
	async statusThing(userId, id, status, overTime) {
		if (!id) this.AppError('id不能为空');
		if (status === undefined || status === null) this.AppError('status不能为空');

		let thing = await ThingModel.getOne(id);
		if (!thing) this.AppError('订单不存在');
		if (thing.THING_USER_ID !== userId && thing.THING_ACCEPT_USER_ID !== userId) {
			this.AppError('无权限操作');
		}

		let updateData = {
			THING_STATUS: Number(status),
			THING_EDIT_TIME: this._timestamp,
		};

		if (Number(status) === 9) {
			let ovTime = (overTime && Number(overTime) > 0) ? Number(overTime) : this._timestamp;
			updateData.THING_OVER_TIME = ovTime;
		}

		await ThingModel.edit(id, updateData);

		return { id };
	}

	/** 删除 */
	async delThing(userId, id) {
		if (!id) this.AppError('id不能为空');

		let thing = await ThingModel.getOne(id);
		if (!thing) this.AppError('订单不存在');
		if (thing.THING_USER_ID !== userId) this.AppError('只能删除自己发布的订单');

		await ThingModel.del(id);

		return { id };
	}

	/** 插入 */
	async insertThing(userId, {
		forms,
		cateId,
		totalFee = 0
	}) {
		const orderId = 'THING' + Date.now() + Math.random().toString(36).substr(2, 9);

		// 提取截止时间
		let endTime = 0;
		if (forms && Array.isArray(forms)) {
			for (let k = 0; k < forms.length; k++) {
				if (forms[k].mark === 'formEnd' && forms[k].val) {
					endTime = timeUtil.time2Timestamp(forms[k].val);
					break;
				}
			}
		}
		// 如果没有截止时间，默认3天后
		if (!endTime) endTime = this._timestamp + 86400 * 3 * 1000;

		let data = {
			THING_ID: orderId,
			THING_STATUS: 0, // 待付款/待接单
			THING_PAY_STATUS: 0, // 未支付
			THING_PAY_TIME: 0,
			THING_TOTAL_FEE: Math.round(totalFee * 100), // 转换为分
			THING_USER_ID: userId,
			THING_CATE_ID: cateId,
			THING_FORMS: forms,
			THING_OBJ: this.getFormObj(forms),
			THING_END_TIME: endTime,
			THING_ADD_TIME: this._timestamp,
			THING_EDIT_TIME: this._timestamp,
		};

		// 获取分类名称
		if (cateId) {
			try {
				const projectSetting = require('../public/project_setting.js');
				const cateList = projectSetting.THING_CATE || [];
				for (let k = 0; k < cateList.length; k++) {
					let cat = cateList[k];
					if (cat.id == cateId || cat.id === Number(cateId)) {
						data.THING_CATE_NAME = cat.title;
						break;
					}
				}
			} catch (e) {
				console.error('获取分类名称失败', e);
			}
		}

		let ret = await ThingModel.insert(data);

		return { id: orderId, _id: ret, fee: totalFee };
	}

	/** 从forms获取对象数据 */
	getFormObj(forms) {
		let obj = {};
		for (let k = 0; k < forms.length; k++) {
			let item = forms[k];
			if (item.type === 'image') {
				obj.imgUrl = item.val;
			} else if (item.title) {
				obj[item.mark] = item.val;
			}
		}
		return obj;
	}

	/** 修改 */
	async editThing(userId, {
		id,
		forms,
		cateId
	}) {
		if (!id) this.AppError('id不能为空');

		let thing = await ThingModel.getOne(id);
		if (!thing) this.AppError('订单不存在');
		if (thing.THING_USER_ID !== userId) this.AppError('只能修改自己发布的订单');

		let endTime = 0;
		if (forms && Array.isArray(forms)) {
			for (let k = 0; k < forms.length; k++) {
				if (forms[k].mark === 'formEnd' && forms[k].val) {
					endTime = timeUtil.time2Timestamp(forms[k].val);
					break;
				}
			}
		}

		let data = {
			THING_CATE_ID: cateId || thing.THING_CATE_ID,
			THING_FORMS: forms,
			THING_OBJ: this.getFormObj(forms),
			THING_END_TIME: endTime || thing.THING_END_TIME,
			THING_EDIT_TIME: this._timestamp,
		};

		if (cateId) {
			try {
				const projectSetting = require('../public/project_setting.js');
				const cateList = projectSetting.THING_CATE || [];
				for (let k = 0; k < cateList.length; k++) {
					let cat = cateList[k];
					if (cat.id == cateId || cat.id === Number(cateId)) {
						data.THING_CATE_NAME = cat.title;
						break;
					}
				}
			} catch (e) {
				console.error('获取分类名称失败', e);
			}
		}

		await ThingModel.edit(id, data);

		return { id };
	}

	/** 更新forms信息 */
	async updateThingForms({
		id,
		hasImageForms
	}) {
		if (!id) this.AppError('id不能为空');
		if (!hasImageForms || !Array.isArray(hasImageForms) || hasImageForms.length === 0) return;

		await ThingModel.editForms(id, 'THING_FORMS', 'THING_OBJ', hasImageForms);
	}

	/** 列表与搜索 */
	async getThingList(userId, {
		search, // 搜索条件
		sortType, // 搜索菜单
		sortVal, // 搜索菜单
		orderBy, // 排序
		whereEx, //附加查询条件
		page,
		size,
		isTotal = true,
		oldTotal }) {
		orderBy = orderBy || {
			'THING_ORDER': 'asc',
			'THING_ADD_TIME': 'desc'
		};
		let fields = '_id,THING_USER_ID,THING_ACCEPT_USER_ID,THING_END_TIME,THING_STATUS,THING_ADD_TIME,THING_USER_ID,THING_OBJ,user.USER_PIC';

		let where = {};
		where.and = {
			//THING_STATUS: 1,
			_pid: this.getProjectId() //复杂的查询在此处标注PID
		};


		if (util.isDefined(search) && search) {
			if (search == '我的发布') {
				where.and.THING_USER_ID = userId;
			}
			else if (search == '我的接单') {
				where.and.THING_ACCEPT_USER_ID = userId;
			}
			else if (search == '我的收藏') {
				where.and.THING_FAV_LIST = userId;
			}

			else {
				where.or = [
					{ 'THING_OBJ.title': ['like', search] },
					{ 'THING_OBJ.poster': ['like', search] },
					{ 'THING_OBJ.tel': ['like', search] },
				];
			}

		} else if (sortType && util.isDefined(sortVal)) {
			// 搜索菜单
			switch (sortType) {
				case 'cateId': {
					where.and.THING_CATE_ID = String(sortVal);
					break;
				}
				case 'status': {
					where.and.THING_STATUS = Number(sortVal);
					break;
				}
				case 'timeout': { //过期
					where.and.THING_STATUS = 0;
					where.and.THING_END_TIME = ['<', this._timestamp]
					break;
				}
				case 'wait': { //待接单
					where.and.THING_STATUS = 0;
					where.and.THING_END_TIME = ['>=', this._timestamp]
					break;
				}
				case 'sort': {
					orderBy = this.fmtOrderBySort(sortVal, 'THING_ADD_TIME');
					break;
				}
			}
		}

		let joinParams = {
			from: UserModel.CL,
			localField: 'THING_USER_ID',
			foreignField: 'USER_MINI_OPENID',
			as: 'user',
		};

		let result = await ThingModel.getListJoin(joinParams, where, fields, orderBy, page, size, isTotal, oldTotal);

		// 标记 mypost/myaccept
		if (result && result.list && userId) {
			for (let k = 0; k < result.list.length; k++) {
				result.list[k].mypost = result.list[k].THING_USER_ID === userId;
				result.list[k].myaccept = result.list[k].THING_ACCEPT_USER_ID === userId;
			}
		}

		return result;

	}

}

module.exports = ThingService;