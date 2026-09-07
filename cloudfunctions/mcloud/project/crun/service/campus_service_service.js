/**
 * Notes: 校区客服模块业务逻辑
 * Ver : CCMiniCloud Framework 2.0.1
 * Date: 2026-09-06
 */

const BaseProjectService = require('./base_project_service.js');
const util = require('../../../framework/utils/util.js');
const CampusServiceModel = require('../model/campus_service_model.js');
const CampusServiceMessageModel = require('../model/campus_service_message_model.js');
const CAMPUSES = ['育才校区', '王城校区', '雁山校区'];
const timeUtil = require('../../../framework/utils/time_util.js');

class CampusServiceService extends BaseProjectService {

	_normalizeCampus(campus) {
		campus = String(campus || '').trim();
		if (['育才', '王城', '雁山'].includes(campus)) campus += '校区';
		if (!CAMPUSES.includes(campus)) this.AppError('请选择育才、王城或雁山校区');
		return campus;
	}

	/** 取得校区客服列表 */
	async getCampusServiceList({
		search,
		sortType,
		sortVal,
		orderBy,
		page,
		size,
		isTotal = true,
		oldTotal
	}) {

		orderBy = orderBy || {
			'CS_ORDER': 'asc',
			'CS_ADD_TIME': 'desc'
		};
		let fields = 'CS_CAMPUS,CS_NAME,CS_MOBILE,CS_WECHAT,CS_QQ,CS_WORK_TIME,CS_QR,CS_ORDER,CS_STATUS';

		let where = {};
		where.and = {
			_pid: this.getProjectId()
		};
		where.and.CS_STATUS = 1;

		if (util.isDefined(search) && search) {
			where.or = [
				{ CS_CAMPUS: ['like', search] },
				{ CS_NAME: ['like', search] }
			];
		}

		return await CampusServiceModel.getList(where, fields, orderBy, page, size, isTotal, oldTotal);
	}

	/** 获取单个校区客服详情 */
	async getCampusServiceDetail(id) {
		let where = {
			_id: id,
			CS_STATUS: 1
		};
		return await CampusServiceModel.getOne(where, 'CS_CAMPUS,CS_NAME,CS_MOBILE,CS_WECHAT,CS_QQ,CS_WORK_TIME,CS_QR,CS_ORDER,CS_STATUS');
	}

	/** 倒序分页后恢复展示顺序，只标记实际取出的消息为已读。 */
	async _getMessages(where, reader, { before, limit = 50 } = {}) {
		limit = Math.min(100, Math.max(1, Number(limit) || 50));
		let query = { and: { ...where } };
		if (before) {
			let cursor = await CampusServiceMessageModel.getOne({ ...where, CSM_ID: before }, 'CSM_ADD_TIME,CSM_ID');
			if (!cursor) this.AppError('消息游标无效，请刷新会话');
			query.or = [
				{ CSM_ADD_TIME: ['<', cursor.CSM_ADD_TIME] },
				{ CSM_ADD_TIME: cursor.CSM_ADD_TIME, CSM_ID: ['<', cursor.CSM_ID] }
			];
		}
		let messages = await CampusServiceMessageModel.getAll(query,
			'CSM_ID,CSM_SENDER,CSM_CONTENT,CSM_READ,CSM_ADD_TIME',
			{ CSM_ADD_TIME: 'desc', CSM_ID: 'desc' }, limit + 1);
		let hasMore = messages.length > limit;
		messages = messages.slice(0, limit).reverse();
		let unreadIds = messages.filter(item => item.CSM_SENDER !== reader && item.CSM_READ === 0).map(item => item.CSM_ID);
		if (unreadIds.length) {
			await CampusServiceMessageModel.edit({ ...where, CSM_ID: ['in', unreadIds], CSM_READ: 0 },
				{ CSM_READ: 1, CSM_EDIT_TIME: this._timestamp });
		}
		messages.forEach(item => {
			if (item.CSM_SENDER !== reader) item.CSM_READ = 1;
			item.CSM_ADD_TIME = timeUtil.timestamp2Time(item.CSM_ADD_TIME, 'Y-M-D h:m');
		});
		return { messages, hasMore, nextBefore: messages.length ? messages[0].CSM_ID : '' };
	}

	/** 用户端获取会话消息 */
	async getCampusChat(userId, serviceId, options) {
		if (!userId) this.AppError('请先登录');
		let service = await CampusServiceModel.getOne({
			_id: serviceId,
			_pid: this.getProjectId(),
			CS_STATUS: 1
		}, 'CS_CAMPUS,CS_NAME,CS_MOBILE,CS_WECHAT,CS_QQ,CS_WORK_TIME,CS_STATUS');
		if (!service) return null;

		let page = await this._getMessages({
			_pid: this.getProjectId(),
			CSM_SERVICE_ID: serviceId,
			CSM_USER_ID: userId
		}, 'user', options);
		return { service, ...page };
	}

	/** 用户端发送消息 */
	async sendCampusMessage(userId, serviceId, content) {
		if (!userId) this.AppError('请先登录');
		content = String(content || '').trim();
		if (!content) this.AppError('请输入咨询内容');
		if (content.length > 500) this.AppError('咨询内容不能超过500字');

		let service = await CampusServiceModel.getOne({
			_id: serviceId,
			_pid: this.getProjectId(),
			CS_STATUS: 1
		}, '_id');
		if (!service) this.AppError('客服信息不存在或已停用');

		let sessionId = `${this.getProjectId()}_${serviceId}_${userId}`;
		let messageId = 'CSM' + Date.now() + Math.random().toString(36).substr(2, 9);
		await CampusServiceMessageModel.insert({
			_pid: this.getProjectId(),
			CSM_ID: messageId,
			CSM_SESSION_ID: sessionId,
			CSM_SERVICE_ID: serviceId,
			CSM_USER_ID: userId,
			CSM_SENDER: 'user',
			CSM_CONTENT: content,
			CSM_READ: 0,
			CSM_ADD_TIME: this._timestamp,
			CSM_EDIT_TIME: this._timestamp
		});
		return { id: messageId, sessionId };
	}


	async getAdminCampusServiceList({
		search,
		sortType,
		sortVal,
		orderBy,
		page,
		size,
		isTotal = true,
		oldTotal
	}) {
		orderBy = orderBy || {
			'CS_ORDER': 'asc',
			'CS_ADD_TIME': 'desc'
		};
		let fields = 'CS_CAMPUS,CS_NAME,CS_MOBILE,CS_WECHAT,CS_QQ,CS_WORK_TIME,CS_QR,CS_ORDER,CS_STATUS,CS_ADD_TIME';

		let where = {};
		where.and = {
			_pid: this.getProjectId()
		};

		if (util.isDefined(search) && search) {
			where.or = [
				{ CS_CAMPUS: ['like', search] },
				{ CS_NAME: ['like', search] }
			];
		}

		return await CampusServiceModel.getList(where, fields, orderBy, page, size, isTotal, oldTotal);
	}

	/** 管理员-校区客服详情 */
	async getAdminCampusServiceDetail(id) {
		return await CampusServiceModel.getOne({ _id: id }, '*');
	}

	/** 管理员-添加校区客服 */
	async insertCampusService({
		campus,
		name,
		mobile,
		wechat,
		qq,
		workTime,
		qr,
		order
	}) {
		campus = this._normalizeCampus(campus);
		if (!name) this.AppError('请填写负责人姓名');
		if (!mobile) this.AppError('请填写手机号');

		const csId = 'CS' + Date.now() + Math.random().toString(36).substr(2, 9);

		let data = {
			CS_ID: csId,
			CS_CAMPUS: campus.trim(),
			CS_NAME: name.trim(),
			CS_MOBILE: mobile.trim(),
			CS_WECHAT: (wechat || '').trim(),
			CS_QQ: (qq || '').trim(),
			CS_WORK_TIME: (workTime || '').trim(),
			CS_QR: qr || '',
			CS_ORDER: Number.isFinite(Number(order)) ? Number(order) : 9999,
			CS_STATUS: 1,
			CS_ADD_TIME: this._timestamp,
			CS_EDIT_TIME: this._timestamp,
		};
		await CampusServiceModel.insert(data);
		return { id: csId };
	}

	/** 管理员-更新校区客服 */
	async updateCampusService(id, {
		campus,
		name,
		mobile,
		wechat,
		qq,
		workTime,
		qr,
		order
	}) {
		if (!id) this.AppError('id不能为空');
		campus = this._normalizeCampus(campus);
		if (!name) this.AppError('请填写负责人姓名');
		if (!mobile) this.AppError('请填写手机号');

		let existing = await CampusServiceModel.getOne({ _id: id, _pid: this.getProjectId() }, '_id');
		if (!existing) this.AppError('客服信息不存在');
		await CampusServiceModel.edit(id, {
			CS_CAMPUS: campus.trim(),
			CS_NAME: name.trim(),
			CS_MOBILE: mobile.trim(),
			CS_WECHAT: (wechat || '').trim(),
			CS_QQ: (qq || '').trim(),
			CS_WORK_TIME: (workTime || '').trim(),
			CS_QR: qr || '',
			CS_ORDER: Number.isFinite(Number(order)) ? Number(order) : 9999,
			CS_EDIT_TIME: this._timestamp,
		});
		return { id };
	}

	/** 管理员-修改校区客服状态 */
	async statusCampusService(id, status) {
		if (!id) this.AppError('id不能为空');
		status = Number(status);
		if (![0, 1].includes(status)) this.AppError('状态参数错误');
		let service = await CampusServiceModel.getOne({ _id: id, _pid: this.getProjectId() }, '_id');
		if (!service) this.AppError('客服信息不存在');
		await CampusServiceModel.edit({ _id: id, _pid: this.getProjectId() }, {
			CS_STATUS: status,
			CS_EDIT_TIME: this._timestamp
		});
		return { id, status };
	}

	/** 管理员-会话列表 */
	async getAdminCampusChatList({ search, page = 1, size = 20 }) {
		page = Math.max(1, Number(page) || 1);
		size = Math.min(100, Math.max(1, Number(size) || 20));
		let result = await CampusServiceMessageModel.getSessionList(this.getProjectId(), (search || '').trim(), page, size);
		result.list = result.list.map(item => ({
			_id: item._id,
			CSM_SESSION_ID: item._id,
			CSM_SERVICE_ID: item.CSM_SERVICE_ID,
			CSM_USER_ID: item.CSM_USER_ID,
			CS_CAMPUS: item.service.CS_CAMPUS,
			CS_NAME: item.service.CS_NAME,
			CS_STATUS: item.service.CS_STATUS,
			lastContent: item.lastContent,
			lastSender: item.lastSender,
			lastTime: timeUtil.timestamp2Time(item.lastTime, 'Y-M-D h:m'),
			unread: item.unread
		}));
		return result;
	}

	/** 管理员-会话详情 */
	async getAdminCampusChatDetail(sessionId, options) {
		let where = { _pid: this.getProjectId(), CSM_SESSION_ID: sessionId };
		let first = await CampusServiceMessageModel.getOne(where, 'CSM_SERVICE_ID,CSM_USER_ID');
		if (!first) return null;
		let service = await CampusServiceModel.getOne({ _id: first.CSM_SERVICE_ID, _pid: this.getProjectId() }, 'CS_CAMPUS,CS_NAME,CS_STATUS');
		if (!service) return null;
		let page = await this._getMessages(where, 'admin', options);
		return { service, userId: first.CSM_USER_ID, ...page };
	}

	/** 管理员-回复会话 */
	async replyCampusMessage(sessionId, content) {
		content = String(content || '').trim();
		if (!sessionId) this.AppError('会话参数错误');
		if (!content) this.AppError('请输入回复内容');
		if (content.length > 500) this.AppError('回复内容不能超过500字');
		let last = await CampusServiceMessageModel.getOne({ _pid: this.getProjectId(), CSM_SESSION_ID: sessionId }, 'CSM_USER_ID,CSM_SERVICE_ID', { CSM_ADD_TIME: 'desc' });
		if (!last) this.AppError('会话不存在');
		let service = await CampusServiceModel.getOne({ _id: last.CSM_SERVICE_ID, _pid: this.getProjectId(), CS_STATUS: 1 }, '_id');
		if (!service) this.AppError('客服信息不存在或已停用');
		let messageId = 'CSM' + Date.now() + Math.random().toString(36).substr(2, 9);
		await CampusServiceMessageModel.insert({
			_pid: this.getProjectId(),
			CSM_ID: messageId,
			CSM_SESSION_ID: sessionId,
			CSM_SERVICE_ID: last.CSM_SERVICE_ID,
			CSM_USER_ID: last.CSM_USER_ID,
			CSM_SENDER: 'admin',
			CSM_CONTENT: content,
			CSM_READ: 0,
			CSM_ADD_TIME: this._timestamp,
			CSM_EDIT_TIME: this._timestamp
		});
		return { id: messageId, sessionId };
	}


	async delCampusService(id) {
		if (!id) this.AppError('id不能为空');
		let message = await CampusServiceMessageModel.getOne({ _pid: this.getProjectId(), CSM_SERVICE_ID: id }, '_id');
		if (message) this.AppError('该客服已有会话记录，请停用而非删除，以保留咨询历史');
		await CampusServiceModel.del(id);
		return { id };
	}
}

module.exports = CampusServiceService;
