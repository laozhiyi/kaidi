'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const UI = require('../../miniprogram/projects/crun/biz/mail_ui_biz.js');
const { fixture } = require('../test-support/operations-fixture.cjs');
const { client } = require('../test-support/reliability-client.cjs');
const { harness } = require('../test-support/admin-console-harness.cjs');
const path = require('node:path');
const { runMiniProgram } = require('../test-support/miniprogram-module.cjs');
const flags = steps => Array.from(steps, step => step.done);
const at = Date.parse('2026-09-22T10:00:00+08:00');
const basic = { MAIL_STATUS: 0, MAIL_PAYMENT_MODE: 'offline', MAIL_ADD_TIME: at, MAIL_END_TIME: at + 3600000, MAIL_OBJ: {} };
function controller(f, actor, params) {
 class Base {
  constructor() { this._userId = actor; }
  validateData(schema) { return require('../../cloudfunctions/mcloud/framework/validate/data_check.js').check(structuredClone(params), schema); }
 }
 const Controller = runMiniProgram(path.join(__dirname, '../../cloudfunctions/mcloud/project/crun/controller/mail_controller.js'), { require(name) {
  if (name.endsWith('base_project_controller.js')) return Base;
  if (name.endsWith('mail_service.js')) return f.load('mail_service.js');
  if (name.endsWith('operation_store.js')) return f.store;
  if (name.endsWith('time_util.js')) return require('../../cloudfunctions/mcloud/framework/utils/time_util.js');
  if (name.endsWith('content_check.js')) return {};
  throw Error('Unexpected dependency ' + name);
 } });
 return new Controller();
}

test('each real order operation lights exactly its own milestone in details and cards', async () => {
 const f = fixture({ projectFields: true }), id = await f.publish();
 const c = client(), page = c.mount('projects/crun/pages/order/index/order_index.js');
 const actions = [
  [0, null, null, [true, false, false, false, false]],
  [1, 'acceptMail', 'rider', [true, true, false, false, false]],
  [2, 'pickupMail', 'rider', [true, true, true, false, false]],
  [3, 'deliverMail', 'rider', [true, true, true, true, false]],
  [4, 'finishMail', 'poster', [true, true, true, true, true]]
 ];
 for (const [current, method, actor, expected] of actions) {
  if (method) await f.service[method](actor, id, { requestId: f.req(method), note: '当面交付', images: ['cloud://proof'] });
  const dto = await f.service.viewMail('poster', id), progress = UI.progress(dto);
  assert.deepEqual(flags(progress.steps), expected, method || 'publish');
  assert.deepEqual(progress.steps.map(step => step.current), expected.map((_, i) => i === current));
  assert.equal(progress.step, current);
  assert.match(progress.steps[current].timeText, /^\d{4}-\d\d-\d\d \d\d:\d\d$/);
  assert.deepEqual(flags(page._decorateOrder(dto).progressSteps), expected);
  const rows = await f.service.getMailList('poster', { sortType: current === 4 ? 'my_done' : 'my_post' });
  assert.deepEqual(flags(UI.progress(rows.list.find(row => row._id === id)).steps), expected, 'list projection must retain milestone evidence');
 }
});

test('admin completion before collection never invents acceptance, pickup or delivery', async () => {
 const f = fixture(), id = await f.publish();
 await f.service.holdMail('admin', id, { requestId: f.req('hold'), note: '用户要求人工处理' });
 await f.service.resolveMail('admin', id, { requestId: f.req('resolve'), resolution: 'complete', note: '双方同意完结' });
 const dto = await f.service.viewMail('poster', id), ui = UI.detail(dto);
 assert.deepEqual(flags(ui.steps), [true, false, false, false, true]);
 assert.match(ui.title, /管理员.*完结/);
 assert.doesNotMatch(ui.note, /顺利|确认收货/);
 assert.equal(ui.steps[2].timeText, ''); assert.equal(ui.steps[3].timeText, '');
 const admin = harness('orders/detail/admin_order_detail.js').UI.order(dto);
 assert.deepEqual(flags(admin.steps), [true, false, false, false, true]);
 assert.equal(admin.steps[4].timeText, ui.steps[4].timeText);
});

test('legacy completion without intermediate evidence leaves those milestones unconfirmed', () => {
 for (const status of [1, 4, 2, 9]) {
  const expected = { 1: [true,true,false,false,false], 4: [true,false,true,false,false], 2: [true,false,false,true,false], 9: [true,false,false,false,true] }[status];
  const progress = UI.progress({ ...basic, MAIL_STATUS: status }, at + 1000);
  assert.deepEqual(flags(progress.steps), expected);
  assert.equal(progress.steps[progress.step].timeText, '');
 }
});

test('event history supplies missing times without treating edits, reminders or proof updates as new delivery', () => {
 const progress = UI.progress({ ...basic, MAIL_STATUS: 9, MAIL_HISTORY: [
  { action: 'accept', at: at + 60000 }, { action: 'pickup', at: at + 120000 },
  { action: 'deliver', at: at + 180000 }, { action: 'update_proof', at: at + 240000 },
  { action: 'confirm', at: at + 300000 }, { action: 'overdue', at: at + 360000 }, null
 ] }, at + 400000);
 assert.deepEqual(progress.steps.map(step => step.timeText), ['2026-09-22 10:00', '2026-09-22 10:01', '2026-09-22 10:02', '2026-09-22 10:03', '2026-09-22 10:05']);
 const missing = UI.progress({ ...basic, MAIL_STATUS: 9, MAIL_PICKUP_TIME: 'bad', MAIL_DELIVERED_TIME: 0, MAIL_HISTORY: [{action: 'update_proof', at}] }, at);
 assert.deepEqual(flags(missing.steps), [true,false,false,false,true]);
});

test('stopped, expired and unknown states cannot imply an active fulfillment stage', () => {
 for (const row of [{ MAIL_STATUS: 3 }, { MAIL_STATUS: 99 }, { MAIL_STATUS: null }, { MAIL_STATUS: 'bad' }, { MAIL_END_TIME: at - 1 }]) {
  const progress = UI.progress({ ...basic, ...row }, at);
  assert.equal(progress.step, -1);
  assert.equal(progress.steps.some(step => step.current), false);
 }
});

test('delivery proof changes and wall-clock time do not advance the progress', () => {
 const mail = { ...basic, MAIL_STATUS: 2, MAIL_ACCEPT_TIME: at + 1000, MAIL_PICKUP_TIME: at + 2000, MAIL_DELIVERED_TIME: at + 3000,
  MAIL_DELIVERY_PROOF: { at: at + 3000, updatedAt: at + 3600000 } };
 const before = UI.progress(mail, at + 6000), after = UI.progress(mail, at + 86400000);
 assert.deepEqual(after, before); assert.equal(after.steps[3].timeText, '2026-09-22 10:00');
 assert.equal(after.steps[4].done, false);
});

test('buy orders record one purchase milestone and no duplicate delivery-in-progress milestone', () => {
 const progress = UI.progress({ ...basic, MAIL_STATUS: 4, MAIL_ACCEPT_TIME: at, MAIL_PICKUP_TIME: at + 60000, MAIL_OBJ: { serviceType: 'buy' } }, at + 90000);
 assert.deepEqual(progress.steps.filter(step => step.done).map(step => step.label), ['已发布', '已接单', '已购齐']);
 assert.equal(progress.steps.filter(step => step.current).length, 1);
});

for (const serviceType of ['take', 'send', 'buy']) test(serviceType + ' legacy event times survive real controller projection for every detail and list role', async () => {
 const f = fixture({ projectFields: true }), forms = f.forms();
 forms.push({ mark: 'serviceType', val: serviceType });
 if (serviceType === 'buy') forms.push(...Object.entries({ goods: '矿泉水', buyQuantity: 1, goodsBudget: 5 }).map(([mark, val]) => ({ mark, val })));
 const id = await f.publish({ forms });
 for (const [method, actor] of [['acceptMail','rider'], ['pickupMail','rider'], ['deliverMail','rider'], ['finishMail','poster']]) {
  await f.service[method](actor, id, { requestId: f.req(method), note: 'PRIVATE_HANDOVER_NOTE', images: ['cloud://proof'] });
 }
 const stored = f.table('mail').get(id);
 delete stored.MAIL_ACCEPT_TIME; delete stored.MAIL_PICKUP_TIME; delete stored.MAIL_DELIVERED_TIME;
 for (const role of ['poster', 'rider', 'other']) {
  const dto = await controller(f, role, { id }).viewMail();
  assert.deepEqual(flags(UI.progress(dto).steps), [true,true,true,true,true], role);
  assert.ok(UI.progress(dto).steps.every(step => step.timeText));
  if (role !== 'poster') assert.equal(dto.MAIL_HISTORY, undefined, 'private history remains private');
 }
 for (const role of ['poster', 'rider']) {
  const rows = await controller(f, role, { sortType: 'my_done' }).getMailList();
  const card = rows.list.find(row => row._id === id);
  assert.deepEqual(flags(UI.progress(card).steps), [true,true,true,true,true], role + ' card');
  assert.equal(card.MAIL_HISTORY, undefined);
  assert.equal(JSON.stringify(card).includes('PRIVATE_HANDOVER_NOTE'), false);
 }
 assert.equal(stored.MAIL_ACCEPT_TIME, undefined, 'read projection must not mutate stored records');
});

test('a delivered legacy order labels missing earlier evidence as unrecorded instead of still waiting', () => {
 const progress = UI.progress({ ...basic, MAIL_STATUS: 2, MAIL_DELIVERED_TIME: at + 60000 }, at + 120000);
 for (const index of [1, 2]) {
  assert.equal(progress.steps[index].done, false);
  assert.doesNotMatch(progress.steps[index].displayLabel, /^待/);
  assert.match(progress.steps[index].recordText, /未记录/);
 }
 assert.equal(progress.steps[4].displayLabel, '待完成');
});

test('real controller formatting cannot turn legacy zero or invalid times into evidence of acceptance', async () => {
 const f = fixture(), id = await f.publish();
 await f.service.holdMail('admin', id, { requestId: f.req('format-hold'), note: '人工介入' });
 await f.service.resolveMail('admin', id, { requestId: f.req('format-resolve'), resolution: 'complete', note: '人工完结' });
 for (const value of ['0', '-1', -1, true, 'bad', null, Infinity]) {
  f.table('mail').get(id).MAIL_ACCEPT_TIME = value;
  const dto = await controller(f, 'poster', { id }).viewMail();
  assert.equal(UI.progress(dto).steps[1].done, false, String(value));
  assert.equal(dto.MAIL_ACCEPT_TIME, '');
 }
});

test('ISO history times remain available across detail and list projections', async () => {
 const f = fixture({ projectFields: true }), id = await f.publish();
 for (const method of ['acceptMail', 'pickupMail', 'deliverMail']) {
  await f.service[method]('rider', id, { requestId: f.req(method), note: 'PRIVATE_ISO_NOTE', images: ['cloud://proof'] });
 }
 const stored = f.table('mail').get(id);
 delete stored.MAIL_ACCEPT_TIME; delete stored.MAIL_PICKUP_TIME;
 stored.MAIL_HISTORY.forEach(event => { event.at = new Date(event.at).toISOString(); });
 const before = structuredClone(stored);
 for (const role of ['poster', 'rider', 'other']) {
  const dto = await controller(f, role, { id }).viewMail();
  assert.deepEqual(flags(UI.progress(dto).steps), [true,true,true,true,false], role);
  assert.ok(UI.progress(dto).steps.slice(0, 4).every(step => step.timeText), role + ' times');
  if (role !== 'poster') assert.equal(dto.MAIL_HISTORY, undefined);
 }
 for (const [role, sortType] of [['poster','my_post'], ['rider','my_accept']]) {
  const result = await controller(f, role, { sortType }).getMailList();
  const dto = result.list.find(row => row._id === id);
  assert.deepEqual(flags(UI.progress(dto).steps), [true,true,true,true,false], role + ' list');
  assert.equal(JSON.stringify(dto).includes('PRIVATE_ISO_NOTE'), false);
 }
 assert.deepEqual(stored, before, 'read projection must not rewrite legacy history');
});

test('malformed milestone times never become a date while genuine event evidence is retained', () => {
 for (const value of ['0', '-1', -1, true, 'bad', null, Infinity, '2026-02-30 10:00', '2026-13-07 10:00']) {
  const progress = UI.progress({ ...basic, MAIL_STATUS: 9, MAIL_HISTORY: [{ action: 'accept', at: value }] }, at);
  assert.equal(progress.steps[1].timeText, '', String(value));
  assert.equal(progress.steps[1].done, true, 'the acceptance event still proves the action');
  assert.equal(progress.steps[1].recordText, '时间未记录');
 }
});

test('untimed history events retain consistent milestone evidence for every reader', async () => {
 const f = fixture({ projectFields: true }), id = await f.publish();
 for (const [method, actor] of [['acceptMail','rider'], ['pickupMail','rider'], ['deliverMail','rider'], ['finishMail','poster']]) {
  await f.service[method](actor, id, { requestId: f.req(method), note: 'PRIVATE_UNTIMED_NOTE', images: ['cloud://proof'] });
 }
 const stored = f.table('mail').get(id), event = stored.MAIL_HISTORY.find(item => item.action === 'accept');
 delete stored.MAIL_ACCEPT_TIME;
 for (const value of [undefined, null, '-1', '2026-02-30T10:00:00Z']) {
  event.at = value;
  for (const role of ['poster', 'rider', 'other']) {
   const dto = await controller(f, role, { id }).viewMail(), steps = UI.progress(dto).steps;
   assert.deepEqual(flags(steps), [true,true,true,true,true], role + ' ' + value);
   assert.equal(steps[1].timeText, ''); assert.equal(steps[1].recordText, '时间未记录');
   if (role !== 'poster') assert.equal(dto.MAIL_HISTORY, undefined);
  }
  for (const role of ['poster', 'rider']) {
   const result = await controller(f, role, { sortType: 'my_done' }).getMailList();
   const dto = result.list.find(row => row._id === id), steps = UI.progress(dto).steps;
   assert.deepEqual(flags(steps), [true,true,true,true,true], role + ' list ' + value);
   assert.equal(steps[1].timeText, ''); assert.equal(steps[1].recordText, '时间未记录');
   assert.equal(JSON.stringify(dto).includes('PRIVATE_UNTIMED_NOTE'), false);
  }
 }
 assert.equal(stored.MAIL_ACCEPT_TIME, undefined);
});
