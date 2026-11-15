'use strict';
/**
 * 后台用户数据权限：客服只能核对身份与审核状态，拿不到学号、学生证、
 * openid 与注册资料；管理员及以上保持完整内容。列表排序只允许白名单字段。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fixture } = require('../test-support/operations-fixture.cjs');

const root = path.resolve(__dirname, '../../cloudfunctions/mcloud/project/crun');

function setup() {
  const f = fixture();
  f.user('u1', {
    USER_NAME: '张三', USER_MOBILE: '13800001234', USER_PIC: 'cloud://avatar', USER_STATUS: 1, USER_ADD_TIME: 1700000000000,
    USER_FORMS: [
      { mark: 'sex', val: '男' }, { mark: 'college', val: '计算机学院' }, { mark: 'sub', val: '软件工程' },
      { mark: 'studentId', val: '20230001' }, { mark: 'studentCard', val: ['cloud://card.jpg'] },
      { mark: 'campus', val: '育才校区' }
    ]
  });
  f.table('user').get('u1').USER_OBJ = { memo: '私有备注' };
  // u2 处于待审核：客服这时可以只读核对学号与学生证。
  f.user('u2', {
    USER_NAME: '李四', USER_MOBILE: '13900005678', USER_PIC: 'cloud://avatar2', USER_STATUS: 0, USER_ADD_TIME: 1700000001000,
    USER_FORMS: [
      { mark: 'sex', val: '女' }, { mark: 'college', val: '外国语学院' }, { mark: 'sub', val: '英语' },
      { mark: 'studentId', val: '20230002' }, { mark: 'studentCard', val: ['cloud://card2.jpg'] },
      { mark: 'campus', val: '育才校区' }
    ]
  });
  f.table('user').get('u2').USER_OBJ = { memo: '待审备注' };
  return { f, svc: new (f.load('admin/admin_user_service.js'))() };
}

test('customer service list and detail only expose the masked whitelist', async () => {
  const { svc } = setup();
  const list = await svc.getUserList({ page: 1, size: 20 }, { service: true });
  const row = list.list.find(item => item._id === 'u1');
  assert.equal(row.USER_MOBILE, '138****1234');
  assert.equal(row.USER_CAMPUS, '育才校区');
  assert.deepEqual(Object.keys(row).sort(),
    ['USER_ADD_TIME', 'USER_CAMPUS', 'USER_MOBILE', 'USER_NAME', 'USER_PIC', 'USER_STATUS', '_id'].sort());
  assert.equal(row.USER_MINI_OPENID, undefined);
  assert.equal(row.USER_FORMS, undefined);

  const detail = await svc.getUser({ userId: 'u1' }, { service: true, audit: true });
  assert.equal(detail.USER_MOBILE, '138****1234');
  assert.equal(detail.USER_AUDIT, undefined, '已通过审核的用户不返回学号与学生证');
  assert.equal(detail.USER_CAMPUS, '育才校区');
  assert.equal(detail.USER_FORMS, undefined);
  assert.equal(detail.USER_MINI_OPENID, undefined);
  assert.equal(detail.USER_OBJ, undefined);
  assert.equal(detail.USER_ID, undefined);
  const text = JSON.stringify(detail);
  assert.equal(text.includes('20230001'), false, '不返回学号');
  assert.equal(text.includes('card.jpg'), false, '不返回学生证图片');
  assert.equal(text.includes('私有备注'), false, '不返回注册资料以外的私有内容');
});

test('administrators keep the complete record', async () => {
  const { svc } = setup();
  const list = await svc.getUserList({ page: 1, size: 20 });
  const row = list.list.find(item => item._id === 'u1');
  assert.equal(row.USER_MOBILE, '13800001234');
  assert.equal(row.USER_MINI_OPENID, 'u1');
  assert.equal(row.USER_FORMS.length, 6);
  const detail = await svc.getUser({ userId: 'u1' });
  assert.equal(detail.USER_MOBILE, '13800001234');
  assert.equal(detail.USER_FORMS.find(item => item.mark === 'studentId').val, '20230001');
  assert.equal(detail.USER_OBJ.memo, '私有备注');
});

test('customer service cannot export user data', async () => {
  const Controller = require('../../cloudfunctions/mcloud/project/crun/controller/admin/base_project_admin_controller.js');
  const probe = Object.create(Controller.prototype);
  // 只验证角色层：跳过令牌校验，直接看 isManager 对客服的拒绝。
  probe.isAdmin = async () => { };
  probe._admin = { ADMIN_ROLE: 'service' };
  await assert.rejects(probe.isManager(), /没有该操作权限/);
  probe._admin = { ADMIN_ROLE: 'admin' };
  await probe.isManager();

  // 三个导出入口都要求管理员及以上（userDataGet / userDataExport / userDataDel）。
  const source = fs.readFileSync(path.join(root, 'controller/admin/admin_user_controller.js'), 'utf8');
  for (const method of ['userDataGet', 'userDataExport', 'userDataDel']) {
    const at = source.indexOf('async ' + method);
    assert.ok(at > 0, method + ' 应存在');
    assert.match(source.slice(at, at + 160), /await this\.isManager\(\)/, method + ' 必须先校验管理员权限');
  }
});

test('only the whitelisted order field and direction are accepted', async () => {
  const { svc } = setup();
  await assert.rejects(svc.getUserList({ page: 1, orderBy: { USER_MOBILE: 'desc' } }, { service: true }), /排序字段/);
  await assert.rejects(svc.getUserList({ page: 1, orderBy: { USER_ADD_TIME: 'sideways' } }), /排序方式/);
  await assert.rejects(svc.getUserList({ page: 1, sortType: 'sort', sortVal: 'USER_MOBILE|desc' }), /排序字段/);
  const ok = await svc.getUserList({ page: 1, orderBy: { USER_ADD_TIME: 'asc' } }, { service: true });
  assert.ok(ok.list.some(item => item._id === 'u1'));
});

test('the detail mapper renders restricted rows safely and shows the masked phone', () => {
  const UI = require('../../miniprogram/projects/crun/biz/admin_console_biz.js');
  const profile = UI.userProfile({ _id: 'u1', USER_NAME: '张三', USER_MOBILE: '138****1234', USER_STATUS: 1, USER_ADD_TIME: 1, USER_CAMPUS: '育才校区' });
  assert.equal(profile.name, '张三');
  assert.equal(profile.mobile, '138****1234');
  assert.deepEqual(profile.registers.map(item => item.value), ['无', '无', '无', '无', '无']);
  assert.deepEqual(profile.studentCard, []);
  assert.deepEqual(profile.contacts, []);
  assert.deepEqual(profile.addresses, []);
  assert.deepEqual(profile.others, []);
  const text = JSON.stringify(profile);
  assert.equal(text.includes('undefined'), false);
});

test('customer service can review the student id and card of a pending user only', async () => {
  const { svc } = setup();
  const detail = await svc.getUser({ userId: 'u2' }, { service: true, audit: true });
  assert.equal(detail.USER_STATUS, 0);
  assert.equal(detail.USER_MOBILE, '139****5678');
  assert.deepEqual(JSON.parse(JSON.stringify(detail.USER_AUDIT)), { studentId: '20230002', studentCard: ['cloud://card2.jpg'] });
  assert.equal(detail.USER_FORMS, undefined, '注册资料的其它项仍不返回');
  assert.equal(detail.USER_MINI_OPENID, undefined);
  assert.equal(detail.USER_OBJ, undefined);
  const text = JSON.stringify(detail);
  for (const secret of ['外国语学院', '英语', '待审备注', '20230001']) assert.equal(text.includes(secret), false, secret);

  // 列表永远不带审核资料，即使调用方要求。
  const list = await svc.getUserList({ page: 1, size: 20 }, { service: true, audit: true });
  const row = list.list.find(item => item._id === 'u2');
  assert.equal(row.USER_AUDIT, undefined);
  assert.equal(JSON.stringify(list).includes('20230002'), false);
  assert.equal(JSON.stringify(list).includes('card2.jpg'), false);
});

test('administrators still receive every registration field including the pending student card', async () => {
  const { svc } = setup();
  const detail = await svc.getUser({ userId: 'u2' }, { service: false, audit: false });
  assert.equal(detail.USER_MOBILE, '13900005678');
  assert.equal(detail.USER_AUDIT, undefined);
  assert.equal(detail.USER_FORMS.find(item => item.mark === 'studentId').val, '20230002');
  assert.deepEqual(detail.USER_FORMS.find(item => item.mark === 'studentCard').val, ['cloud://card2.jpg']);
  assert.equal(detail.USER_OBJ.memo, '待审备注');
});

test('the detail mapper exposes the audit block only when the server sends it', () => {
  const UI = require('../../miniprogram/projects/crun/biz/admin_console_biz.js');
  const pending = UI.userProfile({ _id: 'u2', USER_STATUS: 0, USER_NAME: '李四', USER_MOBILE: '139****5678',
    USER_AUDIT: { studentId: '20230002', studentCard: ['https://signed.invalid/card'], error: '' } });
  assert.deepEqual(pending.audit, { studentId: '20230002', studentCard: ['https://signed.invalid/card'], error: '' });
  const approved = UI.userProfile({ _id: 'u1', USER_STATUS: 1, USER_NAME: '张三' });
  assert.equal(approved.audit, null);
});
