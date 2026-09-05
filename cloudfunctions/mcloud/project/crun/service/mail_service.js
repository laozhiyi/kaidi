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
		if (!mail) return '';

		const status = Number(mail.MAIL_STATUS);
		const totalFee = Number(mail.MAIL_TOTAL_FEE || 0) || (Number(mail.MAIL_OBJ && mail.MAIL_OBJ.price || 0) * 100);
		if (status === 0 && totalFee > 0 && Number(mail.MAIL_PAY_STATUS || 0) !== 1) {
			return '待支付';
		}
		if (status === 0 && Number(mail.MAIL_END_TIME) > 0 && Number(mail.MAIL_END_TIME) < this._timestamp) {
			return '已过期';
		}

		const statusMap = {
			0: '待接单',
			1: '配送中',
			9: '已完成',
			99: '已取消',
		};
		return statusMap[status] || '状态未知';
	}

	/** 按件数计算费用，并拒绝负数或非整数件数。 */
	_calcPackageFee(mailObj) {
		const counts = ['small', 'medium', 'large'].map((key) => Number(mailObj && mailObj[key] || 0));
		if (counts.some((count) => !Number.isInteger(count) || count < 0)) {
			this.AppError('快递件数必须为非负整数');
		}
		if (counts.reduce((sum, count) => sum + count, 0) < 1) {
			this.AppError('至少选择一件快递');
		}
		return counts[0] * 1.5 + counts[1] * 3 + counts[2] * 5;
	}

	/** 接单 */
	async acceptMail(userId, id) {
		if (!id) this.AppError('id不能为空');

		let mail = await MailModel.getOne(id);
		if (!mail) this.AppError('订单不存在');

		if (mail.MAIL_STATUS !== 0) this.AppError('该订单已被接单或不在可接状态');
		if (mail.MAIL_ACCEPT_USER_ID) this.AppError('该订单已被接');
		if (mail.MAIL_USER_ID === userId) this.AppError('不能接自己发布的订单');
		// 旧数据可能没有支付字段；只有明确存在费用的订单才强制校验支付状态。
		const totalFee = Number(mail.MAIL_TOTAL_FEE || 0) || (Number(mail.MAIL_OBJ && mail.MAIL_OBJ.price || 0) * 100);
		if (totalFee > 0 && Number(mail.MAIL_PAY_STATUS) !== 1) {
			this.AppError('该订单尚未完成支付');
		}
		if (mail.MAIL_END_TIME && mail.MAIL_END_TIME < this._timestamp) this.AppError('该订单已过期');

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
		// 把状态放进更新条件，避免两个人同时接到同一订单。
		const updated = await MailModel.edit({ _id: id, MAIL_STATUS: 0 }, data);
		if (!updated) this.AppError('手慢了，该订单已被其他人接走');

		return { id };
	}

	/** 取消我的订单 */
	async cancelMail(userId, id) {
		if (!id) this.AppError('id不能为空');

		let mail = await MailModel.getOne(id);
		if (!mail) this.AppError('订单不存在');

		const isPoster = mail.MAIL_USER_ID === userId;
		const isAcceptor = mail.MAIL_ACCEPT_USER_ID === userId;
		if (!isPoster && !isAcceptor) {
			this.AppError('无权限取消该订单');
		}
		if (mail.MAIL_STATUS === 9 || mail.MAIL_STATUS === 99) this.AppError('该订单已结束');

		if (isAcceptor && !isPoster) {
			if (mail.MAIL_STATUS !== 1) this.AppError('当前状态不能取消接单');
			await MailModel.edit(id, {
				MAIL_STATUS: 0,
				MAIL_ACCEPT_USER_ID: '',
				MAIL_ACCEPT_USER_NAME: '',
				MAIL_ACCEPT_PAY_PIC: '',
				MAIL_ACCEPT_TIME: 0,
				MAIL_EDIT_TIME: this._timestamp,
			});
			return { id, statusDesc: '待接单' };
		}
		if (isPoster && mail.MAIL_STATUS !== 0) {
			this.AppError('订单已被接单，不能直接取消，请联系骑手或客服处理');
		}

		let data = {
			MAIL_STATUS: 99, // 已取消
			MAIL_CANCEL_USER_ID: userId,
			MAIL_CANCEL_TIME: this._timestamp,
			MAIL_EDIT_TIME: this._timestamp,
		};
		await MailModel.edit(id, data);

		return { id, statusDesc: '已取消' };
	}

	/** 发布者或接单人确认配送完成 */
	async finishMail(userId, id) {
		if (!id) this.AppError('id不能为空');

		const mail = await MailModel.getOne(id);
		if (!mail) this.AppError('订单不存在');
		if (mail.MAIL_STATUS !== 1) this.AppError('当前状态不能完成订单');
		if (mail.MAIL_USER_ID !== userId && mail.MAIL_ACCEPT_USER_ID !== userId) {
			this.AppError('无权限操作');
		}

		await MailModel.edit(id, {
			MAIL_STATUS: 9,
			MAIL_OVER_TIME: this._timestamp,
			MAIL_EDIT_TIME: this._timestamp,
		});
		return { id, statusDesc: '已完成' };
	}

	/** 浏览 */
	async viewMail(userId, id) {
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

		const canSeePrivate = userId && (mail.MAIL_USER_ID === userId || mail.MAIL_ACCEPT_USER_ID === userId);
		if (!canSeePrivate && mail.MAIL_OBJ) {
			mail.MAIL_OBJ = Object.assign({}, mail.MAIL_OBJ);
			delete mail.MAIL_OBJ.code;
			delete mail.MAIL_OBJ.imgUrl;
			delete mail.MAIL_OBJ.imgUrls;
			delete mail.MAIL_OBJ.tel;
		}
		if (!canSeePrivate) delete mail.acceptUser;

		MailModel.inc(id, 'MAIL_VIEW_CNT', 1);

		return mail;
	}

	/** 获取 */
	async getMailDetail(userId, id) {
		const mail = await MailModel.getOne(id);
		if (!mail) return null;
		// userId=null 仅供已通过管理员鉴权的控制器调用。
		if (userId !== null && mail.MAIL_USER_ID !== userId) this.AppError('无权限查看该订单');
		return mail;
	}

	/**修改状态 */
	async statusMail(userId, id, status, overTime) {
		if (!id) this.AppError('id不能为空');
		if (status === undefined || status === null) this.AppError('status不能为空');

		let mail = await MailModel.getOne(id);
		if (!mail) this.AppError('订单不存在');
		if (userId && mail.MAIL_USER_ID !== userId) this.AppError('无权限操作');
		if (userId && Number(status) === 9) return await this.finishMail(userId, id);

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

		return { id, statusDesc: this.getStatusDesc(Object.assign({}, mail, updateData)) };
	}

	/** 删除 */
	async delMail(userId, id) {
		if (!id) this.AppError('id不能为空');

		let mail = await MailModel.getOne(id);
		if (!mail) this.AppError('订单不存在');
		if (userId && mail.MAIL_USER_ID !== userId) this.AppError('只能删除自己发布的订单');

		await MailModel.del(id);

		return { id };
	}

	/** 插入 */
	async insertMail(userId, {
		forms,
		cateId,
		totalFee = 0
	}) {
		if (!Array.isArray(forms)) this.AppError('表单数据不能为空');
		// 生成订单号
		const orderId = 'MAIL' + Date.now() + Math.random().toString(36).substr(2, 9);
		const mailObj = this.getFormObj(forms);
		// 费用由件数在服务端重新计算，避免客户端篡改支付金额。
		const packageFee = this._calcPackageFee(mailObj);
		if (packageFee > 0) totalFee = Number(packageFee.toFixed(2));
		mailObj.price = Number(totalFee.toFixed(2));

		let data = {
			MAIL_ID: orderId,
			MAIL_STATUS: 0, // 待接单
			// 免费订单不需要走微信支付，但仍然必须视为已支付，才能进入可接单列表。
			MAIL_PAY_STATUS: Number(totalFee) <= 0 ? 1 : 0,
			MAIL_PAY_TIME: Number(totalFee) <= 0 ? this._timestamp : 0,
			MAIL_TOTAL_FEE: Math.round(totalFee * 100), // 转换为分
			MAIL_USER_ID: userId,
			MAIL_CATE_ID: cateId,
			MAIL_FORMS: forms,
			MAIL_OBJ: mailObj,
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
		if (endTime <= this._timestamp) this.AppError('接单截止时间必须晚于当前时间');
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
				const imgUrls = Array.isArray(item.val) ? item.val.filter(Boolean) : [];
				obj.imgUrls = imgUrls;
				obj.imgUrl = imgUrls[0] || '';
			} else if (item.title) {
				if (item.type === 'int' || item.type === 'digit') {
					obj[item.mark] = Number(item.val) || 0;
				} else {
					obj[item.mark] = item.val;
				}
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
		if (!Array.isArray(forms)) this.AppError('表单数据不能为空');

		let mail = await MailModel.getOne(id);
		if (!mail) this.AppError('订单不存在');
		if (mail.MAIL_USER_ID !== userId) this.AppError('只能修改自己发布的订单');
		if (mail.MAIL_STATUS !== 0) this.AppError('订单已被接单，不能再修改');

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

		if (endTime && endTime <= this._timestamp) this.AppError('接单截止时间必须晚于当前时间');
		const nextObj = this.getFormObj(forms);
		const packageFee = this._calcPackageFee(nextObj);
		const nextTotalFee = Math.round((packageFee > 0 ? packageFee : (Number(nextObj.price) || 0)) * 100);
		if (packageFee > 0) nextObj.price = Number(packageFee.toFixed(2));
		const prevTotalFee = Number(mail.MAIL_TOTAL_FEE || 0);
		let data = {
			MAIL_CATE_ID: cateId || mail.MAIL_CATE_ID,
			MAIL_FORMS: forms,
			MAIL_OBJ: nextObj,
			MAIL_END_TIME: endTime || mail.MAIL_END_TIME,
			MAIL_TOTAL_FEE: nextTotalFee,
			MAIL_EDIT_TIME: this._timestamp,
		};
		if (nextTotalFee !== prevTotalFee) {
			data.MAIL_PAY_STATUS = nextTotalFee > 0 ? 0 : 1;
			data.MAIL_PAY_TIME = nextTotalFee > 0 ? 0 : this._timestamp;
			data.MAIL_PAY_NO = '';
		}

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
	async updateMailForms(userId, {
		id,
		hasImageForms
	}) {
		if (!id) this.AppError('id不能为空');
		if (!hasImageForms || !Array.isArray(hasImageForms) || hasImageForms.length === 0) return;

		let mail = await MailModel.getOne(id);
		if (!mail) this.AppError('订单不存在');
		if (mail.MAIL_USER_ID !== userId) this.AppError('无权限修改该订单');

		let forms = mail.MAIL_FORMS || [];
		if (!Array.isArray(forms) || forms.length === 0) return;

		// 合并 hasImageForms 中的图片值（仅匹配 image / content 类型）
		for (let k = 0; k < hasImageForms.length; k++) {
			for (let j in forms) {
				if ((forms[j].type == 'image' || forms[j].type == 'content')
					&& forms[j].mark == hasImageForms[k].mark
					&& forms[j].type == hasImageForms[k].type) {
					forms[j].val = hasImageForms[k].val;
					break;
				}
			}
		}

		// 与 insertMail / editMail 保持一致：MAIL_OBJ 只保留 imgUrl + 文本字段，
		// 避免重复存储所有图片字段的 fileID
		await MailModel.edit(id, {
			MAIL_FORMS: forms,
			MAIL_OBJ: this.getFormObj(forms),
		});
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
		let fields = '_id,MAIL_ID,MAIL_ACCEPT_USER_ID,MAIL_END_TIME,MAIL_OVER_TIME,MAIL_STATUS,MAIL_PAY_STATUS,MAIL_TOTAL_FEE,MAIL_ADD_TIME,MAIL_USER_ID,MAIL_OBJ';

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

		} else if (sortType) {
			// 搜索菜单
			switch (sortType) {
				case 'cateId': {
					where.and.MAIL_CATE_ID = String(sortVal);
					break;
				}
				case 'status': {
					// 已接单 / 已完成 —— 仅显示与当前用户相关的（我发布 或 我接单）
					where.and.MAIL_STATUS = Number(sortVal);
					where.or = [
						{ MAIL_USER_ID: userId },
						{ MAIL_ACCEPT_USER_ID: userId }
					];
					break;
				}
				case 'timeout': { //过期
					// 仅显示与当前用户相关的过期单
					where.and.MAIL_STATUS = 0;
					where.and.MAIL_END_TIME = ['<', this._timestamp];
					where.or = [
						{ MAIL_USER_ID: userId },
						{ MAIL_ACCEPT_USER_ID: userId }
					];
					break;
				}
				case 'wait': { //待接单
					where.and.MAIL_STATUS = 0;
					where.and.MAIL_PAY_STATUS = 1;
					where.and.MAIL_USER_ID = ['<>', userId];
					where.and.MAIL_END_TIME = ['>=', this._timestamp]
					break;
				}
				case 'my_accept': { //我接的单（接单中）
					where.and.MAIL_ACCEPT_USER_ID = userId;
					where.and.MAIL_STATUS = 1;
					break;
				}
				case 'my_post': { //我发布的全部订单
					where.and.MAIL_USER_ID = userId;
					break;
				}
				case 'my_done': { //我参与的已完成订单
					where.and.MAIL_STATUS = 9;
					where.or = [
						{ MAIL_USER_ID: userId },
						{ MAIL_ACCEPT_USER_ID: userId },
					];
					break;
				}
				case 'sort': {
					orderBy = this.fmtOrderBySort(sortVal, 'MAIL_ADD_TIME');
					break;
				}
			}
		}

		// 附加查询条件（如按地点"一期/二期..."过滤）
		if (whereEx && typeof whereEx === 'object') {
			for (let k in whereEx) {
				if (Object.prototype.hasOwnProperty.call(whereEx, k)) {
					where.and[k] = whereEx[k];
				}
			}
		}

		let result = await MailModel.getList(where, fields, orderBy, page, size, isTotal, oldTotal);

		// 标记 mypost/myaccept
		if (result && result.list && userId) {
			for (let k = 0; k < result.list.length; k++) {
				result.list[k].mypost = result.list[k].MAIL_USER_ID === userId;
				result.list[k].myaccept = result.list[k].MAIL_ACCEPT_USER_ID === userId;
				const canSeePrivate = result.list[k].mypost || result.list[k].myaccept;
				if (!canSeePrivate && result.list[k].MAIL_OBJ) {
					result.list[k].MAIL_OBJ = Object.assign({}, result.list[k].MAIL_OBJ);
					delete result.list[k].MAIL_OBJ.code;
					delete result.list[k].MAIL_OBJ.imgUrl;
					delete result.list[k].MAIL_OBJ.imgUrls;
					delete result.list[k].MAIL_OBJ.tel;
				}
			}
		}

		return result;

	}

}

module.exports = MailService;
