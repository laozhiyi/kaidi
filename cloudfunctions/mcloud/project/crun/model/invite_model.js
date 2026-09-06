/**
 * Notes: 邀请好友实体
 * Ver : CCMiniCloud Framework 2.0.1
 * Date: 2026-09-06
 */


const BaseProjectModel = require('./base_project_model.js');

class InviteModel extends BaseProjectModel {

}

// 集合名
InviteModel.CL = BaseProjectModel.C('invite');

InviteModel.DB_STRUCTURE = {
	_pid: 'string|true',
	INV_ID: 'string|true',

	INV_USER_ID: 'string|true|comment=邀请人ID',
	INV_USER_NAME: 'string|false|comment=邀请人姓名',

	INV_ACCEPT_USER_ID: 'string|false|comment=被邀请人ID',
	INV_ACCEPT_USER_NAME: 'string|false|comment=被邀请人姓名',

	INV_CODE: 'string|true|comment=邀请码',
	INV_STATUS: 'int|true|default=0|comment=状态 0=已发出未注册,1=已注册',

	INV_REWARD_STATUS: 'int|true|default=0|comment=奖励发放 0=未发放,1=已发放',
	INV_REWARD_DESC: 'string|false|comment=奖励说明',

	INV_ADD_TIME: 'int|true',
	INV_EDIT_TIME: 'int|true',
	INV_ACCEPT_TIME: 'int|true|default=0',
	INV_ADD_IP: 'string|false',
	INV_EDIT_IP: 'string|false',
};

// 字段前缀
InviteModel.FIELD_PREFIX = "INV_";

/**
 * 邀请状态
 */
InviteModel.STATUS = {
	PENDING: 0,
	ACCEPTED: 1
};

InviteModel.STATUS_DESC = {
	0: '待注册',
	1: '已注册'
};

module.exports = InviteModel;
