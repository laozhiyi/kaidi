/**
 * Notes: 兼职实体
 * Ver : CCMiniCloud Framework 2.0.1 ALL RIGHTS RESERVED BY cclinux0730 (wechat)
 * Date: 2024-03-23 04:00:00 
 */


const BaseProjectModel = require('./base_project_model.js');

class MailModel extends BaseProjectModel {

}

// 集合名
MailModel.CL = BaseProjectModel.C('mail');

MailModel.DB_STRUCTURE = {
	_pid: 'string|true',

	MAIL_ID: 'string|true',

	MAIL_STATUS: 'int|true|default=0|comment=状态 0=待接单,1=配送中,9=已完成,99=已取消',
	MAIL_END_TIME: 'int|false|default=0|comment=截止时间',

	MAIL_CATE_ID: 'string|true|default=0|comment=分类',
	MAIL_CATE_NAME: 'string|false|comment=分类冗余',
	MAIL_ORDER: 'int|true|default=9999',
	MAIL_VOUCH: 'int|true|default=0',

	MAIL_USER_ID: 'string|true|comment=发布用户ID',
	MAIL_USER_NAME: 'string|false',

	MAIL_ACCEPT_USER_ID: 'string|false|comment=接单用户ID',
	MAIL_ACCEPT_USER_NAME: 'string|false|comment=接单用户名',
	MAIL_ACCEPT_PAY_PIC: 'string|false|comment=接单者收款码',
	MAIL_ACCEPT_TIME: 'int|true|default=0',   

	MAIL_OVER_TIME: 'int|true|default=0',   

	MAIL_DAY: 'string|false|comment=日期',

	MAIL_FORMS: 'array|true|default=[]',
	MAIL_OBJ: 'object|true|default={}',

	MAIL_FAV_CNT: 'int|true|default=0',
	MAIL_FAV_LIST: 'array|true|default=[]',
	MAIL_VIEW_CNT: 'int|true|default=0',   

	MAIL_QR: 'string|false',

	// ========== 支付相关字段 ==========
	MAIL_PAY_STATUS: 'int|true|default=0|comment=支付状态 0=未支付,1=已支付,2=已退款',
	MAIL_PAY_TIME: 'int|true|default=0|comment=支付时间',
	MAIL_PAY_NO: 'string|false|comment=支付订单号',
	MAIL_TOTAL_FEE: 'int|true|default=0|comment=总费用(分)',

	MAIL_ADD_TIME: 'int|true',
	MAIL_EDIT_TIME: 'int|true',
	MAIL_ADD_IP: 'string|false',
	MAIL_EDIT_IP: 'string|false',

};

// 字段前缀
MailModel.FIELD_PREFIX = "MAIL_";

module.exports = MailModel;
