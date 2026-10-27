/**
 * Notes: 客服邀请码实体（一次性，用于给工作人员开通后台权限）
 */

const BaseProjectModel = require('./base_project_model.js');

class StaffInviteModel extends BaseProjectModel {

}

StaffInviteModel.CL = BaseProjectModel.C('staff_invite');

StaffInviteModel.DB_STRUCTURE = {
	_pid: 'string|true',
	INVITE_CODE: 'string|true|comment=邀请码',
	INVITE_ROLE: 'string|true|default=service|comment=授予角色',
	INVITE_STATUS: 'int|true|default=1|comment=状态 1=待使用,0=已使用',
	INVITE_CREATED_BY: 'string|false|comment=创建人后台ID',
	INVITE_CREATED_AT: 'int|true',
	INVITE_EXPIRES_AT: 'int|true',
	INVITE_USED_BY: 'string|false|comment=使用者openid',
	INVITE_USED_AT: 'int|false',
};

StaffInviteModel.FIELD_PREFIX = 'INVITE_';

module.exports = StaffInviteModel;
