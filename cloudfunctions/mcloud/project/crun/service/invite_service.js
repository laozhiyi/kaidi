/**
 * Notes: 邀请好友模块业务逻辑
 * Ver : CCMiniCloud Framework 2.0.1
 * Date: 2026-09-06
 */

const BaseProjectService = require('./base_project_service.js');
const util = require('../../../framework/utils/util.js');
const timeUtil = require('../../../framework/utils/time_util.js');
const InviteModel = require('../model/invite_model.js');
const UserModel = require('../model/user_model.js');

class InviteService extends BaseProjectService {

	/** 取得/创建当前用户的邀请码 */
	async getOrCreateMyInviteCode(userId) {
		// 先查找用户记录
		let where = {
			INV_USER_ID: userId,
			INV_ACCEPT_USER_ID: '',
		};
		let inv = await InviteModel.getOne(where, '*');
		if (!inv) {
			// 查询用户信息
			let user = await UserModel.getOne({ USER_MINI_OPENID: userId }, 'USER_NAME');
			// 生成唯一邀请码
			const code = await this._genUniqueCode();
			const invId = 'INV' + Date.now() + Math.random().toString(36).substr(2, 9);
			let data = {
				INV_ID: invId,
				INV_USER_ID: userId,
				INV_USER_NAME: user ? user.USER_NAME : '',
				INV_ACCEPT_USER_ID: '',
				INV_ACCEPT_USER_NAME: '',
				INV_CODE: code,
				INV_STATUS: InviteModel.STATUS.PENDING,
				INV_REWARD_STATUS: 0,
				INV_REWARD_DESC: '',
				INV_ADD_TIME: this._timestamp,
				INV_EDIT_TIME: this._timestamp,
				INV_ACCEPT_TIME: 0
			};
			await InviteModel.insert(data);
			return { code, total: 0, accepted: 0, reward: 0 };
		}

		// 统计该用户的邀请数据
		let statWhere = { INV_USER_ID: userId };
		let total = await InviteModel.count(statWhere);
		let acceptedWhere = { INV_USER_ID: userId, INV_STATUS: InviteModel.STATUS.ACCEPTED };
		let accepted = await InviteModel.count(acceptedWhere);
		let rewardWhere = { INV_USER_ID: userId, INV_REWARD_STATUS: 1 };
		let reward = await InviteModel.count(rewardWhere);

		return { code: inv.INV_CODE, total, accepted, reward };
	}

	/** 生成唯一邀请码 */
	async _genUniqueCode() {
		const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
		let code = '';
		let exists = true;
		while (exists) {
			code = '';
			for (let i = 0; i < 6; i++) {
				code += chars.charAt(Math.floor(Math.random() * chars.length));
			}
			let cnt = await InviteModel.count({ INV_CODE: code });
			exists = (cnt > 0);
		}
		return code;
	}

	/** 接受邀请（注册时绑定） */
	async acceptInvite(acceptUserId, code) {
		if (!code) return null;

		let where = { INV_CODE: code };
		let inv = await InviteModel.getOne(where, '*');
		if (!inv) return null;
		if (inv.INV_USER_ID === acceptUserId) return null; // 不能邀请自己

		// 标记已接受
		let acceptUser = await UserModel.getOne({ USER_MINI_OPENID: acceptUserId }, 'USER_NAME');
		await InviteModel.edit(inv._id, {
			INV_ACCEPT_USER_ID: acceptUserId,
			INV_ACCEPT_USER_NAME: acceptUser ? acceptUser.USER_NAME : '',
			INV_STATUS: InviteModel.STATUS.ACCEPTED,
			INV_ACCEPT_TIME: this._timestamp,
			INV_EDIT_TIME: this._timestamp
		});
		return { inviter: inv.INV_USER_ID };
	}

	/** 我的邀请列表 */
	async getMyInviteList(userId, {
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
			'INV_ADD_TIME': 'desc'
		};
		let fields = 'INV_ACCEPT_USER_NAME,INV_CODE,INV_STATUS,INV_REWARD_STATUS,INV_REWARD_DESC,INV_ADD_TIME,INV_ACCEPT_TIME';

		let where = {};
		where.and = {
			_pid: this.getProjectId(),
			INV_USER_ID: userId,
		};

		if (util.isDefined(search) && search) {
			where.or = [
				{ INV_ACCEPT_USER_NAME: ['like', search] },
				{ INV_CODE: ['like', search] }
			];
		}

		let result = await InviteModel.getList(where, fields, orderBy, page, size, isTotal, oldTotal);

		let list = result.list || [];
		for (let k = 0; k < list.length; k++) {
			list[k].INV_ADD_TIME = timeUtil.timestamp2Time(list[k].INV_ADD_TIME, 'Y-M-D h:m');
			if (list[k].INV_ACCEPT_TIME > 0)
				list[k].INV_ACCEPT_TIME = timeUtil.timestamp2Time(list[k].INV_ACCEPT_TIME, 'Y-M-D h:m');
		}
		result.list = list;
		return result;
	}

	/** 我的邀请统计 */
	async getMyInviteStat(userId) {
		let totalWhere = { INV_USER_ID: userId };
		let total = await InviteModel.count(totalWhere);
		let acceptedWhere = { INV_USER_ID: userId, INV_STATUS: InviteModel.STATUS.ACCEPTED };
		let accepted = await InviteModel.count(acceptedWhere);
		let rewardWhere = { INV_USER_ID: userId, INV_REWARD_STATUS: 1 };
		let reward = await InviteModel.count(rewardWhere);
		let pendingWhere = { INV_USER_ID: userId, INV_STATUS: InviteModel.STATUS.PENDING };
		let pending = await InviteModel.count(pendingWhere);

		return { total, accepted, reward, pending };
	}
}

module.exports = InviteService;
