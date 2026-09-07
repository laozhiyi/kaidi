const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const project = path.resolve(__dirname, '../../cloudfunctions/mcloud/project/crun');

function matches(row, where) {
	if (where.and && !matches(row, where.and)) return false;
	if (where.or && !where.or.some(part => matches(row, part))) return false;
	return Object.entries(where).every(([key, value]) => {
		if (key === 'and' || key === 'or') return true;
		if (!Array.isArray(value)) return row[key] === value;
		if (value[0] === '<') return row[key] < value[1];
		if (value[0] === 'in') return value[1].includes(row[key]);
		throw new Error('Unsupported test operator: ' + value[0]);
	});
}

function fixture(rows = []) {
	const services = [{ _id: 'service', _pid: 'crun', CS_STATUS: 1, CS_CAMPUS: '育才校区' }];
	function model(data) {
		return {
			async getOne(where) { return data.find(row => matches(row, where)) || null; },
			async getAll(where, fields, order, limit) {
				return data.filter(row => matches(row, where)).sort((a, b) => {
					for (const [key, direction] of Object.entries(order)) {
						if (a[key] !== b[key]) return (a[key] < b[key] ? -1 : 1) * (direction === 'asc' ? 1 : -1);
					}
					return 0;
				}).slice(0, limit).map(row => ({ ...row }));
			},
			async edit(where, update) { data.filter(row => matches(row, where)).forEach(row => Object.assign(row, update)); },
			async insert(row) { data.push({ ...row }); return 'new'; }
		};
	}
	const messages = model(rows);
	class Base {
		constructor() { this._timestamp = 2000; }
		getProjectId() { return 'crun'; }
		AppError(message) { throw new Error(message); }
	}
	const module = { exports: {} };
	const dependencies = {
		'./base_project_service.js': Base,
		'../../../framework/utils/util.js': { isDefined: value => value !== undefined },
		'../model/campus_service_model.js': model(services),
		'../model/campus_service_message_model.js': messages,
		'../../../framework/utils/time_util.js': { timestamp2Time: String }
	};
	vm.runInNewContext(fs.readFileSync(path.join(project, 'service/campus_service_service.js'), 'utf8'), {
		module, require(name) {
			assert.ok(dependencies[name], 'Unmocked dependency: ' + name);
			return dependencies[name];
		}
	});
	return { service: new module.exports(), rows, services, messages };
}

function message(index, extras = {}) {
	return {
		_pid: 'crun', CSM_ID: 'CSM' + String(index).padStart(6, '0'), CSM_ADD_TIME: Math.floor(index / 3),
		CSM_SERVICE_ID: 'service', CSM_USER_ID: 'user', CSM_SESSION_ID: 'session',
		CSM_SENDER: 'admin', CSM_READ: 0, CSM_CONTENT: '消息' + index, ...extras
	};
}

test('newest page stays current after 1000 messages and cursor traverses timestamp ties', async () => {
	const { service } = fixture(Array.from({ length: 1105 }, (_, i) => message(i)));
	let result = await service.getCampusChat('user', 'service');
	assert.equal(result.messages.length, 50);
	assert.equal(result.messages.at(-1).CSM_ID, message(1104).CSM_ID);
	assert.equal(result.hasMore, true);
	const ids = result.messages.map(row => row.CSM_ID);
	while (result.hasMore) {
		result = await service.getCampusChat('user', 'service', { before: result.nextBefore });
		ids.push(...result.messages.map(row => row.CSM_ID));
	}
	assert.equal(ids.length, 1105);
	assert.equal(new Set(ids).size, 1105);
});

test('user/project isolation and read receipts only cover delivered incoming messages', async () => {
	const rows = [message(1), message(2, { CSM_USER_ID: 'other' }), message(3, { _pid: 'other' }), message(4)];
	const { service } = fixture(rows);
	const result = await service.getCampusChat('user', 'service', { limit: 1 });
	assert.equal(result.messages[0].CSM_ID, message(4).CSM_ID);
	assert.equal(rows[0].CSM_READ, 0);
	assert.equal(rows[1].CSM_READ, 0);
	assert.equal(rows[2].CSM_READ, 0);
	assert.equal(rows[3].CSM_READ, 1);
	await assert.rejects(service.getCampusChat('user', 'service', { before: message(2).CSM_ID }), /游标无效/);
});

test('admin detail uses the same pagination and does not mark unseen older messages read', async () => {
	const rows = [message(1, { CSM_SENDER: 'user' }), message(2, { CSM_SENDER: 'user' }), message(3, { CSM_SESSION_ID: 'other' })];
	const { service } = fixture(rows);
	const result = await service.getAdminCampusChatDetail('session', { limit: 1 });
	assert.equal(result.userId, 'user');
	assert.equal(result.service.CS_CAMPUS, '育才校区');
	assert.equal(result.hasMore, true);
	assert.equal(result.nextBefore, message(2).CSM_ID);
	assert.equal(rows[0].CSM_READ, 0);
	assert.equal(rows[1].CSM_READ, 1);
	assert.equal(rows[2].CSM_READ, 0);
	assert.equal(await service.getAdminCampusChatDetail('missing'), null);
});

test('sending requires identity and active service; trims and validates message', async () => {
	const { service, rows, services } = fixture();
	await assert.rejects(service.sendCampusMessage('', 'service', 'hello'), /登录/);
	await assert.rejects(service.sendCampusMessage('user', 'service', '  '), /请输入/);
	await assert.rejects(service.sendCampusMessage('user', 'service', 'x'.repeat(501)), /500/);
	await service.sendCampusMessage('user', 'service', '  你好  ');
	assert.equal(rows[0].CSM_CONTENT, '你好');
	assert.equal(rows[0].CSM_USER_ID, 'user');
	services[0].CS_STATUS = 0;
	await assert.rejects(service.sendCampusMessage('user', 'service', 'hello'), /停用/);
	assert.equal(await service.getCampusChat('user', 'service'), null);
	await assert.rejects(service.replyCampusMessage(rows[0].CSM_SESSION_ID, 'hello'), /停用/);
});

test('three campuses are enforced and zero sort order is preserved', async () => {
	const { service, services } = fixture();
	for (const campus of ['育才', '王城', '雁山']) {
		await service.insertCampusService({ campus, name: '客服', mobile: '13800000000', order: 0 });
		assert.equal(services.at(-1).CS_CAMPUS, campus + '校区');
		assert.equal(services.at(-1).CS_ORDER, 0);
	}
	await assert.rejects(service.insertCampusService({ campus: '其他校区', name: '客服', mobile: '13800000000' }), /请选择/);
});

test('deleting a service with conversation history is blocked', async () => {
	const { service } = fixture([message(1)]);
	await assert.rejects(service.delCampusService('service'), /请停用而非删除/);
});

test('session list delegates database pagination and retains frontend response fields', async () => {
	const { service, messages } = fixture();
	messages.getSessionList = async (pid, search, page, size) => {
		assert.equal(pid, 'crun');
		assert.equal(search, '育才');
		assert.equal(page, 1);
		assert.equal(size, 100);
		return { page, size, total: 1, count: 1, list: [{
			_id: 'session', CSM_SERVICE_ID: 'service', CSM_USER_ID: 'user',
			service: { CS_CAMPUS: '育才校区', CS_NAME: '客服', CS_STATUS: 1 },
			lastTime: 1234, lastContent: '你好', lastSender: 'user', unread: 1001
		}] };
	};
	const result = await service.getAdminCampusChatList({ search: ' 育才 ', page: -1, size: 1000 });
	assert.equal(result.list[0].CSM_SESSION_ID, 'session');
	assert.equal(result.list[0].unread, 1001);
	assert.equal(result.list[0].CS_CAMPUS, '育才校区');
});
