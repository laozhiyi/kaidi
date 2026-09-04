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
const FoodModel = require('../model/food_model.js');
const UserModel = require('../model/user_model.js');

class FoodService extends BaseProjectService {

	// 获取当前状态
	getStatusDesc(food) {
		 
	}

	/** 接单 */
	async acceptFood(userId, id) {
		if (!id) this.AppError('id不能为空');

		let food = await FoodModel.getOne(id);
		if (!food) this.AppError('订单不存在');

		if (food.FOOD_STATUS !== 0) this.AppError('该订单已被接单或不在可接状态');
		if (food.FOOD_ACCEPT_USER_ID) this.AppError('该订单已被接');

		let user = await UserModel.getOne({ USER_MINI_OPENID: userId }, 'USER_NAME,USER_PAY_PIC');
		let userName = user ? user.USER_NAME : '';
		let userPayPic = user ? user.USER_PAY_PIC : '';

		let data = {
			FOOD_STATUS: 1,
			FOOD_ACCEPT_USER_ID: userId,
			FOOD_ACCEPT_USER_NAME: userName,
			FOOD_ACCEPT_PAY_PIC: userPayPic,
			FOOD_ACCEPT_TIME: this._timestamp,
			FOOD_EDIT_TIME: this._timestamp,
		};
		await FoodModel.edit(id, data);

		return { id };
	}

	/** 取消我的订单 */
	async cancelFood(userId, id) {
		if (!id) this.AppError('id不能为空');

		let food = await FoodModel.getOne(id);
		if (!food) this.AppError('订单不存在');

		if (food.FOOD_USER_ID !== userId && food.FOOD_ACCEPT_USER_ID !== userId) {
			this.AppError('无权限取消该订单');
		}

		let data = {
			FOOD_STATUS: 99,
			FOOD_CANCEL_USER_ID: userId,
			FOOD_CANCEL_TIME: this._timestamp,
			FOOD_EDIT_TIME: this._timestamp,
		};
		await FoodModel.edit(id, data);

		return { id };
	}

	/** 浏览 */
	async viewFood(id) {
		let fields = '*';

		let where = {
			_id: id,
			//FOOD_STATUS: 1
		}

		let food = await FoodModel.getOne(where, fields);
		if (!food) return null;

		// 接单人信息
		if (food.FOOD_STATUS > 0 && food.FOOD_ACCEPT_USER_ID) {
			food.acceptUser = await UserModel.getOne({ USER_MINI_OPENID: food.FOOD_ACCEPT_USER_ID }, 'USER_NAME,USER_MOBILE');
		}

		FoodModel.inc(id, 'FOOD_VIEW_CNT', 1);

		return food;
	}

	/** 获取 */
	async getFoodDetail(id) {
		return await FoodModel.getOne(id);
	}

	/**修改状态 */
	async statusFood(userId, id, status, overTime) {
		if (!id) this.AppError('id不能为空');
		if (status === undefined || status === null) this.AppError('status不能为空');

		let food = await FoodModel.getOne(id);
		if (!food) this.AppError('订单不存在');
		if (food.FOOD_USER_ID !== userId && food.FOOD_ACCEPT_USER_ID !== userId) {
			this.AppError('无权限操作');
		}

		let updateData = {
			FOOD_STATUS: Number(status),
			FOOD_EDIT_TIME: this._timestamp,
		};

		if (Number(status) === 9) {
			let ovTime = (overTime && Number(overTime) > 0) ? Number(overTime) : this._timestamp;
			updateData.FOOD_OVER_TIME = ovTime;
		}

		await FoodModel.edit(id, updateData);

		return { id };
	}

	/** 删除 */
	async delFood(userId, id) {
		if (!id) this.AppError('id不能为空');

		let food = await FoodModel.getOne(id);
		if (!food) this.AppError('订单不存在');
		if (food.FOOD_USER_ID !== userId) this.AppError('只能删除自己发布的订单');

		await FoodModel.del(id);

		return { id };
	}

	/** 插入 */
	async insertFood(userId, {
		forms,
		cateId,
		totalFee = 0
	}) {
		const orderId = 'FOOD' + Date.now() + Math.random().toString(36).substr(2, 9);

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
			FOOD_ID: orderId,
			FOOD_STATUS: 0,
			FOOD_PAY_STATUS: 0,
			FOOD_PAY_TIME: 0,
			FOOD_TOTAL_FEE: Math.round(totalFee * 100),
			FOOD_USER_ID: userId,
			FOOD_CATE_ID: cateId,
			FOOD_FORMS: forms,
			FOOD_OBJ: this.getFormObj(forms),
			FOOD_END_TIME: endTime,
			FOOD_ADD_TIME: this._timestamp,
			FOOD_EDIT_TIME: this._timestamp,
		};

		if (cateId) {
			try {
				const projectSetting = require('../public/project_setting.js');
				const cateList = projectSetting.FOOD_CATE || [];
				for (let k = 0; k < cateList.length; k++) {
					let cat = cateList[k];
					if (cat.id == cateId || cat.id === Number(cateId)) {
						data.FOOD_CATE_NAME = cat.title;
						break;
					}
				}
			} catch (e) {
				console.error('获取分类名称失败', e);
			}
		}

		let ret = await FoodModel.insert(data);

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
	async editFood(userId, {
		id,
		forms,
		cateId
	}) {
		if (!id) this.AppError('id不能为空');

		let food = await FoodModel.getOne(id);
		if (!food) this.AppError('订单不存在');
		if (food.FOOD_USER_ID !== userId) this.AppError('只能修改自己发布的订单');

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
			FOOD_CATE_ID: cateId || food.FOOD_CATE_ID,
			FOOD_FORMS: forms,
			FOOD_OBJ: this.getFormObj(forms),
			FOOD_END_TIME: endTime || food.FOOD_END_TIME,
			FOOD_EDIT_TIME: this._timestamp,
		};

		if (cateId) {
			try {
				const projectSetting = require('../public/project_setting.js');
				const cateList = projectSetting.FOOD_CATE || [];
				for (let k = 0; k < cateList.length; k++) {
					let cat = cateList[k];
					if (cat.id == cateId || cat.id === Number(cateId)) {
						data.FOOD_CATE_NAME = cat.title;
						break;
					}
				}
			} catch (e) {
				console.error('获取分类名称失败', e);
			}
		}

		await FoodModel.edit(id, data);

		return { id };
	}

	/** 更新forms信息 */
	async updateFoodForms({
		id,
		hasImageForms
	}) {
		if (!id) this.AppError('id不能为空');
		if (!hasImageForms || !Array.isArray(hasImageForms) || hasImageForms.length === 0) return;

		await FoodModel.editForms(id, 'FOOD_FORMS', 'FOOD_OBJ', hasImageForms);
	}

	/** 列表与搜索 */
	async getFoodList(userId, {
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
			'FOOD_ORDER': 'asc',
			'FOOD_ADD_TIME': 'desc'
		};
		let fields = '_id,FOOD_ACCEPT_USER_ID,FOOD_END_TIME,FOOD_STATUS,FOOD_ADD_TIME,FOOD_USER_ID,FOOD_OBJ';

		let where = {};
		where.and = {
			//FOOD_STATUS: 1,
			_pid: this.getProjectId() //复杂的查询在此处标注PID
		};


		if (util.isDefined(search) && search) {
			if (search == '我的发布') {
				where.and.FOOD_USER_ID = userId;
			}
			else if (search == '我的接单') {
				where.and.FOOD_ACCEPT_USER_ID = userId;
			}
			else if (search == '我的收藏') {
				where.and.FOOD_FAV_LIST = userId;
			}

			else {
				where.or = [
					{ 'FOOD_OBJ.title': ['like', search] },
					{ 'FOOD_OBJ.poster': ['like', search] },
					{ 'FOOD_OBJ.tel': ['like', search] },
				];
			}

		} else if (sortType && util.isDefined(sortVal)) {
			// 搜索菜单
			switch (sortType) {
				case 'cateId': {
					where.and.FOOD_CATE_ID = String(sortVal);
					break;
				}
				case 'status': {
					where.and.FOOD_STATUS = Number(sortVal);
					break;
				}
				case 'timeout': { //过期
					where.and.FOOD_STATUS = 0;
					where.and.FOOD_END_TIME = ['<', this._timestamp]
					break;
				}
				case 'wait': { //待接单
					where.and.FOOD_STATUS = 0;
					where.and.FOOD_END_TIME = ['>=', this._timestamp]
					break;
				}
				case 'sort': {
					orderBy = this.fmtOrderBySort(sortVal, 'FOOD_ADD_TIME');
					break;
				}
			}
		}

		let result = await FoodModel.getList(where, fields, orderBy, page, size, isTotal, oldTotal);

		// 标记 mypost/myaccept
		if (result && result.list && userId) {
			for (let k = 0; k < result.list.length; k++) {
				result.list[k].mypost = result.list[k].FOOD_USER_ID === userId;
				result.list[k].myaccept = result.list[k].FOOD_ACCEPT_USER_ID === userId;
			}
		}

		return result;

	}

}

module.exports = FoodService;