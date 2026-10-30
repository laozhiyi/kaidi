/**
 * Notes: 系统管理员实体 
 * Date: 2021-03-15 19:20:00 
 * Ver : CCMiniCloud Framework 2.0.5 ALL RIGHTS RESERVED BY CCLINUX0730 (wechat)
 */


const BaseModel = require('./base_model.js');

class AdminModel extends BaseModel {

}

// 集合名
AdminModel.CL = BaseModel.C('admin');

AdminModel.DB_STRUCTURE = {
	_pid: 'string|true',
	ADMIN_ID: 'string|true',
	ADMIN_NAME: 'string|true', 
	ADMIN_DESC: 'string|true',
	ADMIN_PHONE: 'string|false|comment=手机',
	ADMIN_PASSWORD: 'string|true|comment=密码',
	ADMIN_STATUS: 'int|true|default=1|comment=状态：0=禁用 1=启用',

	ADMIN_LOGIN_CNT: 'int|true|default=0|comment=登录次数',
	ADMIN_LOGIN_TIME: 'int|true|default=0|comment=最后登录时间',
	ADMIN_TYPE: 'int|true|default=0|comment=类型 0=普通管理员 1=超级管理员',
 ADMIN_PLATFORM: 'bool|true|default=false',
 // 安装时创建的账号密码账号带此标记，是整套权限的根；老数据无该字段时由
 // admin_roles.isRoot() 按「账号密码 + 平台 + 超管」兼容识别。必须在此声明，
 // 否则首次安装 AdminModel.insert 会因字段未定义被判为脏数据。
 ADMIN_ROOT: 'bool|false|comment=安装根账号',
 ADMIN_SCOPES: 'array|true|default=[]',
 // 微信登录的后台账号由用户记录授权而来，ADMIN_USER_ID 指向用户文档。
 // ADMIN_WECHAT 标记该账号由微信身份创建；账号密码管理员的这个标记始终为空，
 // 用来区分两类账号，避免微信身份接管账号密码管理员。
 ADMIN_USER_ID: 'string|false|comment=关联用户文档',
 ADMIN_WECHAT: 'bool|true|default=false|comment=由微信用户授权创建',
 ADMIN_ROLE: 'string|false|comment=超级管理员 super/管理员 admin/客服 service',

	ADMIN_TOKEN: 'string|false|comment=当前登录token',
	ADMIN_TOKEN_USER: 'string|false',
	ADMIN_TOKEN_TIME: 'int|true|default=0|comment=当前登录token time',

	ADMIN_ADD_TIME: 'int|true',
	ADMIN_EDIT_TIME: 'int|true',
	ADMIN_ADD_IP: 'string|false',
	ADMIN_EDIT_IP: 'string|false',
};

// 字段前缀
AdminModel.FIELD_PREFIX = "ADMIN_";






module.exports = AdminModel;
