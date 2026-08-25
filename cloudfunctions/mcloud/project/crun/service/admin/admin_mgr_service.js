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
const md5Lib = require('../../../../framework/lib/md5_lib.js');

class AdminMgrService extends BaseProjectAdminService {

	//**管理员登录  */
	async adminLogin(name, password) {

		// 判断是否存在
		let where = {
			ADMIN_STATUS: 1,
			ADMIN_NAME: name,
			ADMIN_PASSWORD: md5Lib.md5(password)
		}
		let fields = 'ADMIN_ID,ADMIN_NAME,ADMIN_DESC,ADMIN_TYPE,ADMIN_LOGIN_TIME,ADMIN_LOGIN_CNT';
		let admin = await AdminModel.getOne(where, fields);
		if (!admin)
			this.AppError('管理员不存在或者已停用');

		let cnt = admin.ADMIN_LOGIN_CNT;

		// 生成token
		let token = dataUtil.genRandomString(32);
		let tokenTime = timeUtil.time();
		let data = {
			ADMIN_TOKEN: token,
			ADMIN_TOKEN_TIME: tokenTime,
			ADMIN_LOGIN_TIME: timeUtil.time(),
			ADMIN_LOGIN_CNT: cnt + 1
		}
		await AdminModel.edit(where, data);

		let type = admin.ADMIN_TYPE;
		let last = (!admin.ADMIN_LOGIN_TIME) ? '尚未登录' : timeUtil.timestamp2Time(admin.ADMIN_LOGIN_TIME);

		// 写日志
		this.insertLog('登录了系统', admin, LogModel.TYPE.SYS);

		return {
			token,
			name: admin.ADMIN_NAME,
			type,
			last,
			cnt
		}

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
		let where = {};

		if (util.isDefined(search) && search) {
			where.or = [{
				LOG_CONTENT: ['like', search]
			}, {
				LOG_ADMIN_DESC: ['like', search]
			}, {
				LOG_ADMIN_NAME: ['like', search]
			}];

		} else if (sortType && util.isDefined(sortVal)) {
			// 搜索菜单
			switch (sortType) {
				case 'type':
					// 按类型
					where.LOG_TYPE = Number(sortVal);
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
		let fields = 'ADMIN_NAME,ADMIN_STATUS,ADMIN_PHONE,ADMIN_TYPE,ADMIN_LOGIN_CNT,ADMIN_LOGIN_TIME,ADMIN_DESC,ADMIN_EDIT_TIME,ADMIN_EDIT_IP';

		let where = {};
		where.and = {
			_pid: this.getProjectId() //复杂的查询在此处标注PID
		};
		if (util.isDefined(search) && search) {
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
		} else if (sortType && util.isDefined(sortVal)) {
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
		let admin = await AdminModel.getOne({ _id: id }, 'ADMIN_TYPE');
		if (!admin) {
			this.AppError('管理员不存在');
		}
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
			ADMIN_PASSWORD: md5Lib.md5(password),
			ADMIN_STATUS: 1,
			ADMIN_TYPE: 0, // 默认普通管理员
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

		let admin = await AdminModel.getOne({ _id: id }, 'ADMIN_TYPE');
		if (!admin) {
			this.AppError('管理员不存在');
		}

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
			data.ADMIN_PASSWORD = md5Lib.md5(password);
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
		if (admin.ADMIN_PASSWORD !== md5Lib.md5(oldPassword)) {
			this.AppError('旧密码不正确');
		}

		await AdminModel.edit(adminId, {
			ADMIN_PASSWORD: md5Lib.md5(password),
			ADMIN_EDIT_TIME: this._timestamp,
			ADMIN_EDIT_IP: this._ip || '',
		});
	}
}

module.exports = AdminMgrService;