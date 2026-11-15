'use strict';
// 订单结束后第 10 天清理凭证媒体文件：只删云存储文件与媒体字段，订单文字记录保留。
const store = require('./operation_store.js');
const cloudBase = require('../../../framework/cloud/cloud_base.js');
const cleanupFiles = require('./account_cleanup_files.js');

const PURGE_AFTER_MS = 10 * 86400000;
// 投诉暂缓或处理完未满 10 天时，只记录下次检查时间，避免每次 sweep 重复查同一单。
const CHECK_INTERVAL_MS = 86400000;
// 与通知发送的重试计数一致：失败累计到上限后停止自动重试，等待人工核对。
const MAX_ATTEMPTS = 3;
const DELETE_BATCH = 50;
const PURGE_NOTE = '凭证照片和视频已按规定在订单结束10天后清理';

// 结束时间：新订单统一写 MAIL_END_AT；老订单按 MAIL_OVER_TIME → MAIL_EDIT_TIME 兜底。
function endedAt(mail) {
 const at = Number(mail.MAIL_END_AT) || Number(mail.MAIL_OVER_TIME) || Number(mail.MAIL_EDIT_TIME) || 0;
 return Number.isFinite(at) && at > 0 ? at : 0;
}

function addFile(files, value) {
 if (typeof value === 'string' && value.startsWith('cloud://') && value.length <= 500) files.add(value);
}
function addFiles(files, value) {
 if (Array.isArray(value)) value.forEach(item => addFile(files, item));
}

// 订单里保存媒体 fileID 的全部位置（新老结构）。
function mediaFiles(mail) {
 const files = new Set(), obj = mail.MAIL_OBJ || {};
 const pickup = mail.MAIL_PICKUP_PROOF || {}, delivery = mail.MAIL_DELIVERY_PROOF || {}, exception = mail.MAIL_EXCEPTION || {};
 addFiles(files, pickup.images); addFile(files, pickup.video);
 addFiles(files, delivery.images); addFile(files, delivery.video);
 addFiles(files, exception.images);
 addFiles(files, obj.imgUrls); addFile(files, obj.imgUrl);
 if (Array.isArray(obj.packages)) obj.packages.forEach(item => item && addFiles(files, item.images));
 if (Array.isArray(mail.MAIL_FORMS)) mail.MAIL_FORMS.forEach(item => item && item.mark === 'img' && addFiles(files, item.val));
 // 只处理服务端归档的私有凭证；其他路径（历史共享头像等）一律不动。
 const out = new Set();
 for (const file of files) {
  const match = /^cloud:\/\/[^/\s]+\/private-evidence\/([\w-]+)\//.exec(file);
  if (!match) continue;
  for (const owned of cleanupFiles.ownedFiles(file, match[1])) out.add(owned);
 }
 return [...out];
}

// 结构保持不变：数组置空、字符串置空。
function clearMedia(mail) {
 if (mail.MAIL_PICKUP_PROOF && typeof mail.MAIL_PICKUP_PROOF === 'object') mail.MAIL_PICKUP_PROOF = { ...mail.MAIL_PICKUP_PROOF, images: [], video: '' };
 if (mail.MAIL_DELIVERY_PROOF && typeof mail.MAIL_DELIVERY_PROOF === 'object') mail.MAIL_DELIVERY_PROOF = { ...mail.MAIL_DELIVERY_PROOF, images: [], video: '' };
 if (mail.MAIL_EXCEPTION && typeof mail.MAIL_EXCEPTION === 'object') mail.MAIL_EXCEPTION = { ...mail.MAIL_EXCEPTION, images: [] };
 const obj = mail.MAIL_OBJ || {};
 const packages = Array.isArray(obj.packages) ? obj.packages.map(item => item && typeof item === 'object' ? { ...item, images: [] } : item) : obj.packages;
 mail.MAIL_OBJ = { ...obj, imgUrls: [], imgUrl: '', ...(packages === undefined ? {} : { packages }) };
 if (Array.isArray(mail.MAIL_FORMS)) mail.MAIL_FORMS = mail.MAIL_FORMS.map(item => item && item.mark === 'img' ? { ...item, val: [] } : item);
}

// 未处理完的投诉暂缓清理；处理完成后从最后一次处理时间重新计算 10 天。
async function feedbackHold(db, orderId) {
 const rows = (await db.collection(store.collection('feedback')).where({ _pid: 'crun', FB_ORDER_ID: orderId }).limit(50).get()).data || [];
 if (rows.some(row => Number(row.FB_STATUS) === 0)) return { pending: true, lastAt: 0 };
 const lastAt = rows.reduce((max, row) => Math.max(max, Number(row.FB_REPLY_TIME) || 0), 0);
 return { pending: false, lastAt };
}

// 共享文件保护：同一 fileID 可能被其他订单或用户资料引用。
async function referencedElsewhere(db, mail, files) {
 const shared = new Set(), targets = new Set(files);
 if (!files.length) return shared;
 const cmd = db.command, owners = new Set();
 for (const file of files) {
  const match = /^cloud:\/\/[^/\s]+\/private-evidence\/([\w-]+)\//.exec(file);
  if (match) owners.add(match[1]);
 }
 // account_media 是上传时登记的引用记录：据此补齐文件归属人。
 const recorded = await db.collection(store.collection('account_media')).where({ _pid: 'crun', fileID: cmd.in(files) }).limit(100).get();
 for (const row of recorded.data || []) if (row && row.userId) owners.add(String(row.userId).split('^^^').pop());
 const ownersList = [...owners];
 if (!ownersList.length) return shared;
 // 其他尚未清理的订单：文件只会出现在上传人参与的订单里。
 const mails = await db.collection(store.collection('mail')).where(cmd.and([
  { _pid: 'crun', _id: cmd.neq(mail._id), MAIL_MEDIA_PURGED: cmd.neq(true) },
  cmd.or(ownersList.flatMap(owner => [{ MAIL_USER_ID: owner }, { MAIL_ACCEPT_USER_ID: owner }]))
 ])).limit(100).get();
 for (const row of mails.data || []) for (const file of mediaFiles(row)) if (targets.has(file)) shared.add(file);
 // 用户资料：头像、学生证、收款码。
 const users = await db.collection(store.collection('user')).where(cmd.and([
  { _pid: 'crun' }, cmd.or(ownersList.map(owner => ({ USER_MINI_OPENID: owner })))
 ])).limit(20).get();
 for (const user of users.data || []) {
  if (targets.has(user.USER_PIC)) shared.add(user.USER_PIC);
  if (targets.has(user.USER_PAY_PIC)) shared.add(user.USER_PAY_PIC);
  for (const item of Array.isArray(user.USER_FORMS) ? user.USER_FORMS : []) {
   if (!item || !['studentCard', 'payPic'].includes(item.mark)) continue;
   for (const file of Array.isArray(item.val) ? item.val : [item.val]) if (targets.has(file)) shared.add(file);
  }
 }
 return shared;
}

async function deleteFiles(files) {
 const deleted = new Set(), failed = [];
 let error = '';
 for (let start = 0; start < files.length; start += DELETE_BATCH) {
  const chunk = files.slice(start, start + DELETE_BATCH);
  try {
   const result = await cloudBase.getCloud().deleteFile({ fileList: chunk });
   // 与账号注销一致：0 成功，-503003 表示文件已不存在，都可确认。
   const done = new Set(((result && result.fileList) || []).filter(row => [0, -503003].includes(row.status)).map(row => row.fileID));
   for (const file of chunk) { if (done.has(file)) deleted.add(file); else failed.push(file); }
  } catch (e) {
   error = String(e && (e.errCode || e.code || e.message) || 'DELETE_FAILED');
   failed.push(...chunk);
  }
 }
 return { deleted, failed, error };
}

async function recordFailure(id, error) {
 const stopped = await store.transaction(async tx => {
  const row = await store.get(tx, 'mail', id);
  if (!row || row.MAIL_MEDIA_PURGED === true) return false;
  const attempts = Number(row.MAIL_MEDIA_PURGE_ATTEMPTS || 0) + 1;
  const next = { ...row, MAIL_MEDIA_PURGE_ATTEMPTS: attempts, MAIL_MEDIA_PURGE_ERROR: String(error || '').slice(0, 200) };
  if (attempts >= MAX_ATTEMPTS) next.MAIL_MEDIA_PURGE_STOPPED = true;
  await store.set(tx, 'mail', id, next);
  return attempts >= MAX_ATTEMPTS;
 });
 // 只记录订单标识与错误码，不输出文件名或任何用户信息。
 if (stopped) console.error('[media_purge] retry limit reached', { id, code: String(error || 'DELETE_FAILED').slice(0, 100) });
}

// 投诉暂缓：只写下次检查时间，不改订单状态、媒体字段与其他业务字段。
async function deferCheck(id, now) {
 await store.transaction(async tx => {
  const row = await store.get(tx, 'mail', id);
  if (!row || row.MAIL_MEDIA_PURGED === true) return;
  await store.set(tx, 'mail', id, { ...row, MAIL_MEDIA_PURGE_CHECK_AT: now + CHECK_INTERVAL_MS });
 });
}

// 事件里的凭证副本同步清空，事件文字（action/at/actor/note）保持原样。
async function clearEventMedia(db, orderId) {
 const rows = (await db.collection(store.collection('order_event')).where({ _pid: 'crun', orderId }).limit(100).get()).data || [];
 for (const row of rows) {
  const proof = row.proof && typeof row.proof === 'object' ? { ...row.proof, images: [], video: '' } : row.proof;
  const exception = row.exception && typeof row.exception === 'object' ? { ...row.exception, images: [] } : row.exception;
  const staleProof = row.proof && typeof row.proof === 'object' && ((Array.isArray(row.proof.images) && row.proof.images.length) || row.proof.video);
  const staleException = row.exception && typeof row.exception === 'object' && Array.isArray(row.exception.images) && row.exception.images.length;
  if (!staleProof && !staleException) continue;
  await store.set(db, 'order_event', row._id, { ...row, proof, exception });
 }
}

async function finalize(id, now) {
 return store.transaction(async tx => {
  const row = await store.get(tx, 'mail', id);
  if (!row || row.MAIL_MEDIA_PURGED === true) return false;
  // 结束（9/99）或被管理员删除的订单才清理；进行中的订单永不清理。
  if (row.MAIL_ADMIN_DELETED !== true && ![9, 99].includes(Number(row.MAIL_STATUS))) return false;
  clearMedia(row);
  row.MAIL_MEDIA_PURGED = true;
  row.MAIL_MEDIA_PURGED_AT = now;
  row.MAIL_MEDIA_PURGE_ATTEMPTS = 0;
  row.MAIL_MEDIA_PURGE_ERROR = '';
  delete row.MAIL_MEDIA_PURGE_STOPPED;
  row.MAIL_VERSION = Number(row.MAIL_VERSION || 0) + 1;
  row.MAIL_EDIT_TIME = now;
  // 只写订单历史，不发通知，也不改订单状态。
  const event = { id: store.key(row._id, row.MAIL_VERSION), action: 'media_purge', status: row.MAIL_STATUS, at: now, actor: 'system', note: PURGE_NOTE };
  row.MAIL_HISTORY = [...(Array.isArray(row.MAIL_HISTORY) ? row.MAIL_HISTORY : []), event].slice(-100);
  await store.set(tx, 'mail', id, row);
  return true;
 });
}

async function purgeOrder(id, now = Date.now()) {
 const db = store.database(), mail = await store.get(db, 'mail', id);
 if (!mail || mail._pid !== 'crun' || mail.MAIL_MEDIA_PURGED === true) return 'skipped';
 // 结束（9/99）或被管理员删除的订单才清理；进行中的订单永不清理。
 if (mail.MAIL_ADMIN_DELETED !== true && ![9, 99].includes(Number(mail.MAIL_STATUS))) return 'skipped';
 if (Number(mail.MAIL_MEDIA_PURGE_ATTEMPTS || 0) >= MAX_ATTEMPTS) return 'skipped';
 const endAt = endedAt(mail);
 if (!endAt || endAt + PURGE_AFTER_MS > now) return 'skipped';
 const hold = await feedbackHold(db, id);
 if (hold.pending || hold.lastAt && hold.lastAt + PURGE_AFTER_MS > now) {
  await deferCheck(id, now);
  return 'skipped';
 }
 const files = mediaFiles(mail);
 if (files.length) {
  const shared = await referencedElsewhere(db, mail, files);
  const deletable = files.filter(file => !shared.has(file));
  if (deletable.length) {
   const outcome = await deleteFiles(deletable);
   if (outcome.failed.length) { await recordFailure(id, outcome.error); return 'failed'; }
  }
 }
 if (!await finalize(id, now)) return 'skipped';
 // 事件里的副本清理失败不影响订单已清理的结果，只记错误日志。
 try { await clearEventMedia(db, id); }
 catch (error) { console.error('[media_purge] event cleanup failed', { id, code: error && (error.code || error.errCode) || 'EVENT_CLEANUP_FAILED' }); }
 return 'purged';
}

// 每批数量、并发与时间预算沿用 maintenance sweep 的做法。
async function sweep(options = {}) {
 const db = store.database(), cmd = db.command, startedAt = Date.now(), now = startedAt;
 const batchSize = Math.max(1, Math.min(100, Number(options.batchSize) || 50));
 const budget = Math.max(1000, Math.min(8000, Number(options.budgetMs) || 8000));
 const deadline = startedAt + budget;
 // MAIL_EDIT_TIME 不早于结束时间：用它先筛掉未到期的订单，只会晚删不会早删，老订单也覆盖。
 // 已清理（布尔位）与 1 天内刚检查过的订单不再进入结果集，避免占满一批导致后面的订单轮不到。
 const filters = [
  cmd.or([{ MAIL_STATUS: cmd.in([9, 99]) }, { MAIL_ADMIN_DELETED: true }]),
  { _pid: 'crun', MAIL_MEDIA_PURGED: cmd.neq(true), MAIL_MEDIA_PURGE_STOPPED: cmd.neq(true), MAIL_EDIT_TIME: cmd.lte(now - PURGE_AFTER_MS) },
  cmd.or([{ MAIL_MEDIA_PURGE_CHECK_AT: cmd.exists(false) }, { MAIL_MEDIA_PURGE_CHECK_AT: cmd.lte(now) }])
 ];
 if (options.shard !== undefined) filters.push({ workerShard: options.shard });
 const rows = (await db.collection(store.collection('mail')).where(cmd.and(filters)).orderBy('MAIL_EDIT_TIME', 'asc').limit(batchSize).get()).data || [];
 const result = { scanned: rows.length, purged: 0, failed: 0, skipped: 0, hasMore: rows.length === batchSize, durationMs: 0 };
 let next = 0;
 await Promise.all(Array.from({ length: Math.min(4, rows.length) }, async () => {
  while (next < rows.length && Date.now() < deadline) {
   const row = rows[next++];
   try {
    const state = await purgeOrder(row._id, Date.now());
    if (state === 'purged') result.purged++;
    else if (state === 'failed') result.failed++;
    else result.skipped++;
   } catch (error) {
    result.failed++;
    console.error('[media_purge] item failed', { id: row._id, code: error && (error.code || error.errCode) || 'PROCESS_FAILED' });
   }
  }
 }));
 result.durationMs = Date.now() - startedAt;
 return result;
}

module.exports = { PURGE_AFTER_MS, MAX_ATTEMPTS, PURGE_NOTE, endedAt, mediaFiles, clearMedia, purgeOrder, sweep };
