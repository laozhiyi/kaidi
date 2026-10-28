'use strict';
/**
 * 在线客服（全校共享客服池）
 * - 会话唯一键是用户 openid，不再按校区/客服席位拆分
 * - 客服回复带真实身份并触发站内通知
 * - 用户侧只要求微信身份，不要求完成学生注册资料
 */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const project = path.resolve(__dirname, '../../cloudfunctions/mcloud/project/crun');
const mini = path.resolve(__dirname, '../../miniprogram');
const key = (...parts) => crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);

function field(row, name) {
	return name.split('.').reduce((value, part) => value && value[part], row);
}

function matches(row, where) {
	if (!where) return true;
	if (where.and && !matches(row, where.and)) return false;
	if (where.or && !where.or.some(part => matches(row, part))) return false;
	return Object.entries(where).every(([name, value]) => {
		if (name === 'and' || name === 'or') return true;
		const actual = field(row, name);
		if (!Array.isArray(value)) return actual === value;
		const [op, expected] = value;
		if (op === '<') return actual < expected;
		if (op === '>') return actual > expected;
		if (op === 'in') return expected.includes(actual);
		if (op === '<>') return actual !== expected;
		throw new Error('Unsupported test operator: ' + op);
	});
}

function sortRows(rows, orderBy) {
	const entries = Object.entries(orderBy || {});
	return rows.slice().sort((a, b) => {
		for (const [name, direction] of entries) {
			const left = field(a, name), right = field(b, name);
			if (left === right) continue;
			return (left < right ? -1 : 1) * (direction === 'asc' ? 1 : -1);
		}
		return 0;
	});
}

function projectRow(row, fields) {
	if (!row) return null;
	if (!fields || fields === '*') return JSON.parse(JSON.stringify(row));
	const selected = { _id: row._id };
	String(fields).split(',').map(name => name.trim()).filter(Boolean).forEach(name => {
		if (row[name] !== undefined) selected[name] = JSON.parse(JSON.stringify(row[name]));
	});
	return selected;
}

function model(name, state) {
	return {
		async getOne(where, fields, orderBy) {
			const rows = sortRows(state[name].filter(row => matches(row, where)), orderBy);
			return projectRow(rows[0], fields);
		},
		async getAll(where, fields, orderBy, limit = 100) {
			return sortRows(state[name].filter(row => matches(row, where)), orderBy).slice(0, limit).map(row => projectRow(row, fields));
		},
		async count(where) { return state[name].filter(row => matches(row, where)).length; },
		async edit(where, data) {
			state[name].forEach(row => { if (matches(row, where)) Object.assign(row, JSON.parse(JSON.stringify(data))); });
		},
		async insert(data) {
			const id = name + '-' + (state[name].length + 1);
			state[name].push({ _pid: 'crun', ...JSON.parse(JSON.stringify(data)), _id: id });
			return id;
		}
	};
}

class Base {
	constructor() { this._timestamp = 1000; }
	getProjectId() { return 'crun'; }
	AppError(message) { throw new Error(message); }
}

function createStore(state) {
	let tail = Promise.resolve();
	const store = {
		key,
		database: () => ({}),
		// 串行执行事务，模拟真实环境里同一会话的请求排队。
		transaction(fn) {
			const job = tail.then(() => fn({}));
			tail = job.catch(() => { });
			return job;
		},
		limitInTransaction: async () => { },
		limit: async () => { },
		async get(_, name, id) {
			return (state[name] || []).find(row => row._id === id) || null;
		},
		async set(_, name, id, row) {
			if (!state[name]) state[name] = [];
			const list = state[name], index = list.findIndex(item => item._id === id);
			const next = { ...JSON.parse(JSON.stringify(row)), _id: id };
			if (index >= 0) list[index] = next; else list.push(next);
		}
	};
	return store;
}

function loadService(file, state, extra = {}) {
	const store = createStore(state);
	const deps = {
		'./base_project_service.js': Base,
		'../base_project_service.js': Base,
		'../../base_project_service.js': Base,
		'./operation_store.js': store,
		'../operation_store.js': store,
		'../../../framework/utils/time_util.js': { timestamp2Time: value => 'T' + value, time: () => Date.now() },
		'../../../../framework/utils/time_util.js': { timestamp2Time: value => 'T' + value, time: () => Date.now() },
		'../../../framework/tenancy/tenant_context.js': { isAdminEnabled: admin => !!(admin && admin.ADMIN_STATUS === 1) },
		'../model/user_model.js': model('user', state),
		'../../model/user_model.js': model('user', state),
		'../model/campus_service_message_model.js': model('campus_service_message', state),
		'../../model/staff_invite_model.js': model('staff_invite', state),
		'../model/staff_invite_model.js': model('staff_invite', state),
		'./admin/admin_roles.js': require(path.join(project, 'service/admin/admin_roles.js')),
		'./admin_roles.js': require(path.join(project, 'service/admin/admin_roles.js')),
		'./account_service.js': { guardRelated: async () => state.guardRelated !== false },
		...extra
	};
	const module = { exports: {} };
	vm.runInNewContext(fs.readFileSync(path.join(project, file), 'utf8'), {
		module, require(name) {
			if (name === 'crypto') return crypto;
			if (!Object.prototype.hasOwnProperty.call(deps, name)) throw new Error('Unmocked dependency: ' + name);
			return deps[name];
		}
	});
	return module.exports;
}

let seq = 0;
function message(userId, sender, extras = {}) {
	seq += 1;
	return {
		_pid: 'crun', _id: 'doc' + String(seq).padStart(5, '0'), CSM_ID: 'CSM' + String(seq).padStart(5, '0'),
		CSM_SESSION_ID: key('crun', 'customer_service', userId), CSM_USER_ID: userId,
		CSM_SENDER: sender, CSM_CONTENT: '消息' + seq, CSM_READ: 0, CSM_ADD_TIME: seq, ...extras
	};
}

function chatFixture({ messages = [], user = {} } = {}) {
	const state = {
		user: [{ _id: 'u1', _pid: 'crun', USER_MINI_OPENID: 'poster', USER_NAME: '小张', USER_STATUS: 1, USER_PROFILE_COMPLETE: true, ...user }],
		campus_service_message: messages,
		notification: [],
		admin: [{ _id: 'admin', _pid: 'crun', ADMIN_NAME: '客服A', ADMIN_STATUS: 1, ADMIN_TYPE: 0, ADMIN_ROLE: 'service' }],
		guardRelated: true
	};
	const Service = loadService('service/customer_service_service.js', state);
	return { service: new Service(), state };
}

test('newest page stays current and the cursor walks back through timestamp ties', async () => {
	const rows = Array.from({ length: 1105 }, (_, index) => message('poster', 'admin', { CSM_ADD_TIME: Math.floor(index / 3) }));
	const { service, state } = chatFixture({ messages: rows });
	const first = await service.getChat('poster');
	assert.equal(first.messages.length, 50);
	assert.equal(first.hasMore, true);
	const newest = state.campus_service_message[state.campus_service_message.length - 1];
	assert.equal(first.messages.at(-1).CSM_ID, newest.CSM_ID);
	const second = await service.getChat('poster', { before: first.nextBefore });
	assert.equal(second.messages.length, 50);
	const overlap = second.messages.filter(item => first.messages.some(prev => prev.CSM_ID === item.CSM_ID));
	assert.equal(overlap.length, 0);
	assert.ok(second.messages[0].CSM_ADD_TIME <= first.messages[0].CSM_ADD_TIME);
});

test('reading the conversation only marks delivered incoming messages', async () => {
	const rows = [
		...Array.from({ length: 60 }, (_, index) => message('poster', 'admin', { CSM_ADD_TIME: index + 1 })),
		message('poster', 'user', { CSM_ADD_TIME: 61 })
	];
	const { service, state } = chatFixture({ messages: rows });
	await service.getChat('poster', { limit: 50 });
	const unread = state.campus_service_message.filter(item => item.CSM_READ === 0);
	// 没被这一页取到的更早消息保持未读，自己发的消息也不参与已读。
	assert.equal(unread.length, 12);
	assert.equal(state.campus_service_message.filter(item => item.CSM_SENDER === 'admin' && item.CSM_READ === 0).length, 11);
	assert.equal(state.campus_service_message.filter(item => item.CSM_SENDER === 'admin' && item.CSM_READ === 1).length, 49);
});

test('badges separate the user side from the staff pool', async () => {
	const { service } = chatFixture({ messages: [message('poster', 'admin'), message('poster', 'user'), message('poster', 'user')] });
	assert.equal((await service.getUserBadge('poster')).unread, 1);
	assert.equal((await service.getStaffBadge()).unread, 2);
});

test('one request id keeps one message and rejects different content', async () => {
	const { service, state } = chatFixture();
	const requestId = 'chat_request_000000001';
	const results = await Promise.all(Array.from({ length: 20 }, () => service.sendMessage('poster', '请问如何取件', requestId)));
	assert.equal(new Set(results.map(item => item.id)).size, 1);
	assert.equal(state.campus_service_message.length, 1);
	await assert.rejects(service.sendMessage('poster', '换一个内容', requestId), /不同消息/);
	await assert.rejects(service.sendMessage('poster', '   ', 'chat_request_000000002'), /请输入咨询内容/);
	await assert.rejects(service.sendMessage('poster', 'x'.repeat(501), 'chat_request_000000003'), /500/);
});

test('staff replies carry the real operator and notify the user', async () => {
	const { service, state } = chatFixture({ messages: [message('poster', 'user')] });
	const sessionId = key('crun', 'customer_service', 'poster');
	await service.reply(sessionId, '已帮你联系骑手', 'chat_reply_0000000001', 'admin');
	const reply = state.campus_service_message.at(-1);
	assert.equal(reply.CSM_SENDER, 'admin');
	assert.equal(reply.CSM_STAFF_NAME, '客服A');
	assert.equal(reply.CSM_STAFF_ID, 'admin');
	const notice = state.notification.at(-1);
	assert.equal(notice.chat, true);
	assert.equal(notice.userId, 'poster');
	assert.equal(notice.title, '客服回复了你');
});

test('a delayed reply cannot resurrect a conversation that is being erased', async () => {
	const { service, state } = chatFixture({ messages: [message('poster', 'user')] });
	state.guardRelated = false;
	await assert.rejects(service.reply(key('crun', 'customer_service', 'poster'), '旧回复', 'chat_reply_0000000002', 'admin'), /会话已失效/);
	assert.equal(state.campus_service_message.length, 1);
});

test('users who have not finished registration can still reach the support channel', async () => {
	const pending = chatFixture({ messages: [message('poster', 'admin')], user: { USER_STATUS: 0, USER_PROFILE_COMPLETE: false } });
	const page = await pending.service.getChat('poster');
	assert.equal(page.messages.length, 1);
	await pending.service.sendMessage('poster', '我的资料卡住了', 'chat_request_000000004');

	const stopped = chatFixture({ messages: [], user: { USER_STATUS: 9 } });
	await assert.rejects(stopped.service.getChat('poster'), /停用/);
	await assert.rejects(stopped.service.sendMessage('poster', '在吗', 'chat_request_000000005'), /停用/);
});

test('a repeated code can never produce two invite records', async () => {
	const state = { user: [], staff_invite: [] };
	const service = new (loadService('service/admin/staff_invite_service.js', state))();

	// 唯一性锚在确定性文档 ID 上：同一个码只会落在同一条记录。
	service._code = () => 'ABCD2345';
	const first = await service.create('admin-1', 24);
	assert.equal(first.code, 'ABCD2345');
	assert.equal(state.staff_invite.length, 1);
	assert.equal(state.staff_invite[0]._id, key('crun', 'staff_invite', 'ABCD2345'));
	assert.equal(state.staff_invite[0].INVITE_STATUS, 1);
	assert.equal(state.staff_invite[0]._pid, 'crun');

	// 生成器一直返回同一个码时宁可报忙，也不能写出第二条同码记录。
	await assert.rejects(service.create('admin-1', 24), /繁忙/);
	assert.equal(state.staff_invite.length, 1);

	// 正常情况两个码互不影响。
	const queue = ['WXYZ6789', 'QRST2345'];
	service._code = () => queue.shift();
	await service.create('admin-1', 24);
	await service.create('admin-1', 48);
	assert.deepEqual(state.staff_invite.map(row => row.INVITE_CODE).sort(), ['ABCD2345', 'QRST2345', 'WXYZ6789']);
});

test('a code imported twice refuses to activate either record', async () => {
	const now = Date.now();
	const base = { _pid: 'crun', INVITE_ROLE: 'service', INVITE_STATUS: 1, INVITE_EXPIRES_AT: now + 60000 };
	const state = {
		user: [{ _id: 'u1', _pid: 'crun', USER_MINI_OPENID: 'poster', USER_NAME: '', USER_STATUS: 1, USER_ROLE: '' }],
		staff_invite: [
			{ ...base, _id: 'invite-a', INVITE_CODE: 'DUP12345' },
			{ ...base, _id: 'invite-b', INVITE_CODE: 'DUP12345' }
		]
	};
	const service = new (loadService('service/admin/staff_invite_service.js', state))();

	// 只可能来自控制台手工导入或直接写库：宁可拒绝，也不能随机命中一条。
	await assert.rejects(service.redeem('poster', 'DUP12345', '客服'), /重复/);
	assert.equal(state.user[0].USER_ROLE, '');
	assert.deepEqual(state.staff_invite.map(row => row.INVITE_STATUS), [1, 1]);
});

test('staff invite is single use, expires and only applies to accounts without a role', async () => {
	const now = Date.now();
	const state = {
		user: [{ _id: 'u1', _pid: 'crun', USER_MINI_OPENID: 'poster', USER_NAME: '', USER_STATUS: 0, USER_ROLE: '' }],
		staff_invite: [
			{ _id: 'invite-1', _pid: 'crun', INVITE_CODE: 'ABCD2345', INVITE_ROLE: 'service', INVITE_STATUS: 1, INVITE_EXPIRES_AT: now + 60000 },
			{ _id: 'invite-2', _pid: 'crun', INVITE_CODE: 'EXPI2345', INVITE_ROLE: 'service', INVITE_STATUS: 1, INVITE_EXPIRES_AT: now - 1000 }
		]
	};
	const Service = loadService('service/admin/staff_invite_service.js', state);
	const service = new Service();

	await assert.rejects(service.redeem('poster', 'EXPI2345', '小助手'), /过期/);
	const result = await service.redeem('poster', 'abcd2345', '小助手');
	assert.equal(result.ok, true);
	assert.equal(state.user[0].USER_ROLE, 'service');
	assert.equal(state.user[0].USER_STAFF, true);
	assert.equal(state.user[0].USER_STATUS, 1);
	assert.equal(state.user[0].USER_NAME, '小助手');
	await assert.rejects(service.redeem('poster', 'ABCD2345', '小助手'), /已被使用|已有后台权限/);

	const missing = { ...state, user: [{ _id: 'u2', _pid: 'crun', USER_MINI_OPENID: 'other', USER_STATUS: 1, USER_ROLE: 'service' }] };
	await assert.rejects(new (loadService('service/admin/staff_invite_service.js', missing))().redeem('other', 'ABCD2345', ''), /已有后台权限/);
});

test('customer service pages replace the campus seat pages everywhere', () => {
	const app = JSON.parse(fs.readFileSync(path.join(mini, 'app.json'), 'utf8'));
	const pages = app.pages.join('\n');
	assert.match(pages, /pages\/customer_service\/chat\/customer_service_chat/);
	assert.match(pages, /pages\/admin\/customer_service\/chat_list\/admin_customer_chat_list/);
	assert.match(pages, /pages\/admin\/customer_service\/chat_detail\/admin_customer_chat_detail/);
	assert.match(pages, /pages\/admin\/index\/login\/admin_login/);
	assert.doesNotMatch(pages, /admin\/index\/invite/);
	assert.doesNotMatch(pages, /campus_service/);
	for (const file of ['service/campus_service_service.js', 'model/campus_service_model.js', 'controller/campus_service_controller.js', 'controller/admin/admin_campus_service_controller.js']) {
		assert.equal(fs.existsSync(path.join(project, file)), false, file + ' should be removed');
	}
});

test('closing an account detaches the invite usage and drops the old public routes', () => {
	const cleanup = fs.readFileSync(path.join(project, 'service/account_cleanup.js'), 'utf8');
	const anonymize = cleanup.match(/const ANONYMIZE = \[([\s\S]*?)\n\];/);
	assert.ok(anonymize, 'ANONYMIZE list missing');
	assert.match(anonymize[1], /staff_invite/);
	assert.match(anonymize[1], /INVITE_USED_BY/);
	const account = fs.readFileSync(path.join(project, 'service/account_service.js'), 'utf8');
	assert.doesNotMatch(account, /campus_service\//);
});

test('客服可以处理投诉、订单履约与用户注册审核，但拿不到授权、删除、停用与设置权限', () => {
	const source = fs.readFileSync(path.join(project, 'controller/admin/base_project_admin_controller.js'), 'utf8');
	const whitelist = source.match(/SERVICE_ROUTES = new Set\(\[([\s\S]*?)\]\)/);
	assert.ok(whitelist, 'SERVICE_ROUTES whitelist missing');
	for (const route of ['admin/customer_service_sessions', 'admin/customer_service_chat', 'admin/customer_service_reply', 'admin/customer_service_badge',
		'admin/feedback_list', 'admin/feedback_detail', 'admin/feedback_reply',
		'admin/operations_config', 'admin/operations_orders', 'admin/operations_order', 'admin/operations_hold', 'admin/operations_resolve', 'admin/operations_recover',
		'admin/user_list', 'admin/user_detail', 'admin/user_status']) {
		assert.match(whitelist[1], new RegExp(route), route + ' should be allowed for service');
	}
	for (const route of ['admin/operations_delete_order', 'admin/operations_config_save', 'admin/operations_overview', 'admin/operations_maintain',
		'admin/user_role', 'admin/mail_data_export', 'admin/setup_set', 'admin/tenant_grant', 'admin/mgr_list']) {
		assert.doesNotMatch(whitelist[1], new RegExp(route), route + ' must stay admin-only');
	}
	// 客服的注册审核只能是通过/不通过，停用/恢复（9）仍归管理员。
	const userCtl = fs.readFileSync(path.join(project, 'controller/admin/admin_user_controller.js'), 'utf8');
	assert.match(userCtl, /statusUser[\s\S]*?includes\(Number\(input\.status\)\)/);
	assert.match(source, /客服账号没有该操作权限/);
	const routes = fs.readFileSync(path.join(project, 'public/route.js'), 'utf8');
	assert.match(routes, /'admin\/customer_service_invite'/);
	assert.doesNotMatch(routes, /admin\/campus_service_/);
});
