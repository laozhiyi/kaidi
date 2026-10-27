/**
 * Notes: 客服对话消息实体（全校共享客服池，一个用户一条会话）
 */

const BaseProjectModel = require('./base_project_model.js');
const cloudBase = require('../../../framework/cloud/cloud_base.js');

class CampusServiceMessageModel extends BaseProjectModel {

	/**
	 * 在数据库内按用户分组，避免截取最近若干条消息导致旧会话消失。
	 * 共享客服池没有「客服席位」维度，会话唯一键就是用户 openid。
	 */
	static async getSessionList(pid, filter = {}, page = 1, size = 20) {
		const db = cloudBase.getCloud().database();
		const $ = db.command.aggregate;
		const match = {};
		if (Array.isArray(filter.userIds)) {
			if (!filter.userIds.length) return { page, size, total: 0, count: 0, list: [] };
			match.CSM_USER_ID = db.command.in(filter.userIds);
		} else if (filter.openidPattern) {
			match.CSM_USER_ID = db.RegExp({ regexp: filter.openidPattern, options: 'i' });
		}
		const pipeline = () => {
			let query = db.collection(this.CL).aggregate()
				.match({ _pid: pid })
				.sort({ CSM_ADD_TIME: -1, CSM_ID: -1 })
				.group({
					_id: '$CSM_USER_ID',
					CSM_USER_ID: $.first('$CSM_USER_ID'),
					lastContent: $.first('$CSM_CONTENT'),
					lastSender: $.first('$CSM_SENDER'),
					lastTime: $.first('$CSM_ADD_TIME'),
					lastSessionId: $.first('$CSM_SESSION_ID'),
					lastStaffName: $.first('$CSM_STAFF_NAME'),
					unread: $.sum($.cond({ if: $.and([$.eq(['$CSM_SENDER', 'user']), $.eq(['$CSM_READ', 0])]), then: 1, else: 0 }))
				});
			if (Object.keys(match).length) query = query.match(match);
			return query;
		};
		const [count, result] = await Promise.all([
			pipeline().count('total').end(),
			pipeline().sort({ lastTime: -1, _id: -1 }).skip((page - 1) * size).limit(size).end()
		]);
		const total = count.list.length ? count.list[0].total : 0;
		return { page, size, total, count: Math.ceil(total / size), list: result.list };
	}
}

CampusServiceMessageModel.CL = BaseProjectModel.C('campus_service_message');

CampusServiceMessageModel.DB_STRUCTURE = {
	_pid: 'string|true',
	CSM_ID: 'string|true',
	CSM_SESSION_ID: 'string|true|comment=会话ID',
	CSM_SERVICE_ID: 'string|false|comment=历史客服席位ID（旧数据）',
	CSM_USER_ID: 'string|true|comment=咨询用户openid',
	CSM_SENDER: 'string|true|comment=发送方 user=用户,admin=客服',
	CSM_STAFF_ID: 'string|false|comment=回复客服的后台账号ID',
	CSM_STAFF_NAME: 'string|false|comment=回复客服显示名',
	CSM_CONTENT: 'string|true|comment=消息内容',
	CSM_READ: 'int|true|default=0|comment=接收方读取状态 0=未读,1=已读',
	CSM_ADD_TIME: 'int|true',
	CSM_EDIT_TIME: 'int|true',
};

CampusServiceMessageModel.FIELD_PREFIX = 'CSM_';

module.exports = CampusServiceMessageModel;
