/**
 * Notes: 管理员管理
 * Ver : CCMiniCloud Framework 2.0.1 ALL RIGHTS RESERVED BY cclinux0730 (wechat)
 * Date: 2021-07-11 07:48:00 
 */

const BaseProjectAdminService = require('./base_project_admin_service.js');
const util = require('../../../../framework/utils/util.js');
const dataUtil = require('../../../../framework/utils/data_util.js');
const timeUtil = require('../../../../framework/utils/time_util.js');
const AdminModel = require('../../../../framework/platform/model/admin_model.js');
const LogModel = require('../../../../framework/platform/model/log_model.js');
const passwordUtil = require('../../../../framework/utils/password_util.js');
const crypto = require('crypto');
const store = require('../operation_store.js');
const config = require('../../../../config/config.js');
const Roles = require('./admin_roles.js');
const UserModel = require('../../model/user_model.js');

class AdminMgrService extends BaseProjectAdminService {

	/** 生成后台登录会话，账号密码与微信登录共用。 */
	async _openSession(admin, userId, extra = {}) {
		const cnt = Number.isFinite(admin.ADMIN_LOGIN_CNT) ? admin.ADMIN_LOGIN_CNT : 0;
		const token = crypto.randomBytes(32).toString('hex');
		const tokenTime = timeUtil.time();
		await AdminModel.edit({ _id: admin._id }, {
			ADMIN_TOKEN: token,
			ADMIN_TOKEN_USER: userId,
			ADMIN_TOKEN_TIME: tokenTime,
			ADMIN_LOGIN_TIME: tokenTime,
			ADMIN_LOGIN_CNT: cnt + 1
		});
		const role = Roles.ofAdmin(admin);
		const last = (!admin.ADMIN_LOGIN_TIME) ? '尚未登录' : timeUtil.timestamp2Time(admin.ADMIN_LOGIN_TIME);
		this.insertLog('登录了系统', admin, LogModel.TYPE.SYS);
		return {
			token,
			role,
			roleLabel: Roles.label(role),
			name: admin.ADMIN_NAME,
			type: role === 'super' ? 1 : 0,
			last,
			cnt,
			...extra
		};
	}

	/** 微信登录后台：只认已授权角色的用户，权限来自用户记录。 */
	async wechatLogin(userId) {
		if (!userId) this.AppError('请先微信登录');
		const user = await UserModel.getOne({ USER_MINI_OPENID: userId }, '*');
		if (!user) this.AppError('请先在用户端点击微信登录，再进入管理后台');
		if (user.USER_STATUS === 9) this.AppError('账号已停用，无法进入管理后台');
		if (user.USER_STATUS !== 1) this.AppError('账号尚未通过注册审核，无法进入管理后台');
		const role = Roles.normalize(user.USER_ROLE);
		if (!role) this.AppError('该微信号还没有后台权限，请联系超级管理员授权');
		const admin = await this._syncAdmin(user, role);
		return await this._openSession(admin, userId, {
			credentialsOnly: false,
			platform: role === 'super',
			scopes: admin.ADMIN_SCOPES || [],
			userId: user._id,
			wechat: true
		});
	}

	/**
	 * 按用户记录维护微信后台账号。角色为空表示取消授权：
	 * 停用账号并清掉当前会话，避免已登录的旧令牌继续生效。
	 */
	async _syncAdmin(user, role) {
		const openid = user.USER_MINI_OPENID;
		let admin = await AdminModel.getOne({ ADMIN_USER_ID: user._id }, '*');
		if (!admin) admin = await AdminModel.getOne({ ADMIN_TOKEN_USER: openid }, '*');
		const now = timeUtil.time();
		const data = {
			ADMIN_NAME: admin && admin.ADMIN_NAME || user.USER_NAME || ('user' + String(user.USER_ID || '').slice(-8)),
			ADMIN_DESC: user.USER_NAME || '微信用户',
			ADMIN_PHONE: user.USER_MOBILE || '',
			ADMIN_USER_ID: user._id,
			ADMIN_TOKEN_USER: openid,
			ADMIN_ROLE: role || '',
			ADMIN_TYPE: role === 'super' ? 1 : 0,
			ADMIN_PLATFORM: role === 'super',
			ADMIN_STATUS: role ? 1 : 0,
			ADMIN_EDIT_TIME: now,
			ADMIN_EDIT_IP: this._ip || ''
		};
		if (!role) {
			data.ADMIN_TOKEN = '';
			data.ADMIN_TOKEN_TIME = 0;
		}
		if (admin) {
			await AdminModel.edit({ _id: admin._id }, data);
			return { ...admin, ...data };
		}
		await AdminModel.insert({
			...data,
			ADMIN_PASSWORD: passwordUtil.hash(crypto.randomBytes(18).toString('hex')),
			ADMIN_SCOPES: [],
			ADMIN_LOGIN_CNT: 0,
			ADMIN_LOGIN_TIME: 0,
			ADMIN_TOKEN: '',
			ADMIN_TOKEN_TIME: 0,
			_pid: this.getProjectId(),
			ADMIN_ADD_TIME: now,
			ADMIN_ADD_IP: this._ip || ''
		});
		return await AdminModel.getOne({ ADMIN_USER_ID: user._id }, '*');
	}

	/** 用户角色变化后同步后台账号与日志。 */
	async syncUserRole(user, role, myAdmin) {
		await this._syncAdmin(user, role);
		this.insertLog((role ? '授予了后台角色【' + Roles.label(role) + '】' : '取消了后台角色') + '，用户【' + (user.USER_NAME || user.USER_ID || '') + '】', myAdmin, LogModel.TYPE.SYS);
	}

	/** 用户停用/恢复时同步后台会话；角色保留，恢复后可重新登录。 */
	async setUserAdminActive(user, active) {
		const admin = await AdminModel.getOne({ ADMIN_USER_ID: user._id }, '*');
		if (!admin) return;
		const data = { ADMIN_STATUS: active ? 1 : 0, ADMIN_EDIT_TIME: timeUtil.time(), ADMIN_EDIT_IP: this._ip || '' };
		if (!active) { data.ADMIN_TOKEN = ''; data.ADMIN_TOKEN_TIME = 0; }
		await AdminModel.edit({ _id: admin._id }, data);
	}

	//**管理员登录  */
	async adminLogin(name, password, userId) {
		const credentialsOnly = config.ADMIN_LOGIN_CREDENTIALS_ONLY === true;
		if (!credentialsOnly) {
			await store.limitAdmin(this.getProjectId(),userId,'admin_login',10,900000);
			await store.limitAdmin(this.getProjectId(),name,'admin_account_login',30,900000);
		}

		// 判断是否存在
		let where = {
			...(credentialsOnly ? {} : { ADMIN_STATUS: 1 }),
			ADMIN_NAME: name
		}
		let fields = '*';
		let admin = await AdminModel.getOne(where, fields);
		if (!admin || !passwordUtil.verify(password, admin.ADMIN_PASSWORD))
			this.AppError('账号或密码错误');

		return await this._openSession(admin, userId, {
			credentialsOnly,
			platform: admin.ADMIN_PLATFORM === true,
			scopes: admin.ADMIN_SCOPES || [],
			wechat: false
		});

	}

	async clearLog() {
		const LogModel = require('../../../../framework/platform/model/log_model.js');
		let where = {
			_pid: this.getProjectId()
		};
		await LogModel.del(where);
	}

	/** 取得日志分页列表 */
	async getLogList({
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
			LOG_ADD_TIME: 'desc'
		};
		let fields = '*';
		let where = { and: { _pid: this.getProjectId() } };

		if (util.isDefined(search) && search) {
			search = String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			where.or = [{
				LOG_CONTENT: ['like', search]
			}, {
				LOG_ADMIN_DESC: ['like', search]
			}, {
				LOG_ADMIN_NAME: ['like', search]
			}];

		}
		if (sortType && util.isDefined(sortVal)) {
			// 搜索菜单
			switch (sortType) {
				case 'type':
					// 按类型
					where.and.LOG_TYPE = Number(sortVal);
					break;
			}
		}
		let result = await LogModel.getList(where, fields, orderBy, page, size, true, oldTotal);


		return result;
	}

	/** 获取所有管理员 */
	async getMgrList({
		search, // 搜索条件
		sortType, // 搜索菜单
		sortVal, // 搜索菜单
		orderBy, // 排序
		whereEx, //附加查询条件
		page,
		size,
		isTotal = true,
		oldTotal
	}) {
		orderBy = {
			ADMIN_ADD_TIME: 'desc'
		}
		let fields = 'ADMIN_NAME,ADMIN_STATUS,ADMIN_PHONE,ADMIN_TYPE,ADMIN_PLATFORM,ADMIN_SCOPES,ADMIN_LOGIN_CNT,ADMIN_LOGIN_TIME,ADMIN_DESC,ADMIN_EDIT_TIME,ADMIN_EDIT_IP';

		let where = {};
		where.and = {
			_pid: this.getProjectId() //复杂的查询在此处标注PID
		};
		if (util.isDefined(search) && search) {
			search = String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			where.or = [{
				ADMIN_NAME: ['like', search]
			},
			{
				ADMIN_PHONE: ['like', search]
			},
			{
				ADMIN_DESC: ['like', search]
			}
			];
		}
		if (sortType && util.isDefined(sortVal)) {
			// 搜索菜单
			switch (sortType) {
				case 'status':
					// 按类型
					where.and.ADMIN_STATUS = Number(sortVal);
					break;
				case 'type':
					// 按类型
					where.and.ADMIN_TYPE = Number(sortVal);
					break;
			}
		}

		return await AdminModel.getList(where, fields, orderBy, page, size, isTotal, oldTotal);
	}

	/** 删除管理员 */
	async delMgr(id, myAdminId, myAdmin) {
		// 不能删除自己
		if (id === myAdminId) {
			this.AppError('不能删除自己');
		}

		// 不能删除超级管理员
		let admin = await AdminModel.getOne({ _id: id }, 'ADMIN_TYPE,ADMIN_USER_ID');
		if (!admin) {
			this.AppError('管理员不存在');
		}
		if (admin.ADMIN_USER_ID) this.AppError('该账号由微信用户授权，请在用户管理中取消角色');
		if (admin.ADMIN_TYPE === 1) {
			this.AppError('不能删除超级管理员');
		}

		await AdminModel.del(id);

		// 写日志
		this.insertLog('删除了管理员', myAdmin, LogModel.TYPE.SYS);
	}

	/** 添加新的管理员 */
	async insertMgr({
		name,
		desc,
		phone,
		password
	}, myAdmin) {
		// 检查账号是否已存在
		let exist = await AdminModel.getOne({ ADMIN_NAME: name }, 'ADMIN_ID');
		if (exist) {
			this.AppError('账号已存在，请更换');
		}

		let data = {
			ADMIN_NAME: name,
			ADMIN_DESC: desc,
			ADMIN_PHONE: phone || '',
			ADMIN_PASSWORD: passwordUtil.hash(password),
			ADMIN_STATUS: 1,
			ADMIN_TYPE: 0, // 默认普通管理员
   ADMIN_PLATFORM: false,
   ADMIN_SCOPES: store.scope() ? [{schoolId:store.scope().schoolId,campusId:store.scope().campusId}] : [],
			ADMIN_LOGIN_CNT: 0,
			ADMIN_LOGIN_TIME: 0,
			ADMIN_TOKEN: '',
			ADMIN_TOKEN_TIME: 0,
			_pid: this.getProjectId(),
			ADMIN_ADD_TIME: this._timestamp,
			ADMIN_EDIT_TIME: this._timestamp,
			ADMIN_ADD_IP: this._ip || '',
			ADMIN_EDIT_IP: this._ip || '',
		};

		await AdminModel.insert(data);

		// 写日志
		this.insertLog('添加了新管理员【' + name + '】', myAdmin, LogModel.TYPE.SYS);
	}

	/** 修改状态 */
	async statusMgr(id, status, myAdminId, myAdmin) {
		// 不能修改自己
		if (id === myAdminId) {
			this.AppError('不能修改自己的状态');
		}

		let admin = await AdminModel.getOne({ _id: id }, 'ADMIN_TYPE,ADMIN_USER_ID');
		if (!admin) {
			this.AppError('管理员不存在');
		}
		if (admin.ADMIN_USER_ID) this.AppError('该账号由微信用户授权，请在用户管理中调整角色或停用用户');

		// 不能禁用超级管理员
		if (admin.ADMIN_TYPE === 1 && status === 0) {
			this.AppError('不能禁用超级管理员');
		}

		await AdminModel.edit(id, {
			ADMIN_STATUS: status,
			ADMIN_EDIT_TIME: this._timestamp,
			ADMIN_EDIT_IP: this._ip || '',
		});

		// 写日志
		this.insertLog('修改了管理员状态【状态:' + (status === 1 ? '启用' : '禁用') + '】', myAdmin, LogModel.TYPE.SYS);
	}


	/** 获取管理员信息 */
	async getMgrDetail(id) {
		let fields = '*';

		let where = {
			_id: id
		}
		let mgr = await AdminModel.getOne(where, fields);
		if (!mgr) return null;

		if (mgr) { delete mgr.ADMIN_PASSWORD; delete mgr.ADMIN_TOKEN; delete mgr.ADMIN_TOKEN_USER; }
		return mgr;
	}

	/** 修改管理员 */
	async editMgr(id, {
		name,
		desc,
		phone,
		password
	}, myAdmin) {
		// 检查账号是否已被其他管理员使用
		let exist = await AdminModel.getOne({ ADMIN_NAME: name }, 'ADMIN_ID');
		if (exist && exist._id !== id) {
			this.AppError('账号已被使用');
		}

		let data = {
			ADMIN_NAME: name,
			ADMIN_DESC: desc,
			ADMIN_PHONE: phone || '',
			ADMIN_EDIT_TIME: this._timestamp,
			ADMIN_EDIT_IP: this._ip || '',
		};

		// 如果传入了密码则更新密码
		if (password && password.length >= 6) {
			data.ADMIN_PASSWORD = passwordUtil.hash(password);
			data.ADMIN_TOKEN = ''; data.ADMIN_TOKEN_USER = ''; data.ADMIN_TOKEN_TIME = 0;
		}

		await AdminModel.edit(id, data);

		// 写日志
		this.insertLog('修改了管理员信息【' + name + '】', myAdmin, LogModel.TYPE.SYS);
	}

	/** 修改自身密码 */
	async pwdtMgr(adminId, oldPassword, password) {
		let admin = await AdminModel.getOne({ _id: adminId }, 'ADMIN_PASSWORD');
		if (!admin) {
			this.AppError('管理员不存在');
		}

		// 验证旧密码
		if (!passwordUtil.verify(oldPassword, admin.ADMIN_PASSWORD)) {
			this.AppError('旧密码不正确');
		}

		await AdminModel.edit(adminId, {
			ADMIN_PASSWORD: passwordUtil.hash(password),
			ADMIN_TOKEN: '', ADMIN_TOKEN_USER: '', ADMIN_TOKEN_TIME: 0,
			ADMIN_EDIT_TIME: this._timestamp,
			ADMIN_EDIT_IP: this._ip || '',
		});
	}
}

module.exports = AdminMgrService;
