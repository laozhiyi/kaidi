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
const MailModel = require('../model/mail_model.js');
const UserModel = require('../model/user_model.js');

class MailService extends BaseProjectService {

	// 获取当前状态
	getStatusDesc(mail) {
	 
	}

	/** 接单 */
	async acceptMail(userId, id) {
		if (!id) this.AppError('id不能为空');

		let mail = await MailModel.getOne(id);
		if (!mail) this.AppError('订单不存在');

		if (mail.MAIL_STATUS !== 0) this.AppError('该订单已被接单或不在可接状态');
		if (mail.MAIL_ACCEPT_USER_ID) this.AppError('该订单已被接');

		// 获取接单人信息（含收款码）
		let user = await UserModel.getOne({ USER_MINI_OPENID: userId }, 'USER_NAME,USER_PAY_PIC');
		let userName = user ? user.USER_NAME : '';
		let userPayPic = user ? user.USER_PAY_PIC : '';

		let data = {
			MAIL_STATUS: 1,
			MAIL_ACCEPT_USER_ID: userId,
			MAIL_ACCEPT_USER_NAME: userName,
			MAIL_ACCEPT_PAY_PIC: userPayPic,
			MAIL_ACCEPT_TIME: this._timestamp,
			MAIL_EDIT_TIME: this._timestamp,
		};
		await MailModel.edit(id, data);

		return { id };
	}

	/** 取消我的订单 */
	async cancelMail(userId, id) {
		if (!id) this.AppError('id不能为空');

		let mail = await MailModel.getOne(id);
		if (!mail) this.AppError('订单不存在');

		// 发布人或接单人都可以取消
		if (mail.MAIL_USER_ID !== userId && mail.MAIL_ACCEPT_USER_ID !== userId) {
			this.AppError('无权限取消该订单');
		}

		let data = {
			MAIL_STATUS: 99, // 已取消
			MAIL_CANCEL_USER_ID: userId,
			MAIL_CANCEL_TIME: this._timestamp,
			MAIL_EDIT_TIME: this._timestamp,
		};
		await MailModel.edit(id, data);

		return { id };
	}

	/** 浏览 */
	async viewMail(id) {
		let fields = '*';

		let where = {
			_id: id,
			//MAIL_STATUS: 1
		}

		let mail = await MailModel.getOne(where, fields);
		if (!mail) return null;

		// 接单人信息
		if (mail.MAIL_STATUS > 0 && mail.MAIL_ACCEPT_USER_ID) {
			mail.acceptUser = await UserModel.getOne({ USER_MINI_OPENID: mail.MAIL_ACCEPT_USER_ID }, 'USER_NAME,USER_MOBILE');
		}

		MailModel.inc(id, 'MAIL_VIEW_CNT', 1);

		return mail;
	}

	/** 获取 */
	async getMailDetail(id) {
		return await MailModel.getOne(id);
	}

	/**修改状态 */
	async statusMail(userId, id, status, overTime) {
		if (!id) this.AppError('id不能为空');
		if (status === undefined || status === null) this.AppError('status不能为空');

		let mail = await MailModel.getOne(id);
		if (!mail) this.AppError('订单不存在');
		if (mail.MAIL_USER_ID !== userId) this.AppError('无权限操作');

		let updateData = {
			MAIL_STATUS: Number(status),
			MAIL_EDIT_TIME: this._timestamp,
		};

		// 状态变为已完成（9）时，记录完成时间
		if (Number(status) === 9) {
			let ovTime = (overTime && Number(overTime) > 0) ? Number(overTime) : this._timestamp;
			updateData.MAIL_OVER_TIME = ovTime;
		}

		await MailModel.edit(id, updateData);

		return { id };
	}

	/** 删除 */
	async delMail(userId, id) {
		if (!id) this.AppError('id不能为空');

		let mail = await MailModel.getOne(id);
		if (!mail) this.AppError('订单不存在');
		if (mail.MAIL_USER_ID !== userId) this.AppError('只能删除自己发布的订单');

		await MailModel.del(id);

		return { id };
	}

	/** 插入 */
	async insertMail(userId, {
		forms,
		cateId,
		totalFee = 0
	}) {
		// 生成订单号
		const orderId = 'MAIL' + Date.now() + Math.random().toString(36).substr(2, 9);

		let data = {
			MAIL_ID: orderId,
			MAIL_STATUS: 0, // 待付款
			MAIL_PAY_STATUS: 0, // 未支付
			MAIL_PAY_TIME: 0,
			MAIL_TOTAL_FEE: Math.round(totalFee * 100), // 转换为分
			MAIL_USER_ID: userId,
			MAIL_CATE_ID: cateId,
			MAIL_FORMS: forms,
			MAIL_OBJ: this.getFormObj(forms),
			MAIL_ADD_TIME: this._timestamp,
			MAIL_EDIT_TIME: this._timestamp,
		};

		// 从 forms 中提取接单截止时间
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
		data.MAIL_END_TIME = endTime;

		// 获取分类名称
		if (cateId) {
			// 直接从 projectSetting 取分类名称，避免引用不存在的模型
			try {
				const projectSetting = require('../public/project_setting.js');
				const cateList = projectSetting.MAIL_CATE || [];
				for (let k = 0; k < cateList.length; k++) {
					let cat = cateList[k];
					if (cat.id == cateId || cat.id === Number(cateId)) {
						data.MAIL_CATE_NAME = cat.title;
						break;
					}
				}
			} catch (e) {
				console.error('获取分类名称失败', e);
			}
		}

		let ret = await MailModel.insert(data);

		return {
			id: orderId,
			_id: ret,
			fee: totalFee
		};
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
	async editMail(userId, {
		id,
		forms,
		cateId
	}) {
		if (!id) this.AppError('id不能为空');

		let mail = await MailModel.getOne(id);
		if (!mail) this.AppError('订单不存在');
		if (mail.MAIL_USER_ID !== userId) this.AppError('只能修改自己发布的订单');

		// 从 forms 中提取结束时间
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
			MAIL_CATE_ID: cateId || mail.MAIL_CATE_ID,
			MAIL_FORMS: forms,
			MAIL_OBJ: this.getFormObj(forms),
			MAIL_END_TIME: endTime || mail.MAIL_END_TIME,
			MAIL_EDIT_TIME: this._timestamp,
		};

		// 重新获取分类名称
		if (cateId) {
			try {
				const projectSetting = require('../public/project_setting.js');
				const cateList = projectSetting.MAIL_CATE || [];
				for (let k = 0; k < cateList.length; k++) {
					let cat = cateList[k];
					if (cat.id == cateId || cat.id === Number(cateId)) {
						data.MAIL_CATE_NAME = cat.title;
						break;
					}
				}
			} catch (e) {
				console.error('获取分类名称失败', e);
			}
		}

		await MailModel.edit(id, data);

		return { id };
	}

	/** 更新forms信息 */
	async updateMailForms({
		id,
		hasImageForms
	}) {
		if (!id) this.AppError('id不能为空');
		if (!hasImageForms || !Array.isArray(hasImageForms) || hasImageForms.length === 0) return;

		await MailModel.editForms(id, 'MAIL_FORMS', 'MAIL_OBJ', hasImageForms);
	}

	/** 列表与搜索 */
	async getMailList(userId, {
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
			'MAIL_ORDER': 'asc',
			'MAIL_ADD_TIME': 'desc'
		};
		let fields = '_id,MAIL_ACCEPT_USER_ID,MAIL_END_TIME,MAIL_STATUS,MAIL_ADD_TIME,MAIL_USER_ID,MAIL_OBJ';

		let where = {};
		where.and = {
			//MAIL_STATUS: 1,
			_pid: this.getProjectId() //复杂的查询在此处标注PID
		};


		if (util.isDefined(search) && search) {
			if (search == '我的发布') {
				where.and.MAIL_USER_ID = userId;
			}
			else if (search == '我的接单') {
				where.and.MAIL_ACCEPT_USER_ID = userId;
			}
			else if (search == '我的收藏') {
				where.and.MAIL_FAV_LIST = userId;
			}

			else {
				where.or = [
					{ 'MAIL_OBJ.title': ['like', search] },
					{ 'MAIL_OBJ.poster': ['like', search] },
					{ 'MAIL_OBJ.tel': ['like', search] },
				];
			}

		} else if (sortType && util.isDefined(sortVal)) {
			// 搜索菜单
			switch (sortType) {
				case 'cateId': {
					where.and.MAIL_CATE_ID = String(sortVal);
					break;
				}
				case 'status': {
					where.and.MAIL_STATUS = Number(sortVal);
					break;
				}
				case 'timeout': { //过期
					where.and.MAIL_STATUS = 0;
					where.and.MAIL_END_TIME = ['<', this._timestamp]
					break;
				}
				case 'wait': { //待接单
					where.and.MAIL_STATUS = 0;
					where.and.MAIL_END_TIME = ['>=', this._timestamp]
					break;
				}
				case 'sort': {
					orderBy = this.fmtOrderBySort(sortVal, 'MAIL_ADD_TIME');
					break;
				}
			}
		}

		let result = await MailModel.getList(where, fields, orderBy, page, size, isTotal, oldTotal);

		// 标记 mypost/myaccept
		if (result && result.list && userId) {
			for (let k = 0; k < result.list.length; k++) {
				result.list[k].mypost = result.list[k].MAIL_USER_ID === userId;
				result.list[k].myaccept = result.list[k].MAIL_ACCEPT_USER_ID === userId;
			}
		}

		return result;

	}

}

module.exports = MailService;