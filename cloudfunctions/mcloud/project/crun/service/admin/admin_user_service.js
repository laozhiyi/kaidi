/**
 * Notes: 用户管理
 * Ver : CCMiniCloud Framework 2.0.1 ALL RIGHTS RESERVED BY cclinux0730 (wechat)
 * Date: 2022-01-22  07:48:00 
 */

const BaseProjectAdminService = require('./base_project_admin_service.js');

const util = require('../../../../framework/utils/util.js');
const exportUtil = require('../../../../framework/utils/export_util.js');
const timeUtil = require('../../../../framework/utils/time_util.js');
const dataUtil = require('../../../../framework/utils/data_util.js');
const UserModel = require('../../model/user_model.js');
const AdminHomeService = require('./admin_home_service.js');
const Roles = require('./admin_roles.js');
const AdminMgrService = require('./admin_mgr_service.js');

// 导出用户数据KEY
const EXPORT_USER_DATA_KEY = 'EXPORT_USER_DATA';

class AdminUserService extends BaseProjectAdminService {


	/** 获得某个用户信息 */
	async getUser({
		userId,
		fields = '*'
	}) {
		if (typeof userId !== 'string' || !userId.trim()) this.AppError('请选择有效的用户');
		// Current lists use the document id. Old links may contain an OpenID or
		// USER_ID; resolve them here and always mutate the resolved document.
		for (const field of ['_id', 'USER_MINI_OPENID', 'USER_ID']) {
			const user = await UserModel.getOne({ [field]: userId.trim() }, fields);
			if (user) return user;
		}
		return null;
	}

	/** 取得用户分页列表 */
	async getUserList({
		search, // 搜索条件
		sortType, // 搜索菜单
		sortVal, // 搜索菜单
		orderBy, // 排序
		whereEx, //附加查询条件 
		page,
		size,
		oldTotal = 0
	}) {

		orderBy = orderBy || {
			USER_ADD_TIME: 'desc'
		};
		let fields = '*';


		let where = {};
		where.and = {
			_pid: this.getProjectId() //复杂的查询在此处标注PID
		};

		if (util.isDefined(search) && search) {
			search = String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			where.or = [{
				USER_NAME: ['like', search]
			},
			{
				USER_MOBILE: ['like', search]
			},
			{
				USER_MEMO: ['like', search]
			},
			];

		}
		if (sortType && util.isDefined(sortVal)) {
			// 搜索菜单
			switch (sortType) {
				case 'status':
					if (![0, 1, 8, 9].includes(Number(sortVal))) this.AppError('用户状态无效');
					where.and.USER_STATUS = Number(sortVal);
					break;
				case 'sort': {
					orderBy = this.fmtOrderBySort(sortVal, 'USER_ADD_TIME');
					break;
				}
			}
		}
		let result = await UserModel.getList(where, fields, orderBy, page, size, true, oldTotal, false);


		// 为导出增加一个参数condition
		result.condition = encodeURIComponent(JSON.stringify(where));

		return result;
	}

	async statusUser(id, status, reason) {
		if (!id) this.AppError('id不能为空');
		if (![0,1,8,9].includes(Number(status))) this.AppError('用户状态无效');
		const user = await this.getUser({ userId: id });
		if (!user) this.AppError('用户不存在');
		let data = { USER_STATUS: Number(status), USER_CHECK_REASON: String(reason || '').trim() };
		if (data.USER_CHECK_REASON.length > 200) this.AppError('处理说明不能超过200字');
		if (Number(status) === 8 && !data.USER_CHECK_REASON) this.AppError('请填写审核不通过的原因');
		await UserModel.edit({ _id: user._id }, data);
		// 停用或恢复账号时同步后台会话，避免已登录的后台令牌继续生效。
		await new AdminMgrService().setUserAdminActive(user, Number(status) !== 9);
		return { id: user._id, status: Number(status) };
	}

	/**
	 * 授权 / 取消授权后台角色。
	 * - 超级管理员：可授予或取消超级管理员、管理员、客服
	 * - 管理员：只能授予或取消客服
	 * - 客服：没有授权权限
	 */
	async setUserRole(id, role, myAdmin) {
		if (!id) this.AppError('id不能为空');
		const raw = role === undefined || role === null ? '' : String(role).trim();
		const next = raw ? Roles.normalize(raw) : '';
		if (raw && !next) this.AppError('后台角色无效');
		const user = await this.getUser({ userId: id });
		if (!user) this.AppError('用户不存在');
		if (user.USER_STATUS === 9) this.AppError('账号已停用，请先恢复账号再授权');
		if (next && user.USER_STATUS !== 1) this.AppError('请先审核通过该用户，再授权后台权限');
		if (myAdmin && myAdmin.ADMIN_USER_ID && myAdmin.ADMIN_USER_ID === user._id) this.AppError('不能修改自己的后台角色');
		const current = Roles.normalize(user.USER_ROLE);
		if (current === next) return { id: user._id, role: next, roleLabel: Roles.label(next) };

		const operatorRole = Roles.ofAdmin(myAdmin);
		const guard = Roles.grantError(operatorRole, next || current);
		if (guard) this.AppError(guard);
		if (current === 'super' && next !== 'super') {
			const supers = await UserModel.count({ USER_ROLE: 'super' });
			if (supers <= 1) this.AppError('至少需要保留一位超级管理员，请先授权其他账号');
		}

		await UserModel.edit({ _id: user._id }, {
			USER_ROLE: next,
			USER_ROLE_TIME: next ? this._timestamp : 0,
			USER_ROLE_BY: next ? (myAdmin && myAdmin.ADMIN_NAME || '') : ''
		});
		await new AdminMgrService().syncUserRole({ ...user, USER_ROLE: next }, next, myAdmin);
		return { id: user._id, role: next, roleLabel: Roles.label(next) };
	}

	/**删除用户 */
	async delUser(id) {
		if (!id) this.AppError('id不能为空');
		const user = await this.getUser({ userId: id });
		if (!user) this.AppError('用户不存在');
		await UserModel.edit({ _id: user._id }, { USER_STATUS:9, USER_CHECK_REASON:'管理员停用（保留履约记录）' });
		await new AdminMgrService().setUserAdminActive(user, false);
		return { id: user._id };
	}

	// #####################导出用户数据

	/**获取用户数据 */
	async getUserDataURL(adminId) {
		return await exportUtil.getExportDataURL(new (require('./admin_report_service.js'))().key('user', adminId));
	}

	/**删除用户数据 */
	async deleteUserDataExcel(adminId) {
		return await exportUtil.deleteDataExcel(new (require('./admin_report_service.js'))().key('user', adminId));
	}

	/**导出用户数据 */
	async exportUserDataExcel(condition, fields, adminId) {
		return new (require('./admin_report_service.js'))().users(condition, adminId);

	}

}

module.exports = AdminUserService;
