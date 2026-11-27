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
const profileRules = require('../profile_rules.js');

// 导出用户数据KEY
const EXPORT_USER_DATA_KEY = 'EXPORT_USER_DATA';

// 客服只做注册审核：列表与详情都按白名单重建，学号、学生证图片、openid
// 与注册资料的其它内容不会离开服务端，手机号一律打码。
const SERVICE_LIST_FIELDS = ['_id', 'USER_NAME', 'USER_PIC', 'USER_MOBILE', 'USER_STATUS', 'USER_ADD_TIME'];
const SERVICE_DETAIL_FIELDS = [...SERVICE_LIST_FIELDS, 'USER_LOGIN_TIME', 'USER_CHECK_REASON', 'USER_ROLE'];
// 用户列表页面实际只按注册时间排序，其余字段一律拒绝。
const ORDER_FIELDS = ['USER_ADD_TIME'];
// 待审核（USER_STATUS=0）：客服这时候要核对学号与学生证，只读放开这两项。
const USER_STATUS_PENDING = 0;
// 微信登录就会建出 USER_STATUS=0 的账号，但只有提交过注册资料的才算「待审核」；
// 没提交的列为「未完善资料」，不进审核列表，也不能被通过或驳回。
const PROFILE_FIELDS = ['USER_PROFILE_COMPLETE', 'USER_FORMS'];

/** 138****1234；非 11 位手机号原样返回，避免把空值变成星号串。 */
function maskMobile(value) {
	const phone = String(value == null ? '' : value).trim();
	return /^\d{11}$/.test(phone) ? phone.slice(0, 3) + '****' + phone.slice(-4) : phone;
}

function campusOf(forms) {
	const item = (Array.isArray(forms) ? forms : []).find(row => row && row.mark === 'campus');
	return item ? String(item.val == null ? '' : item.val) : '';
}

/** 待审核用户只放开学号与学生证：学号回文字，学生证回原始 fileID 由控制器换短期链接。 */
function auditOf(forms) {
	const pick = mark => (Array.isArray(forms) ? forms : []).find(row => row && row.mark === mark);
	const id = pick('studentId'), card = pick('studentCard');
	const files = card ? (Array.isArray(card.val) ? card.val : [card.val]) : [];
	return {
		studentId: id && id.val != null ? String(id.val) : '',
		studentCard: files.filter(value => typeof value === 'string' && value)
	};
}

/** 按白名单重建客服可见的用户对象，只额外补所在校区与待审核时的审核资料。 */
function serviceUser(row, fields, options = {}) {
	if (!row) return row;
	const out = { _id: row._id, USER_CAMPUS: campusOf(row.USER_FORMS) };
	for (const key of fields) {
		if (key === '_id' || row[key] === undefined) continue;
		out[key] = row[key];
	}
	if (row.USER_MOBILE !== undefined) out.USER_MOBILE = maskMobile(row.USER_MOBILE);
	// 只有待审核状态才把学号与学生证交给控制器做只读核对；列表永远不带这两项。
	if (options.audit === true && Number(row.USER_STATUS) === USER_STATUS_PENDING && row.USER_PROFILE_DONE) out.USER_AUDIT = auditOf(row.USER_FORMS);
	out.USER_PROFILE_DONE = row.USER_PROFILE_DONE === true;
	return out;
}

/** 资料是否已提交：与用户端「能否发单」用同一套判断。 */
function withProfileDone(row) {
	if (row) row.USER_PROFILE_DONE = profileRules.isComplete(row);
	return row;
}

class AdminUserService extends BaseProjectAdminService {


	/** 获得某个用户信息。客服视角只返回脱敏白名单字段。 */
	async getUser({
		userId,
		fields = '*'
	}, options = {}) {
		if (typeof userId !== 'string' || !userId.trim()) this.AppError('请选择有效的用户');
		const limited = options.service === true;
		const projection = limited ? [...SERVICE_DETAIL_FIELDS, ...PROFILE_FIELDS].join(',') : fields;
		// Current lists use the document id. Old links may contain an OpenID or
		// USER_ID; resolve them here and always mutate the resolved document.
		for (const field of ['_id', 'USER_MINI_OPENID', 'USER_ID']) {
			const user = await UserModel.getOne({ [field]: userId.trim() }, projection);
			if (!user) continue;
			withProfileDone(user);
			return limited ? serviceUser(user, SERVICE_DETAIL_FIELDS, options) : user;
		}
		return null;
	}

	/** orderBy 白名单：只接受页面实际使用的注册时间排序。 */
	_orderBy(orderBy) {
		const entries = Object.entries(orderBy || {});
		if (!entries.length) return { USER_ADD_TIME: 'desc' };
		const out = {};
		for (const [field, direction] of entries) {
			if (!ORDER_FIELDS.includes(field)) this.AppError('排序字段无效');
			const dir = String(direction).toLowerCase();
			if (dir !== 'asc' && dir !== 'desc') this.AppError('排序方式无效');
			out[field] = dir;
		}
		return out;
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
	}, options = {}) {

		orderBy = orderBy || { USER_ADD_TIME: 'desc' };
		const limited = options.service === true;
		let fields = limited ? [...SERVICE_LIST_FIELDS, ...PROFILE_FIELDS].join(',') : '*';


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
					if (Number(sortVal) === USER_STATUS_PENDING) where.and.USER_PROFILE_COMPLETE = true;
					break;
				case 'incomplete':
					where.and.USER_STATUS = USER_STATUS_PENDING;
					where.and.USER_PROFILE_COMPLETE = ['<>', true];
					break;
				case 'sort': {
					orderBy = this.fmtOrderBySort(sortVal, 'USER_ADD_TIME');
					break;
				}
			}
		}
		// 排序在拼装完条件后统一校验：无论 orderBy 来自入参还是 sortVal，都只允许白名单字段。
		orderBy = this._orderBy(orderBy);
		let result = await UserModel.getList(where, fields, orderBy, page, size, true, oldTotal, false);
		result.list = (result.list || []).map(withProfileDone);
		if (limited) result.list = result.list.map(row => serviceUser(row, SERVICE_LIST_FIELDS));

		// 为导出增加一个参数condition
		result.condition = encodeURIComponent(JSON.stringify(where));

		return result;
	}

	async statusUser(id, status, reason, myAdmin) {
		if (!id) this.AppError('id不能为空');
		if (![0,1,8,9].includes(Number(status))) this.AppError('用户状态无效');
		const user = await this.getUser({ userId: id });
		if (!user) this.AppError('用户不存在');
		this._assertManage(user, myAdmin, '停用');
		const next = Number(status);
		// 客服只审核「待审核」的账号；审核未过、已停用、正常账号的状态调整都归管理员。
		if (myAdmin && Roles.ofAdmin(myAdmin) === 'service' && Number(user.USER_STATUS) !== USER_STATUS_PENDING) this.AppError('客服只能审核待审核的账号');
		// 通过 / 不通过都要求已提交注册资料；未完善资料的停用账号恢复时回到 0。
		if ((next === 1 || next === 8) && !profileRules.isComplete(user)) this.AppError('该用户还没有提交注册资料，暂时无法审核');
		let data = { USER_STATUS: Number(status), USER_CHECK_REASON: String(reason || '').trim() };
		if (data.USER_CHECK_REASON.length > 200) this.AppError('处理说明不能超过200字');
		if (Number(status) === 8 && !data.USER_CHECK_REASON) this.AppError('请填写审核不通过的原因');
		await UserModel.edit({ _id: user._id }, data);
		// 审核结果决定邀请关系是否成立：待审核 → 已注册 / 未通过。
		await this._syncInvite(user, Number(status));
		// 停用或恢复账号时同步后台会话，避免已登录的后台令牌继续生效。
		await new AdminMgrService().setUserAdminActive(user, Number(status) !== 9);
		return { id: user._id, status: Number(status) };
	}

	/**
	 * 授权 / 取消授权后台角色。
	 * - 初始管理员：可授予或取消超级管理员、管理员、客服
	 * - 超级管理员：只能授予或取消管理员、客服；同级超管不能互相改
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
		// 只有微信身份登录的后台账号才代表“自己”。账号密码管理员与微信用户是两套
		// 身份：初始平台管理员正是用它给自己的微信号授权，若在这里按 ADMIN_USER_ID
		// 一刀切，管理员会被判定成“在改自己”，既无法授权也无法取消授权。
		const selfUserId = myAdmin && myAdmin.ADMIN_WECHAT === true ? myAdmin.ADMIN_USER_ID : '';
		if (selfUserId && String(selfUserId) === String(user._id)) this.AppError('不能修改自己的后台角色');
		const current = Roles.normalize(user.USER_ROLE);
		if (current === next) return { id: user._id, role: next, roleLabel: Roles.label(next) };

		// 现状与目标角色都要校验：只校验目标角色的话，管理员把同级或上级
		// 「降成客服」就能绕过层级限制。
		const guard = Roles.grantError(myAdmin, current, next);
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

	/**
	 * 主动退出后台。只允许退自己，且不能是最后一位超管：
	 * 超管交接要先由初始管理员授权继任者，再由本人退出，避免中途无人可管。
	 */
	async leaveAdmin(userId, myAdmin) {
		if (!userId) this.AppError('请先登录');
		const user = await this.getUser({ userId });
		if (!user) this.AppError('用户不存在');
		const selfUserId = myAdmin && myAdmin.ADMIN_WECHAT === true ? myAdmin.ADMIN_USER_ID : '';
		if (!selfUserId || String(selfUserId) !== String(user._id)) this.AppError('只能退出自己的后台权限');
		const current = Roles.normalize(user.USER_ROLE);
		if (!current) this.AppError('当前账号没有后台权限');
		if (current === 'super') {
			const supers = await UserModel.count({ USER_ROLE: 'super' });
			if (supers <= 1) this.AppError('至少需要保留一位超级管理员，请先请初始管理员授权继任者');
		}
		await UserModel.edit({ _id: user._id }, { USER_ROLE: '', USER_ROLE_TIME: 0, USER_ROLE_BY: '' });
		await new AdminMgrService().syncUserRole({ ...user, USER_ROLE: '' }, '', myAdmin);
		return { id: user._id, role: '' };
	}

	/**删除用户 */
	async delUser(id, myAdmin) {
		if (!id) this.AppError('id不能为空');
		const user = await this.getUser({ userId: id });
		if (!user) this.AppError('用户不存在');
		this._assertManage(user, myAdmin, '停用');
		await UserModel.edit({ _id: user._id }, { USER_STATUS:9, USER_CHECK_REASON:'管理员停用（保留履约记录）' });
		await this._syncInvite(user, 9);
		await new AdminMgrService().setUserAdminActive(user, false);
		return { id: user._id };
	}

	/**
	 * 停用 / 移除后台账号同样是「层级操作」：管理员不能停用超管或同级管理员，
	 * 否则把上级账号一停，等于间接夺走了对方的权限。超管之间也互不可停。
	 */
	_assertManage(user, myAdmin, action) {
		if (!myAdmin || !Roles.isStaff(user.USER_ROLE)) return;
		const error = Roles.manageError(myAdmin, user.USER_ROLE, action);
		if (error) this.AppError(error);
	}

	/** 邀请关系统计只认「审核通过」的账号，审核/停用后同步回写，失败不影响主流程 */
	async _syncInvite(user, status) {
		if (!user || !user.USER_MINI_OPENID) return;
		try { await new (require('../invite_service.js'))().syncAcceptedStatus(user.USER_MINI_OPENID, status); }
		catch (error) { console.warn('[invite] status sync failed', { code: error.code || 'INVITE_SYNC_ERROR' }); }
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
