const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const dataCheck = require('../../cloudfunctions/mcloud/framework/validate/data_check.js');
const root = path.resolve(__dirname, '../../cloudfunctions/mcloud/project/crun/controller');

function load(admin, params, authorized = true) {
	const calls = [];
	class Base {
		constructor() { this._userId = 'trusted-openid'; }
		async isAdmin() {
			calls.push('auth');
			if (!authorized) throw new Error('not admin');
		}
		validateData(rules) { return dataCheck.check(params, rules); }
	}
	class Service {
		async getCampusChat(...args) { calls.push(args); return args; }
		async getAdminCampusChatDetail(...args) { calls.push(args); return args; }
		async sendCampusMessage(...args) { calls.push(args); return args; }
		async replyCampusMessage(...args) { calls.push(args); return args; }
	}
	const module = { exports: {} };
	vm.runInNewContext(fs.readFileSync(path.join(root, admin ? 'admin/admin_campus_service_controller.js' : 'campus_service_controller.js'), 'utf8'), {
		module, require(name) { return name.includes('campus_service_service') ? Service : Base; }
	});
	return { controller: new module.exports(), calls };
}

test('client controller passes cursor options and uses trusted identity', async () => {
	const { controller } = load(false, { serviceId: 'service', userId: 'forged', before: 'CSM1', limit: 20 });
	const args = await controller.getCampusChat();
	assert.equal(args[0], 'trusted-openid');
	assert.equal(args[1], 'service');
	assert.equal(args[2].before, 'CSM1');
	assert.equal(args[2].limit, 20);
});

test('both controllers reject oversized page limits and preserve defaults', async () => {
	for (const admin of [false, true]) {
		const key = admin ? 'sessionId' : 'serviceId';
		const method = admin ? 'getAdminCampusChatDetail' : 'getCampusChat';
		await assert.rejects(load(admin, { [key]: 'test', limit: 101 }).controller[method]());
		await assert.rejects(load(admin, { [key]: 'test', limit: 0 }).controller[method]());
		const args = await load(admin, { [key]: 'test' }).controller[method]();
		assert.equal(args.at(-1).limit, 50);
	}
});

test('admin chat read and reply require authentication before service access', async () => {
	for (const method of ['getAdminCampusChatDetail', 'replyCampusMessage']) {
		const { controller, calls } = load(true, { sessionId: 'session', content: 'hello' }, false);
		await assert.rejects(controller[method](), /not admin/);
		assert.deepEqual(calls, ['auth']);
	}
});

test('list pagination rejects zero and oversized pages before database calls', async () => {
	for (const [admin, method] of [[false, 'getCampusServiceList'], [true, 'getAdminCampusServiceList'], [true, 'getAdminCampusChatList']]) {
		await assert.rejects(load(admin, { page: 0, size: 20 }).controller[method](), error => /不能小于/.test(error.message));
		await assert.rejects(load(admin, { page: 1, size: 101 }).controller[method](), error => /不能大于/.test(error.message));
	}
});

test('admin session ID length and message lengths are validated', async () => {
	await assert.rejects(load(true, { sessionId: 'x'.repeat(201), content: 'hello' }).controller.replyCampusMessage());
	await assert.rejects(load(false, { serviceId: 'service', content: 'x'.repeat(501) }).controller.sendCampusMessage());
});
