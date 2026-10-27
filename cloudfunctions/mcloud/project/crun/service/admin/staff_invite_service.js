/**
 * Notes: 客服邀请码
 * 客服是工作人员，不应该被学生注册流程（学号/学生证/免责声明/审核）挡住。
 * 管理员生成一次性邀请码，工作人员微信登录后输入即可获得 service 权限。
 */

const crypto = require('crypto');
const BaseProjectService = require('../base_project_service.js');
const store = require('../operation_store.js');
const timeUtil = require('../../../../framework/utils/time_util.js');
const StaffInviteModel = require('../../model/staff_invite_model.js');
const UserModel = require('../../model/user_model.js');
const Roles = require('./admin_roles.js');

// 去掉容易看错的 0/O/1/I，方便口头或截图传达
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LEN = 8;
const MAX_HOURS = 72;

class StaffInviteService extends BaseProjectService {

	_code() {
		let code = '';
		for (let i = 0; i < CODE_LEN; i++) code += ALPHABET[crypto.randomInt(ALPHABET.length)];
		return code;
	}

	/**
	 * 邀请码的唯一性锚定在确定性文档 ID 上：同项目同一个码只可能对应一条记录。
	 * 这样不依赖云端唯一索引（微信云开发没有建索引的编程接口），
	 * 并发撞码时事务冲突重试会让后到的一方换码，而不是写出第二条同码记录。
	 */
	_codeId(code) {
		return store.key(this.getProjectId(), 'staff_invite', code);
	}

	/** 管理员生成一次性客服邀请码 */
	async create(adminId, hours = 24) {
		hours = Math.min(MAX_HOURS, Math.max(1, Number(hours) || 24));
		const now = Date.now(), pid = this.getProjectId();
		return store.transaction(async tx => {
			let code = '', id = '';
			for (let i = 0; i < 6 && !id; i++) {
				code = this._code();
				if (!await store.get(tx, 'staff_invite', this._codeId(code))) id = this._codeId(code);
			}
			if (!id) this.AppError('邀请码生成繁忙，请稍后重试');
			await store.set(tx, 'staff_invite', id, {
				_pid: pid,
				INVITE_CODE: code,
				INVITE_ROLE: 'service',
				INVITE_STATUS: 1,
				INVITE_CREATED_BY: adminId,
				INVITE_CREATED_AT: now,
				INVITE_EXPIRES_AT: now + hours * 3600000
			});
			return {
				code,
				role: 'service',
				roleLabel: Roles.label('service'),
				expiresAt: timeUtil.timestamp2Time(now + hours * 3600000, 'Y-M-D h:m')
			};
		});
	}

	/** 工作人员激活邀请码：直接获得客服权限，跳过学生注册资料 */
	async redeem(userId, code, name) {
		if (!userId) this.AppError('请先微信登录');
		const user = await UserModel.getOne({ USER_MINI_OPENID: userId }, '_id,USER_NAME,USER_STATUS,USER_ROLE');
		if (!user) this.AppError('请先在用户端点击微信登录，再激活客服邀请码');
		if (user.USER_STATUS === 9) this.AppError('账号已停用，请联系管理员');
		if (Roles.normalize(user.USER_ROLE)) this.AppError('当前账号已有后台权限，无需重复激活');

		code = String(code || '').trim().toUpperCase();
		if (!/^[A-Z0-9]{6,12}$/.test(code)) this.AppError('邀请码格式不正确');

		await store.limit(this.getProjectId(), userId, 'staff_invite', 5, 3600000);
		// 按字段查，而不是直接拼确定性 ID：早期人工导入的记录也能激活。
		// 真正的并发一致性由事务内重新读取并复核状态保证。
		// 这里再取两条：若同码出现多条记录（只可能来自控制台手工导入或直接写库），
		// 宁可拒绝并让管理员清理，也不能随机命中其中一条，否则两个人会抢同一个权限。
		const found = await StaffInviteModel.getAll({ INVITE_CODE: code }, '_id', {}, 2);
		if (!found.length) this.AppError('邀请码不存在，请向管理员确认');
		if (found.length > 1) this.AppError('该邀请码存在重复记录，请联系管理员清理后再使用');
		const inviteId = found[0]._id;

		const pid = this.getProjectId(), now = Date.now();
		return store.transaction(async tx => {
			const invite = await store.get(tx, 'staff_invite', inviteId);
			if (!invite || invite._pid !== pid) this.AppError('邀请码不存在或已被清理，请向管理员确认');
			// 0=已使用，2=维护任务标记的已过期；过期判断以时间戳为准，状态只用于文案。
			if (invite.INVITE_STATUS === 0) this.AppError('邀请码已被使用，请向管理员重新获取');
			if (invite.INVITE_STATUS !== 1) this.AppError('邀请码已过期，请向管理员重新获取');
			if (!(invite.INVITE_EXPIRES_AT > now)) this.AppError('邀请码已过期，请向管理员重新获取');
			const current = await store.get(tx, 'user', user._id);
			if (!current || current.USER_STATUS === 9) this.AppError('账号状态已变化，请重新微信登录');
			if (Roles.normalize(current.USER_ROLE)) this.AppError('当前账号已有后台权限');
			await store.set(tx, 'staff_invite', inviteId, {
				...invite, INVITE_STATUS: 0, INVITE_USED_BY: userId, INVITE_USED_AT: now
			});
			await store.set(tx, 'user', user._id, {
				...current,
				USER_NAME: String(name || '').trim() || current.USER_NAME || '',
				USER_ROLE: Roles.normalize(invite.INVITE_ROLE) || 'service',
				USER_ROLE_TIME: now,
				USER_ROLE_BY: 'invite',
				USER_STAFF: true,
				USER_STATUS: 1,
				USER_EDIT_TIME: now
			});
			return { ok: true, role: Roles.normalize(invite.INVITE_ROLE) || 'service', roleLabel: Roles.label(invite.INVITE_ROLE) };
		});
	}
}

module.exports = StaffInviteService;
