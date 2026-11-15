'use strict';
process.env.CLOUD_ENV_ID = 'purge-env';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('../test-support/operations-fixture.cjs');
const UI = require('../../miniprogram/projects/crun/biz/mail_ui_biz.js');

const DAY = 86400000;
const NOTE = '凭证照片和视频已按规定在订单结束10天后清理';
const file = (name, owner = 'poster') => 'cloud://purge-env.bucket/private-evidence/' + owner + '/' + name + '.jpg';

function purge(f, options = {}) { return f.load('order_media_purge.js').sweep({ batchSize: 50, ...options }); }

// sweep 用 MAIL_EDIT_TIME 预筛到期订单：造数时把结束时间与编辑时间一起回拨。
function backdate(f, id, days) {
 const row = f.table('mail').get(id);
 row.MAIL_END_AT = Date.now() - days * DAY;
 row.MAIL_EDIT_TIME = Date.now() - days * DAY;
 return row;
}

async function completedOrder(f, files = {}, tag = '') {
 const forms = f.forms();
 forms.find(item => item.mark === 'img').val = files.img ? [files.img] : [];
 forms.push({ mark: 'packages', val: [{ type: 'small', price: 1.5, pickupPoint: '菜鸟一期', code: '', note: '', images: files.package ? [files.package] : [] }] });
 const id = await f.publish({ forms, requestId: f.req('publish' + tag) });
 await f.service.acceptMail('rider', id, { requestId: f.req('accept' + tag) });
 await f.service.pickupMail('rider', id, { requestId: f.req('pickup' + tag), images: files.pickup ? [files.pickup] : [] , ...(files.video ? { videos: [files.video] } : {}) });
 await f.service.deliverMail('rider', id, { requestId: f.req('deliver' + tag), note: '已送达', images: files.delivery ? [files.delivery] : [] });
 if (files.exception) f.table('mail').get(id).MAIL_EXCEPTION = { reason: '其他', note: '异常', images: [files.exception], previousStatus: 1, at: Date.now() };
 await f.service.finishMail('poster', id, { requestId: f.req('confirm' + tag) });
 return id;
}

test('ended orders purge media only after ten days and keep the text record', async () => {
 const f = fixture(), files = { pickup: file('pickup'), delivery: file('delivery'), video: file('delivery-video', 'rider'), package: file('package'), img: file('form') };
 const id = await completedOrder(f, files);
 const row = f.table('mail').get(id);
 const summary = { ...row.MAIL_OBJ, title: row.MAIL_OBJ.title };
 backdate(f, id, 9);
 let result = await purge(f);
 assert.equal(result.purged, 0);
 assert.deepEqual(f.deletedFiles, []);
 assert.equal(f.table('mail').get(id).MAIL_MEDIA_PURGED_AT, undefined);
 assert.match(f.table('mail').get(id).MAIL_OBJ.imgUrls[0] || '', /private-evidence/);

 f.table('mail').get(id).MAIL_EXCEPTION = { reason: '其他', note: '异常', images: [file('exception')], previousStatus: 1, at: Date.now() };
 backdate(f, id, 10 + 1 / 86400);
 const notifications = f.table('notification').size;
 // 通过定时维护入口执行，验证 sweep 已接入。
 const worker = new (f.load('maintenance_service.js'))();
 const scheduled = await worker.runScheduled('orders', { batchSize: 50, maxBatches: 1 });
 result = scheduled.mediaPurge;
 assert.equal(result.purged, 1, JSON.stringify(scheduled));
 assert.equal(result.failed, 0);
 const saved = f.table('mail').get(id);
 assert.ok(saved.MAIL_MEDIA_PURGED_AT > 0);
 assert.deepEqual(saved.MAIL_PICKUP_PROOF.images, []);
 assert.equal(saved.MAIL_PICKUP_PROOF.video, '');
 assert.deepEqual(saved.MAIL_DELIVERY_PROOF.images, []);
 assert.equal(saved.MAIL_DELIVERY_PROOF.video, '');
 assert.deepEqual(saved.MAIL_EXCEPTION.images, []);
 assert.deepEqual(saved.MAIL_OBJ.imgUrls, []);
 assert.equal(saved.MAIL_OBJ.imgUrl, '');
 assert.deepEqual(saved.MAIL_OBJ.packages[0].images, []);
 assert.deepEqual(saved.MAIL_FORMS.find(item => item.mark === 'img').val, []);
 assert.equal(saved.MAIL_OBJ.title, summary.title, '文字字段保持原样');
 assert.equal(saved.MAIL_PICKUP_PROOF.note, '');
 assert.equal(saved.MAIL_DELIVERY_PROOF.note, '已送达');
 const event = saved.MAIL_HISTORY[saved.MAIL_HISTORY.length - 1];
 assert.equal(event.action, 'media_purge');
 assert.equal(event.actor, 'system');
 assert.equal(event.note, NOTE);
 assert.equal(f.table('notification').size, notifications, '清理不发通知');
 assert.deepEqual([...new Set(f.deletedFiles)].sort(), [...new Set([files.pickup, files.delivery, files.video, files.package, files.img, file('exception')])].sort());

 // 已清理的订单不会重复处理，也不会再删文件。
 const deleted = f.deletedFiles.length;
 const again = await purge(f);
 assert.equal(again.scanned, 0, '已清理订单不再进入结果集');
 assert.equal(f.table('mail').get(id).MAIL_MEDIA_PURGED, true);
 assert.equal(f.table('mail').get(id).MAIL_MEDIA_PURGED_AT, saved.MAIL_MEDIA_PURGED_AT);
 assert.equal(f.deletedFiles.length, deleted);
});

test('every ending entry records MAIL_END_AT', async () => {
 const ended = async (f, id, run) => {
  await run(id);
  const row = f.table('mail').get(id);
  assert.ok(row.MAIL_END_AT > 0, row.MAIL_STATUS + ' 未写结束时间');
  assert.ok(Math.abs(row.MAIL_END_AT - Date.now()) < 60000);
  return row;
 };
 // 确认收货 9
 {
  const f = fixture(), id = await f.publish();
  await f.service.acceptMail('rider', id, { requestId: f.req('a') });
  await f.service.pickupMail('rider', id, { requestId: f.req('p'), images: ['cloud://x/private-evidence/rider/p.jpg'] });
  await f.service.deliverMail('rider', id, { requestId: f.req('d'), note: '送达', images: ['cloud://x/private-evidence/rider/d.jpg'] });
  await ended(f, id, orderId => f.service.finishMail('poster', orderId, { requestId: f.req('c') }));
 }
 // 取消 99
 {
  const f = fixture(), id = await f.publish();
  await ended(f, id, orderId => f.service.cancelMail('poster', orderId, { requestId: f.req('cancel'), note: '不取了' }));
 }
 // 过期 99
 {
  const f = fixture(), id = await f.publish();
  f.table('mail').get(id).MAIL_END_TIME = Date.now() - 1000;
  await ended(f, id, () => new (f.load('maintenance_service.js'))()._sweep(id, 'expire'));
 }
 // 自动确认 9
 {
  const f = fixture(), id = await f.publish();
  await f.service.acceptMail('rider', id, { requestId: f.req('a') });
  await f.service.pickupMail('rider', id, { requestId: f.req('p'), images: ['cloud://x/private-evidence/rider/p.jpg'] });
  await f.service.deliverMail('rider', id, { requestId: f.req('d'), note: '送达', images: ['cloud://x/private-evidence/rider/d.jpg'] });
  f.table('mail').get(id).MAIL_DELIVERED_TIME = Date.now() - 9 * 3600000;
  await ended(f, id, () => new (f.load('maintenance_service.js'))()._sweep(id, 'auto_confirm'));
 }
 // 管理员 resolve complete / cancel
 for (const [resolution, status] of [['complete', 9], ['cancel', 99]]) {
  const f = fixture(), id = await f.publish();
  await f.service.acceptMail('rider', id, { requestId: f.req('a') });
  await f.service.exceptionMail('rider', id, { requestId: f.req('e'), reason: '其他', note: '异常' });
  const row = await ended(f, id, orderId => f.service.resolveMail('admin', orderId, { requestId: f.req('r'), resolution, note: '处理' }));
  assert.equal(row.MAIL_STATUS, status);
 }
 // 管理员删除
 {
  const f = fixture(), id = await f.publish();
  await f.service.deleteOrder('admin', id, { requestId: f.req('del') });
  assert.ok(f.table('mail').get(id).MAIL_END_AT > 0);
 }
});

test('pending complaints hold the purge and restart the ten-day clock when handled', async () => {
 const f = fixture(), id = await completedOrder(f, { pickup: file('pickup'), delivery: file('delivery') });
 backdate(f, id, 20);
 const feedback = { _id: 'fb-1', _pid: 'crun', FB_ORDER_ID: id, FB_STATUS: 0, FB_ADD_TIME: Date.now() - DAY, FB_REPLY_TIME: 0 };
 f.table('feedback').set(feedback._id, feedback);
 let result = await purge(f);
 assert.equal(result.purged, 0);
 assert.equal(f.table('mail').get(id).MAIL_MEDIA_PURGED_AT, undefined);
 assert.deepEqual(f.deletedFiles, []);
 assert.ok(f.table('mail').get(id).MAIL_MEDIA_PURGE_CHECK_AT > Date.now(), '暂缓时记录下次检查时间');

 // 处理完成后从处理时间重新计算 10 天。
 f.table('feedback').set('fb-1', { ...feedback, FB_STATUS: 1, FB_REPLY_TIME: Date.now() });
 delete f.table('mail').get(id).MAIL_MEDIA_PURGE_CHECK_AT;
 result = await purge(f);
 assert.equal(result.purged, 0);
 assert.equal(f.table('mail').get(id).MAIL_MEDIA_PURGED_AT, undefined);

 f.table('feedback').set('fb-1', { ...feedback, FB_STATUS: 1, FB_REPLY_TIME: Date.now() - 11 * DAY });
 delete f.table('mail').get(id).MAIL_MEDIA_PURGE_CHECK_AT;
 result = await purge(f);
 assert.equal(result.purged, 1);
 assert.ok(f.table('mail').get(id).MAIL_MEDIA_PURGED_AT > 0);
});

test('files referenced by other orders or user profiles are kept but the order reference is cleared', async () => {
 const shared = file('shared');
 const f = fixture(), id = await completedOrder(f, { pickup: shared, delivery: file('own') });
 backdate(f, id, 11);
 // 另一张未清理的订单引用同一个文件（上传人 poster 参与）。
 const forms = f.forms();
 forms.find(item => item.mark === 'img').val = [shared];
 await f.publish({ forms, requestId: f.req('other') });
 const result = await purge(f);
 assert.equal(result.purged, 1);
 assert.ok(!f.deletedFiles.includes(shared), '共享文件不删');
 assert.ok(f.deletedFiles.includes(file('own')), '独占文件正常删除');
 assert.deepEqual(f.table('mail').get(id).MAIL_PICKUP_PROOF.images, []);

 const g = fixture(), profileId = await completedOrder(g, { pickup: shared, delivery: file('pay') });
 backdate(g, profileId, 11);
 g.user('poster', { USER_PIC: shared, USER_PAY_PIC: file('pay') });
 await purge(g);
 assert.ok(!g.deletedFiles.includes(shared), '头像引用不删');
 assert.ok(!g.deletedFiles.includes(file('pay')), '收款码引用不删');
 // account_media 的登记只用于确认文件归属，不单独阻止删除。
 const h = fixture(), recordedId = await completedOrder(h, { pickup: shared, delivery: file('recorded') });
 backdate(h, recordedId, 11);
 h.table('account_media').set('am-1', { _id: 'am-1', _pid: 'crun', userId: 'poster', fileID: shared });
 await purge(h);
 assert.ok(h.deletedFiles.includes(shared), '仅登记过的文件仍可删除');
});

test('storage failures keep the order uncleaned, retry, then stop at the attempt limit', async () => {
 const f = fixture(), id = await completedOrder(f, { pickup: file('pickup'), delivery: file('delivery') });
 backdate(f, id, 11);
 f.failDeleteFile(file('pickup'));
 f.failDeleteFile(file('delivery'));
 let result = await purge(f);
 assert.equal(result.failed, 1);
 let row = f.table('mail').get(id);
 assert.equal(row.MAIL_MEDIA_PURGED_AT, undefined);
 assert.equal(row.MAIL_MEDIA_PURGE_ATTEMPTS, 1);
 assert.ok(row.MAIL_PICKUP_PROOF.images.length, '失败时字段必须保留');

 await purge(f);
 await purge(f);
 row = f.table('mail').get(id);
 assert.equal(row.MAIL_MEDIA_PURGE_ATTEMPTS, 3);
 assert.equal(row.MAIL_MEDIA_PURGE_STOPPED, true);
 assert.equal(row.MAIL_MEDIA_PURGED_AT, undefined);

 // 达到上限后不再自动重试；后续 sweep 不会再选中该订单。
 result = await purge(f);
 assert.equal(result.scanned, 0);
 assert.equal(f.table('mail').get(id).MAIL_MEDIA_PURGED_AT, undefined);
});

test('legacy ended orders fall back to MAIL_OVER_TIME then MAIL_EDIT_TIME', async () => {
 const f = fixture(), id = await completedOrder(f, { pickup: file('pickup'), delivery: file('delivery') });
 const row = f.table('mail').get(id);
 delete row.MAIL_END_AT;
 row.MAIL_OVER_TIME = Date.now() - 9 * DAY;
 row.MAIL_EDIT_TIME = Date.now() - 9 * DAY;
 assert.equal((await purge(f)).purged, 0);
 row.MAIL_OVER_TIME = Date.now() - 11 * DAY;
 row.MAIL_EDIT_TIME = Date.now() - 11 * DAY;
 assert.equal((await purge(f)).purged, 1);

 const g = fixture(), id2 = await completedOrder(g, { pickup: file('pickup'), delivery: file('delivery') });
 const legacy = g.table('mail').get(id2);
 delete legacy.MAIL_END_AT;
 delete legacy.MAIL_OVER_TIME;
 legacy.MAIL_EDIT_TIME = Date.now() - 11 * DAY;
 assert.equal((await purge(g)).purged, 1);
});

test('media_purge can also run as its own maintenance kind', async () => {
 const f = fixture(), id = await completedOrder(f, { pickup: file('pickup'), delivery: file('delivery') });
 backdate(f, id, 11);
 const result = await new (f.load('maintenance_service.js'))().runScheduled('media_purge', { batchSize: 10 });
 assert.equal(result.kind, 'media_purge');
 assert.equal(result.mediaPurge.purged, 1);
 assert.ok(f.table('mail').get(id).MAIL_MEDIA_PURGED_AT > 0);
});

test('in-flight orders never purge even with an old edit time', async () => {
 for (const status of [0, 1, 2, 3, 4]) {
  const f = fixture(), id = await f.publish();
  const row = f.table('mail').get(id);
  row.MAIL_STATUS = status;
  row.MAIL_EDIT_TIME = Date.now() - 40 * DAY;
  row.MAIL_OVER_TIME = Date.now() - 40 * DAY;
  const result = await purge(f);
  assert.equal(result.purged, 0, 'status ' + status);
  assert.equal(f.table('mail').get(id).MAIL_MEDIA_PURGED_AT, undefined);
 }
});

test('a due order is still reached behind many purged and deferred orders', async () => {
 const f = fixture(), old = Date.now() - 20 * DAY;
 // 60 单已清理：旧实现按 MAIL_MEDIA_PURGED_AT != true 查询，会一直被查出来占满一批。
 for (let i = 0; i < 60; i++) {
  const id = 'purged-' + i;
  f.table('mail').set(id, { _id: id, _pid: 'crun', MAIL_STATUS: 9, MAIL_MEDIA_PURGED: true, MAIL_MEDIA_PURGED_AT: old,
   MAIL_END_AT: old, MAIL_EDIT_TIME: old - DAY, MAIL_OBJ: {} });
 }
 // 60 单投诉暂缓：到期但还没有下次检查时间，第一次 sweep 会把它们逐个记录下来。
 for (let i = 0; i < 60; i++) {
  const id = 'held-' + i;
  f.table('mail').set(id, { _id: id, _pid: 'crun', MAIL_STATUS: 9, MAIL_END_AT: old, MAIL_EDIT_TIME: old, MAIL_OBJ: {} });
  f.table('feedback').set('fb-' + i, { _id: 'fb-' + i, _pid: 'crun', FB_ORDER_ID: id, FB_STATUS: 0, FB_ADD_TIME: old, FB_REPLY_TIME: 0 });
 }
 const id = await completedOrder(f, { pickup: file('pickup'), delivery: file('delivery') });
 backdate(f, id, 11);

 let result, rounds = 0;
 do {
  result = await purge(f);
  rounds++;
 } while (f.table('mail').get(id).MAIL_MEDIA_PURGED !== true && rounds < 5);
 assert.equal(f.table('mail').get(id).MAIL_MEDIA_PURGED, true, '第 ' + rounds + ' 次 sweep 后仍未清理：' + JSON.stringify(result));
 assert.equal(f.deletedFiles.length, 2);
 assert.equal(f.table('mail').get('purged-0').MAIL_MEDIA_PURGED_AT, old, '已清理订单不被重写');
 assert.ok(rounds <= 3, '应在几轮内完成，实际 ' + rounds);
});

test('the sweep only selects orders idle for more than ten days', async () => {
 const f = fixture(), id = await completedOrder(f, { pickup: file('pickup'), delivery: file('delivery') });
 // 刚结束，编辑时间也是现在：查询不返回。
 assert.equal((await purge(f)).scanned, 0);
 // 结束时间很久但最近有操作：仍不返回，避免误删新凭证。
 f.table('mail').get(id).MAIL_END_AT = Date.now() - 30 * DAY;
 assert.equal((await purge(f)).scanned, 0);
 // 空闲够久但结束未满 10 天：查询返回，精确判断跳过。
 f.table('mail').get(id).MAIL_EDIT_TIME = Date.now() - 30 * DAY;
 f.table('mail').get(id).MAIL_END_AT = Date.now() - 5 * DAY;
 const result = await purge(f);
 assert.equal(result.scanned, 1);
 assert.equal(result.purged, 0);
 assert.deepEqual(f.deletedFiles, []);
});

test('deferred orders record a next check time and are not queried again within a day', async () => {
 const f = fixture(), id = await completedOrder(f, { pickup: file('pickup'), delivery: file('delivery') });
 backdate(f, id, 11);
 const feedback = { _id: 'fb-hold', _pid: 'crun', FB_ORDER_ID: id, FB_STATUS: 0, FB_ADD_TIME: Date.now() - 12 * DAY, FB_REPLY_TIME: 0 };
 f.table('feedback').set(feedback._id, feedback);
 const before = Date.now();
 let result = await purge(f);
 assert.equal(result.scanned, 1);
 assert.equal(result.purged, 0);
 const row = f.table('mail').get(id);
 assert.ok(row.MAIL_MEDIA_PURGE_CHECK_AT >= before + DAY && row.MAIL_MEDIA_PURGE_CHECK_AT <= Date.now() + DAY, String(row.MAIL_MEDIA_PURGE_CHECK_AT));
 assert.equal(row.MAIL_STATUS, 9, '不改变订单状态');
 assert.equal(row.MAIL_MEDIA_PURGED, undefined);
 assert.ok(row.MAIL_EDIT_TIME < before, '不刷新编辑时间');
 assert.deepEqual(f.deletedFiles, []);
 result = await purge(f);
 assert.equal(result.scanned, 0, '1 天内不再被查到');

 // 投诉处理完但未满 10 天：同样写入下次检查时间，不立即清理。
 f.table('feedback').set('fb-hold', { ...feedback, FB_STATUS: 1, FB_REPLY_TIME: Date.now() });
 f.table('mail').get(id).MAIL_MEDIA_PURGE_CHECK_AT = Date.now() - 1000;
 result = await purge(f);
 assert.equal(result.purged, 0);
 assert.ok(f.table('mail').get(id).MAIL_MEDIA_PURGE_CHECK_AT > Date.now() + DAY - 5000);
});

test('orders maintenance purges at most once an hour while media_purge has no interval', async () => {
 const f = fixture(), worker = new (f.load('maintenance_service.js'))();
 const first = await completedOrder(f, { pickup: file('pickup'), delivery: file('delivery') });
 backdate(f, first, 11);
 let result = await worker.runScheduled('orders', { batchSize: 10, maxBatches: 1 });
 assert.equal(result.mediaPurge.ran, true);
 assert.equal(result.mediaPurge.purged, 1);

 const second = await completedOrder(f, { pickup: file('pickup'), delivery: file('delivery') }, 'b');
 backdate(f, second, 11);
 result = await worker.runScheduled('orders', { batchSize: 10, maxBatches: 1 });
 assert.equal(result.mediaPurge.ran, false);
 assert.equal(result.mediaPurge.reason, 'interval');
 assert.equal(f.table('mail').get(second).MAIL_MEDIA_PURGED, undefined, '一小时内不重复清理');

 // 单独调用 media_purge 不受间隔限制。
 result = await worker.runScheduled('media_purge', { batchSize: 10 });
 assert.equal(result.mediaPurge.ran, true);
 assert.equal(result.mediaPurge.purged, 1);
 assert.equal(f.table('mail').get(second).MAIL_MEDIA_PURGED, true);

 // 间隔过去后，orders 维护会再次执行清理。
 const third = await completedOrder(f, { pickup: file('pickup'), delivery: file('delivery') }, 'c');
 backdate(f, third, 11);
 f.table('worker_state').get(f.store.key('scheduled', 'orders', 'all')).mediaPurgeAt = Date.now() - 3600001;
 result = await worker.runScheduled('orders', { batchSize: 10, maxBatches: 1 });
 assert.equal(result.mediaPurge.ran, true);
 assert.equal(result.mediaPurge.purged, 1);
});

test('orders deleted by admins purge ten days after deletion', async () => {
 const f = fixture(), id = await f.publish();
 await f.service.deleteOrder('admin', id, { requestId: f.req('del') });
 const row = f.table('mail').get(id);
 assert.equal(row.MAIL_ADMIN_DELETED, true);
 assert.equal(row.MAIL_STATUS, 0, '删除不改状态');
 assert.ok(row.MAIL_END_AT > 0);
 backdate(f, id, 9);
 assert.equal((await purge(f)).purged, 0, '未满 10 天不清理');
 assert.equal(f.table('mail').get(id).MAIL_MEDIA_PURGED, undefined);
 backdate(f, id, 10 + 1 / 86400);
 assert.equal((await purge(f)).purged, 1);
 assert.equal(f.table('mail').get(id).MAIL_MEDIA_PURGED, true);

 // 已结束的订单被管理员删除同样按结束时间计算。
 const g = fixture(), ended = await completedOrder(g, { pickup: file('pickup'), delivery: file('delivery') });
 await g.service.deleteOrder('admin', ended, { requestId: g.req('del2') });
 backdate(g, ended, 11);
 assert.equal((await purge(g)).purged, 1);
 assert.equal(g.table('mail').get(ended).MAIL_MEDIA_PURGED, true);
});

test('credential copies in order_event are cleared while the event text stays', async () => {
 const f = fixture(), id = await completedOrder(f, { pickup: file('pickup'), delivery: file('delivery') });
 const before = [...f.table('order_event').values()].filter(row => row.orderId === id);
 const withProof = before.find(row => row.proof && Array.isArray(row.proof.images) && row.proof.images.length);
 assert.ok(withProof, '订单事件里应保存凭证副本');
 const note = withProof.proof.note, action = withProof.action, at = withProof.at;
 backdate(f, id, 11);
 assert.equal((await purge(f)).purged, 1);
 const after = [...f.table('order_event').values()].filter(row => row.orderId === id);
 assert.equal(after.length, before.length);
 const cleared = after.find(row => row._id === withProof._id);
 assert.deepEqual(cleared.proof.images, []);
 assert.equal(cleared.proof.video, '');
 assert.equal(cleared.proof.note, note, '文字保留');
 assert.equal(cleared.action, action);
 assert.equal(cleared.at, at);
});

test('history labels name the media purge action', () => {
 const mail = { _id: 'order', MAIL_STATUS: 9, mypost: true, MAIL_OBJ: {}, MAIL_HISTORY: [{ action: 'media_purge', note: NOTE, at: Date.now(), actor: 'system' }] };
 assert.equal(UI.detail(mail).history[0].title, '凭证照片和视频已清理');
 const Admin = require('../../miniprogram/projects/crun/biz/admin_console_biz.js');
 const row = Admin.order({ _id: 'order', MAIL_STATUS: 9, MAIL_OBJ: {}, MAIL_HISTORY: [{ action: 'media_purge', at: Date.now(), actor: 'system' }] });
 assert.equal(row.history[0].label, '清理凭证');
});

test('order pages show the purge notice for finished orders', () => {
 const base = { _id: 'order', MAIL_STATUS: 9, MAIL_OBJ: { title: '快递代取' } };
 assert.deepEqual(UI.mediaPurgeNotice({ ...base, MAIL_MEDIA_PURGED_AT: Date.parse('2026-11-05T12:00:00+08:00') }),
  { purged: true, text: '凭证照片和视频已于 2026-11-05 清理' });
 assert.deepEqual(UI.mediaPurgeNotice(base), { purged: false, text: '订单结束 10 天后将自动清理凭证照片和视频' });
 assert.deepEqual(UI.mediaPurgeNotice({ ...base, MAIL_STATUS: 99 }), { purged: false, text: '订单结束 10 天后将自动清理凭证照片和视频' });
 assert.deepEqual(UI.mediaPurgeNotice({ ...base, MAIL_STATUS: 1 }), { purged: false, text: '' });
 assert.equal(UI.detail({ ...base, MAIL_MEDIA_PURGED_AT: Date.parse('2026-11-05T12:00:00+08:00') }).mediaPurge.text, '凭证照片和视频已于 2026-11-05 清理');
});
