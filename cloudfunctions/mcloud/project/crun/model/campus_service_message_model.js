/**
 * Notes: 校区客服对话消息实体
 */

const BaseProjectModel = require('./base_project_model.js');
const cloudBase = require('../../../framework/cloud/cloud_base.js');
const CampusServiceModel = require('./campus_service_model.js');

class CampusServiceMessageModel extends BaseProjectModel {

	/** 在数据库内按会话分组，避免截取最近1000条消息导致旧会话消失。 */
	static async getSessionList(pid, search, page, size) {
		const db = cloudBase.getCloud().database();
		const $ = db.command.aggregate;
		const pipeline = () => {
			let query = db.collection(this.CL).aggregate()
				.match({ _pid: pid })
				.sort({ CSM_ADD_TIME: -1, CSM_ID: -1 })
				.group({
					_id: '$CSM_SESSION_ID',
					CSM_SERVICE_ID: $.first('$CSM_SERVICE_ID'),
					CSM_USER_ID: $.first('$CSM_USER_ID'),
					lastContent: $.first('$CSM_CONTENT'),
					lastSender: $.first('$CSM_SENDER'),
					lastTime: $.first('$CSM_ADD_TIME'),
					unread: $.sum($.cond({ if: $.and([$.eq(['$CSM_SENDER', 'user']), $.eq(['$CSM_READ', 0])]), then: 1, else: 0 }))
				})
				.lookup({ from: CampusServiceModel.CL, localField: 'CSM_SERVICE_ID', foreignField: '_id', as: 'service' })
				.unwind('$service')
				.match({ 'service._pid': pid });
			if (search) {
				let pattern = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
				query = query.match(db.command.or([
					{ 'service.CS_CAMPUS': db.RegExp({ regexp: pattern, options: 'i' }) },
					{ 'service.CS_NAME': db.RegExp({ regexp: pattern, options: 'i' }) },
					{ CSM_USER_ID: db.RegExp({ regexp: pattern, options: 'i' }) }
				]));
			}
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
	CSM_SERVICE_ID: 'string|true|comment=客服记录ID',
	CSM_USER_ID: 'string|true|comment=用户openid',
	CSM_SENDER: 'string|true|comment=发送方 user=用户,admin=客服',
	CSM_CONTENT: 'string|true|comment=消息内容',
	CSM_READ: 'int|true|default=0|comment=读取状态 0=未读,1=已读',
	CSM_ADD_TIME: 'int|true',
	CSM_EDIT_TIME: 'int|true',
};

CampusServiceMessageModel.FIELD_PREFIX = 'CSM_';

module.exports = CampusServiceMessageModel;
