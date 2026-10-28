'use strict';
/**
 * 客服开通的简化路径：
 * - 客服只认微信 OpenID，没在用户端注册过也能直接开通（静默建号 + 绑定当前微信）
 * - 一次请求同时返回后台会话，前端不用再补一次 admin/wechat_login
 * - 称呼留空也有可读的默认名，同意时间落库留痕
 * - 邀请码仍然一次性
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, A, tenant } = require('../test-support/tenant-services.cjs');

const invite = code => ({
	INVITE_CODE: code, INVITE_ROLE: 'service', INVITE_STATUS: 1,
	INVITE_CREATED_AT: Date.now() - 60000, INVITE_EXPIRES_AT: Date.now() + 3600000
});

async function setup() {
	const f = fixture({ phoneLoginEnabled: true });
	await f.setup();
	await f.put(A, 'staff_invite', 'inv-live', invite('K3M7QT2X'));
	f.passport = () => new (f.service('passport_service'))();
	f.user = openid => tenant.run(A, () => f.table('user').get(f.store.schoolKey('crun', 'user', openid)));
	f.redeem = (openid, name) => tenant.run(A, () => f.passport().redeemStaffInvite(openid, 'K3M7QT2X', name));
	return f;
}

test('a WeChat identity with no user record can open service access in one request', async () => {
	const f = await setup();
	assert.equal(f.user('staff-new'), undefined, 'precondition: this WeChat has never registered');

	const result = await f.redeem('staff-new', '小陈');

	assert.equal(result.ok, true);
	assert.equal(result.role, 'service');
	assert.equal(result.token.role, 'service');
	assert.equal(result.token.staff, true);
	assert.equal(result.token.status, 1);
	// 后台会话随同一次请求返回，前端不必再打 admin/wechat_login
	assert.match(result.admin.token, /^[a-f0-9]{64}$/);
	assert.equal(result.admin.role, 'service');
	assert.equal(result.admin.name, '小陈');

	const user = f.user('staff-new');
	assert.equal(user.USER_MINI_OPENID, 'staff-new', '微信身份按 OpenID 静默绑定');
	assert.equal(user.USER_ROLE, 'service');
	assert.equal(user.USER_STAFF, true);
	assert.equal(user.USER_STATUS, 1);
	assert.equal(user.USER_NAME, '小陈');
	assert.equal(typeof user.USER_STAFF_AGREED_AT, 'number', '同意时间留痕');
	// 客服不走学生注册：不产生手机号/资料门槛
	assert.equal(user.USER_MOBILE_VERIFIED, false);
	assert.equal(f.table('staff_invite').get('inv-live').INVITE_STATUS, 0, '邀请码仍然一次性');
});

test('an empty name still produces a readable staff display name', async () => {
	const f = await setup();
	const result = await f.redeem('staff-nameless', '');
	const user = f.user('staff-nameless');
	assert.match(user.USER_NAME, /^客服[0-9a-zA-Z]{4}$/);
	assert.equal(result.admin.name, user.USER_NAME);
});

test('a used invite code cannot open a second account', async () => {
	const f = await setup();
	await f.redeem('staff-first');
	await assert.rejects(f.redeem('staff-second'), /已被使用/);
	// 建号这一步先于验码发生（和直接点微信登录等价），但不会有任何后台权限。
	const user = f.user('staff-second');
	assert.equal(user.USER_ROLE, undefined);
	assert.equal(user.USER_STAFF, undefined);
	const bound = [...f.table('admin').values()].filter(row => row.ADMIN_USER_ID);
	assert.equal(bound.length, 1, '只有第一位客服拿到后台账号');
});

test('a registered student keeps their own name when a name is omitted', async () => {
	const f = await setup();
	await f.put(A, 'user', tenant.run(A, () => f.store.schoolKey('crun', 'user', 'staff-student')), {
		USER_MINI_OPENID: 'staff-student', USER_NAME: '李同学', USER_STATUS: 1,
		USER_MOBILE: '13900000001', USER_MOBILE_VERIFIED: true, USER_PROFILE_COMPLETE: true,
		USER_PIC: 'cloud://fixture/avatar', USER_FORMS: []
	});
	const result = await f.redeem('staff-student', '');
	assert.equal(result.admin.name, '李同学');
	assert.equal(f.user('staff-student').USER_NAME, '李同学');
});
