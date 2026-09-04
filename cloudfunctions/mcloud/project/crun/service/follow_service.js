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
const FollowModel = require('../model/follow_model.js');
const UserModel = require('../model/user_model.js');

class FollowService extends BaseProjectService {

	// 获取当前状态
	getStatusDesc(follow) {
		 
	}

	/** 接单 */
	async acceptFollow(userId, id) {
		if (!id) this.AppError('id不能为空');

		let follow = await FollowModel.getOne(id);
		if (!follow) this.AppError('订单不存在');

		if (follow.FOLLOW_STATUS !== 0) this.AppError('该订单已被接单或不在可接状态');
		if (follow.FOLLOW_ACCEPT_USER_ID) this.AppError('该订单已被接');

		let user = await UserModel.getOne({ USER_MINI_OPENID: userId }, 'USER_NAME,USER_PAY_PIC');
		let userName = user ? user.USER_NAME : '';
		let userPayPic = user ? user.USER_PAY_PIC : '';

		let data = {
			FOLLOW_STATUS: 1,
			FOLLOW_ACCEPT_USER_ID: userId,
			FOLLOW_ACCEPT_USER_NAME: userName,
			FOLLOW_ACCEPT_PAY_PIC: userPayPic,
			FOLLOW_ACCEPT_TIME: this._timestamp,
			FOLLOW_EDIT_TIME: this._timestamp,
		};
		await FollowModel.edit(id, data);

		return { id };
	}

	/** 取消我的订单 */
	async cancelFollow(userId, id) {
		if (!id) this.AppError('id不能为空');

		let follow = await FollowModel.getOne(id);
		if (!follow) this.AppError('订单不存在');

		if (follow.FOLLOW_USER_ID !== userId && follow.FOLLOW_ACCEPT_USER_ID !== userId) {
			this.AppError('无权限取消该订单');
		}

		let data = {
			FOLLOW_STATUS: 99,
			FOLLOW_CANCEL_USER_ID: userId,
			FOLLOW_CANCEL_TIME: this._timestamp,
			FOLLOW_EDIT_TIME: this._timestamp,
		};
		await FollowModel.edit(id, data);

		return { id };
	}

	/** 浏览 */
	async viewFollow(id) {
		let fields = '*';

		let where = {
			_id: id,
			//FOLLOW_STATUS: 1
		}

		let follow = await FollowModel.getOne(where, fields);
		if (!follow) return null;

		// 接单人信息
		if (follow.FOLLOW_STATUS > 0 && follow.FOLLOW_ACCEPT_USER_ID) {
			follow.acceptUser = await UserModel.getOne({ USER_MINI_OPENID: follow.FOLLOW_ACCEPT_USER_ID }, 'USER_NAME,USER_MOBILE');
		}

		FollowModel.inc(id, 'FOLLOW_VIEW_CNT', 1);

		return follow;
	}

	/** 获取 */
	async getFollowDetail(id) {
		return await FollowModel.getOne(id);
	}

	/**修改状态 */
	async statusFollow(userId, id, status, overTime) {
		if (!id) this.AppError('id不能为空');
		if (status === undefined || status === null) this.AppError('status不能为空');

		let follow = await FollowModel.getOne(id);
		if (!follow) this.AppError('订单不存在');
		if (follow.FOLLOW_USER_ID !== userId && follow.FOLLOW_ACCEPT_USER_ID !== userId) {
			this.AppError('无权限操作');
		}

		let updateData = {
			FOLLOW_STATUS: Number(status),
			FOLLOW_EDIT_TIME: this._timestamp,
		};

		if (Number(status) === 9) {
			let ovTime = (overTime && Number(overTime) > 0) ? Number(overTime) : this._timestamp;
			updateData.FOLLOW_OVER_TIME = ovTime;
		}

		await FollowModel.edit(id, updateData);

		return { id };
	}

	/** 删除 */
	async delFollow(userId, id) {
		if (!id) this.AppError('id不能为空');

		let follow = await FollowModel.getOne(id);
		if (!follow) this.AppError('订单不存在');
		if (follow.FOLLOW_USER_ID !== userId) this.AppError('只能删除自己发布的订单');

		await FollowModel.del(id);

		return { id };
	}

	/** 插入 */
	async insertFollow(userId, {
		forms,
		cateId,
		totalFee = 0
	}) {
		const orderId = 'FOLLOW' + Date.now() + Math.random().toString(36).substr(2, 9);

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
			FOLLOW_ID: orderId,
			FOLLOW_STATUS: 0,
			FOLLOW_PAY_STATUS: 0,
			FOLLOW_PAY_TIME: 0,
			FOLLOW_TOTAL_FEE: Math.round(totalFee * 100),
			FOLLOW_USER_ID: userId,
			FOLLOW_CATE_ID: cateId,
			FOLLOW_FORMS: forms,
			FOLLOW_OBJ: this.getFormObj(forms),
			FOLLOW_END_TIME: endTime,
			FOLLOW_ADD_TIME: this._timestamp,
			FOLLOW_EDIT_TIME: this._timestamp,
		};

		if (cateId) {
			try {
				const projectSetting = require('../public/project_setting.js');
				const cateList = projectSetting.FOLLOW_CATE || [];
				for (let k = 0; k < cateList.length; k++) {
					let cat = cateList[k];
					if (cat.id == cateId || cat.id === Number(cateId)) {
						data.FOLLOW_CATE_NAME = cat.title;
						break;
					}
				}
			} catch (e) {
				console.error('获取分类名称失败', e);
			}
		}

		let ret = await FollowModel.insert(data);

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
	async editFollow(userId, {
		id,
		forms,
		cateId
	}) {
		if (!id) this.AppError('id不能为空');

		let follow = await FollowModel.getOne(id);
		if (!follow) this.AppError('订单不存在');
		if (follow.FOLLOW_USER_ID !== userId) this.AppError('只能修改自己发布的订单');

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
			FOLLOW_CATE_ID: cateId || follow.FOLLOW_CATE_ID,
			FOLLOW_FORMS: forms,
			FOLLOW_OBJ: this.getFormObj(forms),
			FOLLOW_END_TIME: endTime || follow.FOLLOW_END_TIME,
			FOLLOW_EDIT_TIME: this._timestamp,
		};

		if (cateId) {
			try {
				const projectSetting = require('../public/project_setting.js');
				const cateList = projectSetting.FOLLOW_CATE || [];
				for (let k = 0; k < cateList.length; k++) {
					let cat = cateList[k];
					if (cat.id == cateId || cat.id === Number(cateId)) {
						data.FOLLOW_CATE_NAME = cat.title;
						break;
					}
				}
			} catch (e) {
				console.error('获取分类名称失败', e);
			}
		}

		await FollowModel.edit(id, data);

		return { id };
	}

	/** 更新forms信息 */
	async updateFollowForms({
		id,
		hasImageForms
	}) {
		if (!id) this.AppError('id不能为空');
		if (!hasImageForms || !Array.isArray(hasImageForms) || hasImageForms.length === 0) return;

		await FollowModel.editForms(id, 'FOLLOW_FORMS', 'FOLLOW_OBJ', hasImageForms);
	}

	/** 列表与搜索 */
	async getFollowList(userId, {
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
			'FOLLOW_ORDER': 'asc',
			'FOLLOW_ADD_TIME': 'desc'
		};
		let fields = '_id,FOLLOW_ACCEPT_USER_ID,FOLLOW_END_TIME,FOLLOW_STATUS,FOLLOW_ADD_TIME,FOLLOW_USER_ID,FOLLOW_OBJ';

		let where = {};
		where.and = {
			//FOLLOW_STATUS: 1,
			_pid: this.getProjectId() //复杂的查询在此处标注PID
		};


		if (util.isDefined(search) && search) {
			if (search == '我的发布') {
				where.and.FOLLOW_USER_ID = userId;
			}
			else if (search == '我的接单') {
				where.and.FOLLOW_ACCEPT_USER_ID = userId;
			}
			else if (search == '我的收藏') {
				where.and.FOLLOW_FAV_LIST = userId;
			}

			else {
				where.or = [
					{ 'FOLLOW_OBJ.title': ['like', search] },
					{ 'FOLLOW_OBJ.poster': ['like', search] },
					{ 'FOLLOW_OBJ.tel': ['like', search] },
				];
			}

		} else if (sortType && util.isDefined(sortVal)) {
			// 搜索菜单
			switch (sortType) {
				case 'cateId': {
					where.and.FOLLOW_CATE_ID = String(sortVal);
					break;
				}
				case 'status': {
					where.and.FOLLOW_STATUS = Number(sortVal);
					break;
				}
				case 'timeout': { //过期
					where.and.FOLLOW_STATUS = 0;
					where.and.FOLLOW_END_TIME = ['<', this._timestamp]
					break;
				}
				case 'wait': { //待接单
					where.and.FOLLOW_STATUS = 0;
					where.and.FOLLOW_END_TIME = ['>=', this._timestamp]
					break;
				}
				case 'sort': {
					orderBy = this.fmtOrderBySort(sortVal, 'FOLLOW_ADD_TIME');
					break;
				}
			}
		}

		let result = await FollowModel.getList(where, fields, orderBy, page, size, isTotal, oldTotal);

		// 标记 mypost/myaccept
		if (result && result.list && userId) {
			for (let k = 0; k < result.list.length; k++) {
				result.list[k].mypost = result.list[k].FOLLOW_USER_ID === userId;
				result.list[k].myaccept = result.list[k].FOLLOW_ACCEPT_USER_ID === userId;
			}
		}

		return result;

	}

}

module.exports = FollowService;