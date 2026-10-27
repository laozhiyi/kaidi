'use strict';
/**
 * 客服邀请码的运维收尾：
 * - 过期未用的码由系统维护标记为已过期（INVITE_STATUS=2），后台不再显示「待使用」
 * - 重复码只巡检报告，不自动删除——保留哪一条由管理员决定
 */
const assert = require('node:assert/strict');
const test = require('node:test');
const { fixture, A, tenant } = require('../test-support/tenant-services.cjs');

const now = Date.now();
const invite = (code, expiresAt, status = 1) => ({
	INVITE_CODE: code, INVITE_ROLE: 'service', INVITE_STATUS: status,
	INVITE_CREATED_AT: now - 60000, INVITE_EXPIRES_AT: expiresAt
});

async function setup() {
	const f = fixture();
	await f.setup();
	return { f, maintenance: new (f.service('maintenance_service'))() };
}

test('maintenance marks expired unused invite codes and leaves the rest alone', async () => {
	const { f, maintenance } = await setup();
	await f.put(A, 'staff_invite', 'inv-expired', invite('OLD12345', now - 1000));
	await f.put(A, 'staff_invite', 'inv-live', invite('NEW12345', now + 60000));
	await f.put(A, 'staff_invite', 'inv-used', invite('USD12345', now - 1000, 0));

	const result = await tenant.run(A, () => maintenance.run());

	assert.equal(result.invites, 1, 'only the expired unused code is counted');
	assert.equal(f.table('staff_invite').get('inv-expired').INVITE_STATUS, 2);
	assert.equal(f.table('staff_invite').get('inv-live').INVITE_STATUS, 1);
	assert.equal(f.table('staff_invite').get('inv-used').INVITE_STATUS, 0, 'used codes keep their history');
	assert.equal(result.inviteDuplicates.length, 0, 'no duplicate is reported for clean data');
});

test('maintenance reports duplicate invite codes without deleting either record', async () => {
	const { f, maintenance } = await setup();
	await f.put(A, 'staff_invite', 'dup-a', invite('DUP12345', now + 60000));
	await f.put(A, 'staff_invite', 'dup-b', invite('DUP12345', now + 60000));
	await f.put(A, 'staff_invite', 'solo', invite('SOL12345', now + 60000));

	const result = await tenant.run(A, () => maintenance.run());

	// 结果来自 vm 沙箱，跨 realm 的数组原型不同，按内容比较。
	assert.equal(JSON.stringify(result.inviteDuplicates), JSON.stringify([{ code: 'DUP12345', count: 2 }]));
	assert.equal(f.table('staff_invite').size, 3, 'nothing is removed automatically');
});

test('an invite marked expired by maintenance is reported as expired, not used', async () => {
	const { f, maintenance } = await setup();
	await f.put(A, 'staff_invite', 'inv-old', invite('GONE2345', now - 1000));
	await f.put(A, 'user', 'model-old', {
		USER_MINI_OPENID: 'poster', USER_NAME: '老用户', USER_STATUS: 1, USER_ROLE: ''
	});
	await tenant.run(A, () => maintenance.run());
	assert.equal(f.table('staff_invite').get('inv-old').INVITE_STATUS, 2);

	const service = new (f.service('admin/staff_invite_service'))();
	await tenant.run(A, async () => {
		await assert.rejects(service.redeem('poster', 'GONE2345', '小助手'), /已过期/);
	});
	assert.equal(f.table('user').get('model-old').USER_ROLE, '');
});
