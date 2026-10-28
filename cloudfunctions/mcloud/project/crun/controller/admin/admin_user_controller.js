/**
 * Notes: 用户控制模块
 * Ver : CCMiniCloud Framework 2.0.1 ALL RIGHTS RESERVED BY cclinux0730 (wechat)
 * Date: 2022-01-22 10:20:00 
 */

const BaseProjectAdminController = require('./base_project_admin_controller.js');

const UserModel = require('../../model/user_model.js');
const AdminUserService = require('../../service/admin/admin_user_service.js');
const Roles = require('../../service/admin/admin_roles.js');
const media = require('../../service/private_media_service.js');
const timeUtil = require('../../../../framework/utils/time_util.js');

/**
 * 注册资料里的图片存放在 private/<openid>/<generation>/，只有本人可读；
 * 后台审核时必须由云函数换取临时链接，直接把 cloud:// 交给 <image> 只会 403。
 * 返回 { images: { mark: [url] }, error }，按 mark 对齐，未授权的图片一律不返回原始 fileID。
 */
async function formMedia(forms) {
	const groups = (Array.isArray(forms) ? forms : []).map(item => {
		// 老记录可能没有 type 字段，这里只认值：凡是 cloud:// 的资料值都需要换链接。
		if (!item || typeof item.mark !== 'string' || !item.mark) return null;
		const list = (Array.isArray(item.val) ? item.val : [item.val])
			.filter(value => typeof value === 'string' && value.startsWith('cloud://'));
		return list.length ? [item.mark, list] : null;
	}).filter(Boolean);
	const images = {};
	if (!groups.length) return { images, error: '' };
	try {
		const map = await media.urlMap(groups.flatMap(item => item[1]));
		groups.forEach(([mark, list]) => {
			const urls = list.map(id => map.get(id)).filter(Boolean);
			if (urls.length) images[mark] = urls;
		});
		// 全部取不到链接时明确告知，部分失败则只隐藏坏掉的那张。
		return { images, error: Object.keys(images).length ? '' : '图片暂时无法读取，请稍后刷新重试' };
	} catch (error) {
		// 授权失败时宁可不显示，也不能把 cloud:// 原样交给前端当图片地址。
		console.warn('[admin user media] preview unavailable', { code: error.code || error.errCode || 'PREVIEW_ERROR' });
		return { images: {}, error: '图片暂时无法读取，请稍后刷新重试' };
	}
}

class AdminUserController extends BaseProjectAdminController {


	/** 用户信息（客服可查看，用于注册审核） */
	async getUserDetail() {
		await this.isAdmin();

		// 数据校验
		let rules = {
			id: 'must|id',
		};

		// 取得数据
		let input = this.validateData(rules);

		let service = new AdminUserService();
		let user = await service.getUser({
			userId: input.id
		});

		if (user) {
			// 显示转换  
			user.USER_ADD_TIME = timeUtil.timestamp2Time(user.USER_ADD_TIME);
			user.USER_LOGIN_TIME = user.USER_LOGIN_TIME ? timeUtil.timestamp2Time(user.USER_LOGIN_TIME) : '未登录';
			user.USER_ROLE = Roles.normalize(user.USER_ROLE);
			user.USER_ROLE_LABEL = Roles.label(user.USER_ROLE);
			const preview = await formMedia(user.USER_FORMS);
			user.USER_FORM_MEDIA = preview.images;
			user.USER_FORM_MEDIA_ERROR = preview.error;
		}

		return user;
	}


	/** 用户列表 */
	async getUserList() {
		await this.isAdmin();

		// 数据校验
		let rules = {
			search: 'string|max:30|name=搜索条件',
			sortType: 'string|name=搜索类型',
			sortVal: 'name=搜索类型值',
			orderBy: 'object|name=排序',
			whereEx: 'object|name=附加查询条件',
			page: 'must|int|default=1|min:1|max:500',
			size: 'int|min:1|max:50',
			isTotal: 'bool',
			oldTotal: 'int',
		};

		// 取得数据
		let input = this.validateData(rules);

		let service = new AdminUserService();
		let result = await service.getUserList(input);

		// 数据格式化
		let list = result.list;
		for (let k = 0; k < list.length; k++) {
			list[k].USER_STATUS_DESC = UserModel.getDesc('STATUS', list[k].USER_STATUS);
			list[k].USER_ROLE = Roles.normalize(list[k].USER_ROLE);
			list[k].USER_ROLE_LABEL = Roles.label(list[k].USER_ROLE);
			list[k].USER_ADD_TIME = timeUtil.timestamp2Time(list[k].USER_ADD_TIME);
			list[k].USER_LOGIN_TIME = list[k].USER_LOGIN_TIME ? timeUtil.timestamp2Time(list[k].USER_LOGIN_TIME) : '未登录';

		}
		result.list = list;
		return result;
	}

	/** 删除用户 */
	async delUser() {
		await this.isManager();

		// 数据校验
		let rules = {
			id: 'must|id',
		};

		// 取得数据
		let input = this.validateData(rules);

		let title = await UserModel.getOneField({ USER_MINI_OPENID: input.id }, 'USER_NAME');

		let service = new AdminUserService();
		await service.delUser(input.id, this._admin);

		if (title)
			this.logUser('删除了用户「' + title + '」');

	}

	async statusUser() {
		await this.isAdmin();

		// 数据校验
		let rules = {
			id: 'must|id',
			status: 'must|int',
			reason: 'string|max:200'
		};

		// 取得数据
		let input = this.validateData(rules);

		// 客服只负责注册审核（通过/不通过）；停用与恢复账号（9）仍归管理员及以上。
		if (Roles.ofAdmin(this._admin) === 'service' && ![1, 8].includes(Number(input.status))) this.AppError('客服账号没有该操作权限');

		let service = new AdminUserService();
		const result = await service.statusUser(input.id, input.status, input.reason, this._admin);
		this.logUser('更新用户「' + input.id + '」的状态为 ' + input.status);
		return result;
	}

	/** 授权 / 取消授权后台角色（超级管理员、管理员、客服） */
	async userRole() {
		await this.isAdmin();

		// 数据校验
		let rules = {
			id: 'must|id',
			role: 'string|max:10'
		};

		// 取得数据
		let input = this.validateData(rules);

		let service = new AdminUserService();
		const result = await service.setUserRole(input.id, input.role || '', this._admin);
		return result;
	}

	/** 本人主动退出后台（超管交接前先由初始管理员授权继任者） */
	async userLeave() {
		await this.isAdmin();

		let rules = {
			id: 'must|id'
		};

		let input = this.validateData(rules);

		let service = new AdminUserService();
		const result = await service.leaveAdmin(input.id, this._admin);
		this.logUser('退出了后台权限');
		return result;
	}

	/************** 用户数据导出 BEGIN ********************* */
	/** 当前是否有导出文件生成 */
	async userDataGet() {
		await this.isManager();

		// 数据校验
		let rules = {
			isDel: 'int|must', //是否删除已有记录
		};

		// 取得数据
		let input = this.validateData(rules);

		let service = new AdminUserService();

		if (input.isDel === 1)
			await service.deleteUserDataExcel(this._adminId); //先删除

		return await service.getUserDataURL(this._adminId);
	}

	/** 导出数据 */
	async userDataExport() {
		await this.isManager();

		// 数据校验
		let rules = {
			condition: 'string|name=导出条件',
			fields: 'array',
		};

		// 取得数据
		let input = this.validateData(rules);

		let service = new AdminUserService();
		return await service.exportUserDataExcel(input.condition, input.fields, this._adminId);
	}

	/** 删除导出的用户数据 */
	async userDataDel() {
		await this.isManager();

		// 数据校验
		let rules = {};

		// 取得数据
		let input = this.validateData(rules);

		let service = new AdminUserService();
		await service.deleteUserDataExcel(this._adminId);
		return { ok: true };
	}
}

module.exports = AdminUserController;
