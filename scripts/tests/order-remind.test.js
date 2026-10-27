'use strict';
// 「提醒发布人收货」的 5 分钟冷却，以及「全校校区名录」的统一读取。
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('../test-support/operations-fixture.cjs');

async function delivered() {
  const f = fixture(), id = await f.publish();
  await f.service.acceptMail('rider', id, { requestId: f.req('accept') });
  await f.service.pickupMail('rider', id, { requestId: f.req('pickup'), images: ['cloud://bucket/private-evidence/rider/pickup.png'] });
  await f.service.deliverMail('rider', id, { requestId: f.req('deliver'), note: '已放到201室门口', images: ['cloud://bucket/private-evidence/rider/one.png'] });
  return Object.assign(f, { id, mail: () => f.table('mail').get(id) });
}

const reminders = f => [...f.table('notification').values()].filter(row => row.action === 'remind');

test('提醒发布人收货在同一订单上 5 分钟只能发一次，冷却期内不重复推送', async () => {
  const f = await delivered();
  const first = await f.service.remindReceipt('rider', f.id, { requestId: f.req('remind') });
  assert.equal(first.reminded, true);
  assert.equal(reminders(f).length, 1);
  assert.ok(first.nextRemindAt >= Date.now() + 4 * 60000, '返回下一次可提醒的时间');
  assert.ok(f.mail().MAIL_REMIND_AT > 0, '冷却时间点写在订单上，重启后仍然生效');

  await assert.rejects(() => f.service.remindReceipt('rider', f.id, { requestId: f.req('remind2') }), /分钟后再试/);
  assert.equal(reminders(f).length, 1, '冷却期内不再产生新的提醒消息');

  // 冷却结束后可以再提醒一次。
  const mail = f.mail();
  f.table('mail').set(f.id, { ...mail, MAIL_REMIND_AT: Date.now() - 5 * 60000 - 1000 });
  await f.service.remindReceipt('rider', f.id, { requestId: f.req('remind3') });
  assert.equal(reminders(f).length, 2);
});

test('不是接单骑手、或订单不在待收货时都不能提醒', async () => {
  const f = await delivered();
  await assert.rejects(() => f.service.remindReceipt('rider2', f.id, { requestId: f.req('remind') }), /仅接单骑手/);
  const mail = f.mail();
  f.table('mail').set(f.id, { ...mail, MAIL_STATUS: 4 });
  await assert.rejects(() => f.service.remindReceipt('rider', f.id, { requestId: f.req('remind') }), /无需提醒收货/);
  assert.equal(reminders(f).length, 0);
});

test('校园名录返回全校开放校区，并把当前校区排在第一个', async () => {
  const f = fixture(), Tenant = f.load('tenant_service.js');
  for (const [campusId, name, enabled] of [['yucai', '育才校区', true], ['wangcheng', '王城校区', true], ['yanshan', '雁山校区', true], ['closed', '已停用校区', false]]) {
    f.table('campus').set('campus_gxnu_' + campusId, { _id: 'campus_gxnu_' + campusId, _pid: 'crun', schoolId: 'gxnu', campusId, name, enabled });
  }
  const names = await new Tenant().campusNames('gxnu', 'yanshan');
  // 与首页「学校 · 校区」胶囊、校区选择器一样按目录顺序（_id 升序），当前校区提到最前。
  assert.deepEqual(names, ['雁山校区', '王城校区', '育才校区']);
  assert.deepEqual(await new Tenant().campusNames('gxnu'), ['王城校区', '雁山校区', '育才校区']);
});
