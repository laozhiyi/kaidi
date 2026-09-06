/**
 * Notes: 反馈投诉实体
 * Ver : CCMiniCloud Framework 2.0.1
 * Date: 2026-09-06
 */


const BaseProjectModel = require('./base_project_model.js');

class FeedbackModel extends BaseProjectModel {

}

// 集合名
FeedbackModel.CL = BaseProjectModel.C('feedback');

FeedbackModel.DB_STRUCTURE = {
	_pid: 'string|true',
	FB_ID: 'string|true',

	FB_USER_ID: 'string|true|comment=反馈用户ID',
	FB_USER_NAME: 'string|false|comment=用户姓名',
	FB_USER_MOBILE: 'string|false|comment=用户手机',

	FB_TYPE: 'string|true|comment=反馈类型 bug=功能异常,suggest=功能建议,complain=投诉,other=其他',
	FB_TITLE: 'string|true|comment=反馈标题',
	FB_CONTENT: 'string|true|comment=反馈内容',
	FB_CONTACT: 'string|false|comment=用户填写的联系方式',
	FB_IMG: 'array|true|default=[]|comment=反馈图片列表',

	FB_STATUS: 'int|true|default=0|comment=处理状态 0=待处理,1=已处理,2=已忽略',
	FB_REPLY: 'string|false|comment=管理员回复',
	FB_REPLY_TIME: 'int|true|default=0|comment=回复时间',

	FB_ADD_TIME: 'int|true',
	FB_EDIT_TIME: 'int|true',
	FB_ADD_IP: 'string|false',
	FB_EDIT_IP: 'string|false',
};

// 字段前缀
FeedbackModel.FIELD_PREFIX = "FB_";

/**
 * 反馈类型
 */
FeedbackModel.TYPE = {
	BUG: 'bug',
	SUGGEST: 'suggest',
	COMPLAIN: 'complain',
	OTHER: 'other'
};

FeedbackModel.TYPE_DESC = {
	bug: '功能异常',
	suggest: '功能建议',
	complain: '投诉举报',
	other: '其他'
};

/**
 * 处理状态
 */
FeedbackModel.STATUS = {
	PENDING: 0,
	DONE: 1,
	IGNORE: 2
};

FeedbackModel.STATUS_DESC = {
	0: '待处理',
	1: '已处理',
	2: '已忽略'
};

module.exports = FeedbackModel;
