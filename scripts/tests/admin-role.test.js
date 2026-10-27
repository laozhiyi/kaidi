'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('../test-support/operations-fixture.cjs');

const superAdmin = { _id: 'admin', ADMIN_TYPE: 1, ADMIN_NAME: '超级管理员' };
const normalAdmin = { _id: 'admin-2', ADMIN_TYPE: 0, ADMIN_ROLE: 'admin', ADMIN_NAME: '管理员' };
const serviceAdmin = { _id: 'admin-3', ADMIN_TYPE: 0, ADMIN_ROLE: 'service', ADMIN_NAME: '客服' };

test('super admin grants and revokes administrator roles and keeps a linked backend account', async () => {
  const f = fixture();
  f.user('staff', { USER_STATUS: 1 });
  const users = new (f.load('admin/admin_user_service.js'))();
  let result = await users.setUserRole('staff', 'admin', superAdmin);
  assert.equal(result.role, 'admin');
  assert.equal(f.table('user').get('staff').USER_ROLE, 'admin');
  const linked = [...f.table('admin').values()].find(row => row.ADMIN_USER_ID === 'staff');
  assert.equal(linked.ADMIN_ROLE, 'admin');
  assert.equal(linked.ADMIN_TYPE, 0);
  assert.equal(linked.ADMIN_STATUS, 1);

  result = await users.setUserRole('staff', '', superAdmin);
  assert.equal(result.role, '');
  const revoked = f.table('admin').get(linked._id);
  assert.equal(revoked.ADMIN_STATUS, 0);
  assert.equal(revoked.ADMIN_TOKEN, '');
});

test('administrators may grant customer service only, and customer service can never grant', async () => {
  const f = fixture();
  f.user('helper', { USER_STATUS: 1 });
  f.user('another', { USER_STATUS: 1 });
  const users = new (f.load('admin/admin_user_service.js'))();
  await users.setUserRole('helper', 'service', normalAdmin);
  assert.equal(f.table('user').get('helper').USER_ROLE, 'service');
  await assert.rejects(users.setUserRole('another', 'admin', normalAdmin), /超级管理员/);
  await assert.rejects(users.setUserRole('another', 'service', serviceAdmin), /客服/);
  await assert.rejects(users.setUserRole('another', 'super', normalAdmin), /超级管理员/);
  assert.equal(f.table('user').get('another').USER_ROLE, undefined);
});

test('role changes cannot target the operator itself or leave no super administrator', async () => {
  const f = fixture();
  f.user('owner', { USER_STATUS: 1 });
  const users = new (f.load('admin/admin_user_service.js'))();
  await users.setUserRole('owner', 'super', superAdmin);
  await assert.rejects(users.setUserRole('owner', '', { ...superAdmin, ADMIN_USER_ID: 'owner', ADMIN_WECHAT: true }), /自己/);
  f.user('other', { USER_STATUS: 1 });
  await users.setUserRole('other', 'super', superAdmin);
  await users.setUserRole('owner', 'admin', { _id: 'x', ADMIN_TYPE: 1, ADMIN_ROLE: 'super', ADMIN_USER_ID: 'other' });
  await assert.rejects(users.setUserRole('other', '', { _id: 'x', ADMIN_TYPE: 1, ADMIN_ROLE: 'super', ADMIN_USER_ID: 'owner' }), /保留/);
});

test('账号密码管理员给自己的微信用户授权，不会被当成微信身份接管', async () => {
  const f = fixture();
  f.user('owner', { USER_STATUS: 1, USER_NAME: '小王' });
  f.user('boss', { USER_STATUS: 1, USER_NAME: '小李' });
  // 初始平台管理员用账号密码登录：会话令牌绑定操作人 openid，且历史上已被错误关联
  f.table('admin').set('admin', {
    _id: 'admin', _pid: 'crun', ADMIN_NAME: 'admin', ADMIN_DESC: '初始管理员', ADMIN_PHONE: '13800000001',
    ADMIN_PASSWORD: 'hashed', ADMIN_STATUS: 1, ADMIN_TYPE: 1, ADMIN_USER_ID: 'owner',
    ADMIN_TOKEN: 'session-token', ADMIN_TOKEN_USER: 'owner', ADMIN_TOKEN_TIME: Date.now()
  });
  const users = new (f.load('admin/admin_user_service.js'))();
  await users.setUserRole('boss', 'super', f.table('admin').get('admin'));
  await users.setUserRole('owner', 'super', f.table('admin').get('admin'));

  const account = f.table('admin').get('admin');
  assert.equal(account.ADMIN_USER_ID, '');
  assert.equal(account.ADMIN_NAME, 'admin');
  assert.equal(account.ADMIN_DESC, '初始管理员');
  assert.equal(account.ADMIN_PHONE, '13800000001');
  assert.equal(account.ADMIN_PASSWORD, 'hashed');
  assert.equal(account.ADMIN_TYPE, 1);
  assert.equal(account.ADMIN_TOKEN, 'session-token');

  const linked = [...f.table('admin').values()].filter(row => row.ADMIN_USER_ID === 'owner');
  assert.equal(linked.length, 1);
  assert.notEqual(linked[0]._id, 'admin');
  assert.equal(linked[0].ADMIN_WECHAT, true);
  assert.equal(linked[0].ADMIN_ROLE, 'super');

  // 再次调整这个微信账号的角色不再报“改自己”，也不会重复建号
  await users.setUserRole('owner', 'admin', f.table('admin').get('admin'));
  assert.equal(f.table('user').get('owner').USER_ROLE, 'admin');
  const again = [...f.table('admin').values()].filter(row => row.ADMIN_USER_ID === 'owner');
  assert.equal(again.length, 1);
  assert.equal(again[0].ADMIN_ROLE, 'admin');
  assert.equal(f.table('admin').get('admin').ADMIN_USER_ID, '');
});

test('遗留的微信后台账号在再次同步时换成带标记的独立账号并清掉旧会话', async () => {
  const f = fixture();
  f.user('staff', { USER_STATUS: 1 });
  f.table('admin').set('legacy', {
    _id: 'legacy', _pid: 'crun', ADMIN_NAME: 'staff', ADMIN_STATUS: 1, ADMIN_TYPE: 0,
    ADMIN_ROLE: 'service', ADMIN_USER_ID: 'staff', ADMIN_TOKEN: 'old-token', ADMIN_TOKEN_USER: 'staff'
  });
  const users = new (f.load('admin/admin_user_service.js'))();
  await users.setUserRole('staff', 'admin', superAdmin);

  const old = f.table('admin').get('legacy');
  assert.equal(old.ADMIN_USER_ID, '');
  assert.equal(old.ADMIN_TOKEN, '');
  const rows = [...f.table('admin').values()].filter(row => row.ADMIN_USER_ID === 'staff');
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0]._id, 'legacy');
  assert.equal(rows[0].ADMIN_WECHAT, true);
  assert.equal(rows[0].ADMIN_ROLE, 'admin');
});

test('停用微信用户只结束它自己的后台会话，不停用账号密码管理员', async () => {
  const f = fixture();
  f.user('owner', { USER_STATUS: 1 });
  f.table('admin').set('admin', {
    _id: 'admin', _pid: 'crun', ADMIN_NAME: 'admin', ADMIN_PASSWORD: 'hashed', ADMIN_STATUS: 1,
    ADMIN_TYPE: 1, ADMIN_USER_ID: 'owner', ADMIN_TOKEN: 'session-token', ADMIN_TOKEN_USER: 'owner'
  });
  const users = new (f.load('admin/admin_user_service.js'))();
  await users.statusUser('owner', 9, '违规');

  const account = f.table('admin').get('admin');
  assert.equal(account.ADMIN_STATUS, 1);
  assert.equal(account.ADMIN_TOKEN, '');
});

test('disabled accounts cannot be granted a role and stopping a user revokes the backend session', async () => {
  const f = fixture();
  f.user('blocked', { USER_STATUS: 9 });
  f.user('staff', { USER_STATUS: 1 });
  const users = new (f.load('admin/admin_user_service.js'))();
  await assert.rejects(users.setUserRole('blocked', 'admin', superAdmin), /停用/);
  await users.setUserRole('staff', 'service', superAdmin);
  const linked = [...f.table('admin').values()].find(row => row.ADMIN_USER_ID === 'staff');
  await users.statusUser('staff', 9, '违规');
  assert.equal(f.table('admin').get(linked._id).ADMIN_STATUS, 0);
  assert.equal(f.table('admin').get(linked._id).ADMIN_TOKEN, '');
});

test('WeChat backend login rejects users without a role and issues a session for granted roles', async () => {
  const f = fixture();
  const mgr = new (f.load('admin/admin_mgr_service.js'))();
  await assert.rejects(mgr.wechatLogin('poster'), /后台权限/);
  await assert.rejects(mgr.wechatLogin(''), /微信登录/);
  const users = new (f.load('admin/admin_user_service.js'))();
  await users.setUserRole('poster', 'service', superAdmin);
  const session = await mgr.wechatLogin('poster');
  assert.match(session.token, /^[a-f0-9]{64}$/);
  assert.equal(session.role, 'service');
  assert.equal(session.roleLabel, '客服');
  assert.equal(session.type, 0);
  assert.equal(session.wechat, true);
  assert.equal(f.table('user').get('poster').USER_ROLE, 'service');
});

test('pending registrations may publish orders but cannot accept them', async () => {
  const f = fixture();
  f.user('pending', { USER_STATUS: 0 });
  const id = await f.publish({}, 'pending');
  assert.ok(id);
  const order = [...f.table('mail').values()].find(row => row._id === id);
  assert.equal(order.MAIL_STATUS, 0);
  f.user('riderPending', { USER_STATUS: 0 });
  await assert.rejects(f.service.acceptMail('riderPending', id, { requestId: f.req('pending-accept') }), /注册审核/);
  await f.service.acceptMail('rider', id, { requestId: f.req('approved-accept') });
  assert.equal(f.table('mail').get(id).MAIL_STATUS, 1);
});

test('rejected or disabled registrations cannot publish', async () => {
  const f = fixture();
  f.user('rejected', { USER_STATUS: 8 });
  f.user('stopped', { USER_STATUS: 9 });
  await assert.rejects(f.publish({}, 'rejected'));
  await assert.rejects(f.publish({}, 'stopped'));
});
