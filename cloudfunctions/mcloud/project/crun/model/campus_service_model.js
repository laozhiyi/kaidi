/**
 * Notes: 校区客服实体
 * Ver : CCMiniCloud Framework 2.0.1
 * Date: 2026-09-06
 */


const BaseProjectModel = require('./base_project_model.js');

class CampusServiceModel extends BaseProjectModel {

}

// 集合名
CampusServiceModel.CL = BaseProjectModel.C('campus_service');

CampusServiceModel.DB_STRUCTURE = {
	_pid: 'string|true',
	CS_ID: 'string|true',

	CS_CAMPUS: 'string|true|comment=校区名称',
	CS_NAME: 'string|true|comment=客服/负责人姓名',
	CS_MOBILE: 'string|true|comment=手机号',
	CS_WECHAT: 'string|false|comment=微信号',
	CS_QQ: 'string|false|comment=QQ号',
	CS_WORK_TIME: 'string|false|comment=工作时间',
	CS_QR: 'string|false|comment=客服二维码',

	CS_ORDER: 'int|true|default=9999',
	CS_STATUS: 'int|true|default=1|comment=状态 0=禁用,1=正常',

	CS_ADD_TIME: 'int|true',
	CS_EDIT_TIME: 'int|true',
	CS_ADD_IP: 'string|false',
	CS_EDIT_IP: 'string|false',
};

// 字段前缀
CampusServiceModel.FIELD_PREFIX = "CS_";

module.exports = CampusServiceModel;
