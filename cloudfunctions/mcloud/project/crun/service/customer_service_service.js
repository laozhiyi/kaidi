/**
 * Notes: 在线客服（全校共享客服池）
 * Ver : CCMiniCloud Framework 2.0.1
 *
 * 设计口径：
 * - 会话唯一键是用户 openid，一个用户只有一条会话，不再按校区/客服席位拆分；
 * - 所有拥有后台角色（super/admin/service）的账号共享同一个待回复池，谁在线谁接；
 * - 回复记录真实客服身份（CSM_STAFF_ID/CSM_STAFF_NAME），不再一律记作 admin；
 * - 用户侧只要求「已微信登录且未停用」，不强制完成学生注册资料，
 *   这样资料没填完、审核没过的人也能找到客服求助。
 */

const BaseProjectService = require('./base_project_service.js');
const store = require('./operation_store.js');
const timeUtil = require('../../../framework/utils/time_util.js');
const tenant = require('../../../framework/tenancy/tenant_context.js');
const UserModel = require('../model/user_model.js');
const MailModel = require('../model/mail_model.js');
const MessageModel = require('../model/campus_service_message_model.js');
const deliveryAddress = require('./delivery_address.js');
const Roles = require('./admin/admin_roles.js');

const MAX_CONTENT = 500;
const PUBLIC_SERVICE = { CS_NAME: '在线客服', CS_CAMPUS: '', CS_WORK_TIME: '', CS_PIC: '', CS_STATUS: 1 };
const SERVICE_NAME = { take: '快递代取', send: '物品代送', buy: '商品代买' };
const ORDER_STATUS = { 0: '等待接单', 1: '等待取件', 2: '等待确认收货', 3: '异常处理中', 4: '配送中', 9: '已完成', 99: '已取消' };

class CustomerServiceService extends BaseProjectService {

	_pid() {
		return this.getProjectId();
	}

	/** 用户侧身份校验：登录即可咨询，停用账号除外。 */
	async _requireUser(userId) {
		if (!userId) this.AppError('请先微信登录');
		const user = await UserModel.getOne({ USER_MINI_OPENID: userId },
			'USER_NAME,USER_PIC,USER_STATUS,USER_ROLE,USER_MINI_OPENID');
		if (!user) this.AppError('请先微信登录');
		if (user.USER_STATUS === 9) this.AppError('账号已停用，请联系管理员');
		return user;
	}

	/** 分页倒序读取后恢复展示顺序，只把本次实际取出的消息标记为已读。 */
	async _getMessages(where, reader, { before, limit = 50 } = {}) {
		limit = Math.min(100, Math.max(1, Number(limit) || 50));
		const base = { _pid: this._pid(), ...where };
		let query = { and: { ...base } };
		if (before) {
			const cursor = await MessageModel.getOne({ ...base, CSM_ID: before }, 'CSM_ADD_TIME,CSM_ID');
			if (!cursor) this.AppError('消息游标无效，请刷新会话');
			query.or = [
				{ CSM_ADD_TIME: ['<', cursor.CSM_ADD_TIME] },
				{ CSM_ADD_TIME: cursor.CSM_ADD_TIME, CSM_ID: ['<', cursor.CSM_ID] }
			];
		}
		let messages = await MessageModel.getAll(query,
			'CSM_ID,CSM_SENDER,CSM_STAFF_ID,CSM_STAFF_NAME,CSM_CONTENT,CSM_TYPE,CSM_ORDER,CSM_READ,CSM_ADD_TIME',
			{ CSM_ADD_TIME: 'desc', CSM_ID: 'desc' }, limit + 1);
		const hasMore = messages.length > limit;
		messages = messages.slice(0, limit).reverse();
		const unreadIds = messages.filter(item => item.CSM_SENDER !== reader && item.CSM_READ === 0).map(item => item.CSM_ID);
		if (unreadIds.length) {
			await MessageModel.edit({ ...base, CSM_ID: ['in', unreadIds], CSM_READ: 0 },
				{ CSM_READ: 1, CSM_EDIT_TIME: this._timestamp });
		}
		messages.forEach(item => {
			if (item.CSM_SENDER !== reader) item.CSM_READ = 1;
			item.CSM_ADD_TIME = timeUtil.timestamp2Time(item.CSM_ADD_TIME, 'Y-M-D h:m');
		});
		return { messages, hasMore, nextBefore: messages.length ? messages[0].CSM_ID : '' };
	}

	async _unread(where) {
		return await MessageModel.count({ _pid: this._pid(), CSM_READ: 0, ...where });
	}

	/** 用户端：我的会话（含未读数） */
	async getChat(userId, options = {}) {
		await this._requireUser(userId);
		const page = await this._getMessages({ CSM_USER_ID: userId }, 'user', options);
		const unread = await this._unread({ CSM_USER_ID: userId, CSM_SENDER: ['<>', 'user'] });
		return { service: PUBLIC_SERVICE, userId, unread, ...page };
	}

	/** 用户端：红点只取未读数，不做整页消息拉取 */
	async getUserBadge(userId) {
		await this._requireUser(userId);
		return { unread: await this._unread({ CSM_USER_ID: userId, CSM_SENDER: ['<>', 'user'] }) };
	}

	/** 用户端发送消息：可只发一条本人订单的卡片，也可在文字里附带订单。 */
	async sendMessage(userId, content, requestId, orderId) {
		await this._requireUser(userId);
		const card = orderId ? await this._orderCard(userId, orderId) : null;
		content = String(content || '').trim();
		if (!content && !card) this.AppError('请输入咨询内容');
		if (content.length > MAX_CONTENT) this.AppError('咨询内容不能超过' + MAX_CONTENT + '字');
		return this._saveMessage({
			_pid: this._pid(),
			CSM_SESSION_ID: this._sessionId(userId),
			CSM_USER_ID: userId,
			CSM_SENDER: 'user',
			CSM_CONTENT: content || '咨询订单：' + card.no + ' ' + card.serviceName,
			CSM_TYPE: card ? 'order' : 'text',
			CSM_ORDER: card || {},
			CSM_READ: 0,
			CSM_ADD_TIME: this._timestamp,
			CSM_EDIT_TIME: this._timestamp
		}, requestId, userId, userId);
	}

	/** 发送订单前必须确认是本人参与的订单，卡片只存展示所需的快照。 */
	async _orderCard(userId, orderId) {
		const mail = await MailModel.getOne(String(orderId || ''));
		if (!mail || mail._pid !== this._pid() || mail.MAIL_ADMIN_DELETED === true) this.AppError('订单不存在或已被删除');
		const poster = mail.MAIL_USER_ID === userId, rider = !!mail.MAIL_ACCEPT_USER_ID && mail.MAIL_ACCEPT_USER_ID === userId;
		if (!poster && !rider) this.AppError('只能发送本人参与过的订单');
		const obj = deliveryAddress.complete(mail).MAIL_OBJ || {};
		const fee = obj.price == null ? Number(mail.MAIL_TOTAL_FEE || 0) / 100 : Number(obj.price);
		return {
			id: mail._id,
			no: String(mail._id).slice(-6).toUpperCase(),
			serviceName: SERVICE_NAME[obj.serviceType] || '快递代取',
			statusText: ORDER_STATUS[Number(mail.MAIL_STATUS)] || '订单状态待更新',
			role: poster ? '我发布的' : '我接的单',
			from: obj.address1 || '',
			to: deliveryAddress.resolve(mail) || '',
			fee: Number.isFinite(fee) && fee >= 0 ? fee.toFixed(2) : '',
			createdAt: timeUtil.timestamp2Time(mail.MAIL_ADD_TIME, 'Y-M-D h:m')
		};
	}

	_sessionId(userId) {
		return store.key(this._pid(), 'customer_service', userId);
	}

	_content(value, label) {
		const content = String(value || '').trim();
		if (!content) this.AppError('请输入' + label);
		if (content.length > MAX_CONTENT) this.AppError(label + '不能超过' + MAX_CONTENT + '字');
		return content;
	}

	async _saveMessage(message, requestId, actorId, targetUserId, sourceId) {
		if (typeof requestId !== 'string' || !/^[\w-]{16,100}$/.test(requestId)) this.AppError('消息请求标识无效，请重试');
		const id = store.key(this._pid(), 'chat', message.CSM_SENDER, actorId, requestId);
		// 幂等指纹包含订单标识：同一 requestId 重试时订单状态变化不应被判成「不同消息」。
		const fingerprint = store.key(message.CSM_USER_ID, message.CSM_CONTENT, message.CSM_TYPE || 'text', (message.CSM_ORDER || {}).id || '');
		const isStaff = message.CSM_SENDER !== 'user';
		return store.transaction(async tx => {
			if (isStaff) {
				const admin = await store.get(tx, 'admin', actorId);
				if (!tenant.isAdminEnabled(admin) || admin._pid !== this._pid()) this.AppError('管理权限已失效，请重新登录');
				if (!Roles.isStaff(Roles.ofAdmin(admin))) this.AppError('客服账号没有该操作权限');
				// 回复必须锚定一条仍然存在的消息：账号注销会清空会话，延迟回复不能把它写回来。
				const source = sourceId && await store.get(tx, 'campus_service_message', sourceId);
				if (!source || source.CSM_USER_ID !== message.CSM_USER_ID || source.CSM_SESSION_ID !== message.CSM_SESSION_ID) {
					this.AppError('会话已失效，请刷新后重试');
				}
				if (!await require('./account_service.js').guardRelated(tx, message.CSM_USER_ID)) {
					this.AppError('会话已失效，账号可能正在注销');
				}
			}
			const old = await store.get(tx, 'campus_service_message', id);
			if (old) {
				if (old.CSM_REQUEST_FINGERPRINT !== fingerprint) this.AppError('相同请求不能发送不同消息');
				return { id: old.CSM_ID, sessionId: old.CSM_SESSION_ID };
			}
			await store.limitInTransaction(tx, this._pid(), actorId, 'chat_send', 60, 60000);
			await store.set(tx, 'campus_service_message', id, {
				...message, CSM_ID: 'CSM' + id, CSM_REQUEST_FINGERPRINT: fingerprint
			});
			// 客服回复立刻落站内通知，用户下次进入消息中心能看到并跳回会话。
			if (isStaff) {
				await store.set(tx, 'notification', store.key(this._pid(), 'customer_service', id), {
					_pid: this._pid(),
					userId: targetUserId,
					chat: true,
					title: '客服回复了你',
					content: message.CSM_CONTENT.slice(0, 40),
					createdAt: message.CSM_ADD_TIME,
					read: false,
					delivery: 'pending',
					attempts: 0,
					nextAttemptAt: message.CSM_ADD_TIME
				});
			}
			return { id: 'CSM' + id, sessionId: message.CSM_SESSION_ID };
		});
	}

	/** 后台：会话池（所有咨询过的用户） */
	async getSessions({ search, page = 1, size = 20 } = {}) {
		page = Math.max(1, Number(page) || 1);
		size = Math.min(50, Math.max(1, Number(size) || 20));
		const filter = {};
		search = String(search || '').trim();
		if (search) {
			const pattern = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			const users = await UserModel.getAll({ USER_NAME: ['like', pattern] }, 'USER_MINI_OPENID', {}, 50);
			if (users.length) filter.userIds = users.map(item => item.USER_MINI_OPENID);
			else filter.openidPattern = pattern;
		}
		const result = await MessageModel.getSessionList(this._pid(), filter, page, size);
		const ids = Array.from(new Set(result.list.map(item => item.CSM_USER_ID).filter(Boolean)));
		const users = ids.length
			? await UserModel.getAll({ USER_MINI_OPENID: ['in', ids] }, 'USER_MINI_OPENID,USER_NAME,USER_PIC,USER_STATUS', {}, 100)
			: [];
		const byId = new Map(users.map(user => [user.USER_MINI_OPENID, user]));
		const unread = await this.getStaffBadge().then(x => x.unread);
		result.list = result.list.map(item => {
			const user = byId.get(item.CSM_USER_ID) || {};
			return {
				// 旧会话按「客服席位+用户」拆分过，必须回传真实的会话ID，回复才不会落空。
				CSM_SESSION_ID: item.lastSessionId || this._sessionId(item.CSM_USER_ID),
				CSM_USER_ID: item.CSM_USER_ID,
				USER_NAME: user.USER_NAME || '未填写昵称',
				USER_PIC: user.USER_PIC || '',
				USER_STATUS: user.USER_STATUS,
				lastContent: item.lastContent,
				lastSender: item.lastSender,
				lastStaffName: item.lastStaffName || '',
				lastTime: timeUtil.timestamp2Time(item.lastTime, 'Y-M-D h:m'),
				unread: item.unread || 0
			};
		});
		// 旧会话（按客服席位拆分）与新会话可能并存，详情统一按用户聚合，
		// 列表分页与总数仍以用户维度为准。
		return { ...result, unread };
	}

	/** 后台：会话详情（按用户聚合新旧消息） */
	async getAdminChat(sessionId, options = {}) {
		const first = await MessageModel.getOne({ _pid: this._pid(), CSM_SESSION_ID: sessionId }, 'CSM_USER_ID');
		if (!first) return null;
		const user = await UserModel.getOne({ USER_MINI_OPENID: first.CSM_USER_ID }, 'USER_NAME,USER_PIC,USER_STATUS');
		const page = await this._getMessages({ CSM_USER_ID: first.CSM_USER_ID }, 'admin', options);
		return {
			service: {
				CS_NAME: (user && user.USER_NAME) || '用户',
				CS_PIC: (user && user.USER_PIC) || '',
				CS_STATUS: 1,
				CS_CAMPUS: '',
				CS_WORK_TIME: ''
			},
			userId: first.CSM_USER_ID,
			userStatus: user ? user.USER_STATUS : -1,
			...page
		};
	}

	/** 后台：回复会话 */
	async reply(sessionId, content, requestId, adminId) {
		if (!sessionId) this.AppError('会话参数错误');
		content = this._content(content, '回复内容');
		const last = await MessageModel.getOne({ _pid: this._pid(), CSM_SESSION_ID: sessionId },
			'_id,CSM_USER_ID,CSM_SESSION_ID', { CSM_ADD_TIME: 'desc' });
		if (!last) this.AppError('会话不存在或已被清理');
		const admin = await store.get(store.database(), 'admin', adminId);
		const staffName = (admin && (admin.ADMIN_NAME || admin.ADMIN_DESC)) || '客服';
		return this._saveMessage({
			_pid: this._pid(),
			CSM_SESSION_ID: last.CSM_SESSION_ID,
			CSM_USER_ID: last.CSM_USER_ID,
			CSM_SENDER: 'admin',
			CSM_STAFF_ID: adminId,
			CSM_STAFF_NAME: staffName,
			CSM_CONTENT: content,
			CSM_READ: 0,
			CSM_ADD_TIME: this._timestamp,
			CSM_EDIT_TIME: this._timestamp
		}, requestId, adminId, last.CSM_USER_ID, last._id);
	}

	/** 后台：待回复总数 */
	async getStaffBadge() {
		return { unread: await this._unread({ CSM_SENDER: 'user' }) };
	}
}

module.exports = CustomerServiceService;
