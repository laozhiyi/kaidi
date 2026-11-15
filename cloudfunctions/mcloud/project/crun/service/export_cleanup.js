'use strict';
// 导出文件自动清理：生成满 2 天后删除云存储里的 xlsx，导出记录保留删除状态。
// 下载链接由 export_util 按 1 天有效期单独签发，和这里互不影响。
const store = require('./operation_store.js');
const cloudBase = require('../../../framework/cloud/cloud_base.js');

const PID = 'crun';
const KEEP_MS = 2 * 86400000;
// 与其它清理任务一致：失败累计到上限后停止自动重试，等待人工核对。
const MAX_ATTEMPTS = 3;

function recordId(fileID) {
	return store.key('export_file', fileID);
}

/** 导出成功后登记文件；同一 fileID 只留一条记录。 */
async function record(fileID, adminId, now = Date.now()) {
	if (typeof fileID !== 'string' || !fileID) return null;
	const id = recordId(fileID);
	await store.set(store.database(), 'export_file', id, {
		_pid: PID, fileID, adminId: String(adminId || ''), createdAt: now,
		deleted: false, attempts: 0, error: ''
	});
	return id;
}

async function markDeleted(id, now) {
	await store.transaction(async tx => {
		const row = await store.get(tx, 'export_file', id);
		if (!row || row.deleted === true) return;
		await store.set(tx, 'export_file', id, { ...row, deleted: true, deletedAt: now, attempts: 0, error: '' });
	});
}

async function recordFailure(id, error) {
	const stopped = await store.transaction(async tx => {
		const row = await store.get(tx, 'export_file', id);
		if (!row || row.deleted === true) return false;
		const attempts = Number(row.attempts || 0) + 1;
		const next = { ...row, attempts, error: String(error || '').slice(0, 200) };
		if (attempts >= MAX_ATTEMPTS) next.stopped = true;
		await store.set(tx, 'export_file', id, next);
		return attempts >= MAX_ATTEMPTS;
	});
	// 只记录记录 id 与错误码，不输出文件名或导出人信息。
	if (stopped) console.error('[export_cleanup] retry limit reached', { id, code: String(error || 'DELETE_FAILED').slice(0, 100) });
}

async function removeOne(row, now) {
	try {
		const result = await cloudBase.getCloud().deleteFile({ fileList: [row.fileID] });
		// 与账号注销一致：0 成功，-503003 表示文件已不存在，都可确认。
		const file = ((result && result.fileList) || [])[0];
		if (!file || ![0, -503003].includes(Number(file.status))) {
			throw Object.assign(new Error('DELETE_FAILED'), { errCode: file && file.status });
		}
		await markDeleted(row._id, now);
		return 'deleted';
	} catch (error) {
		await recordFailure(row._id, error);
		return 'failed';
	}
}

// 每批数量、并发与时间预算沿用 maintenance sweep 的做法。
async function sweep(options = {}) {
	const db = store.database(), cmd = db.command, startedAt = Date.now();
	const batchSize = Math.max(1, Math.min(100, Number(options.batchSize) || 50));
	const budget = Math.max(1000, Math.min(8000, Number(options.budgetMs) || 8000));
	const deadline = startedAt + budget;
	const rows = (await db.collection(store.collection('export_file')).where({
		_pid: PID, deleted: cmd.neq(true), stopped: cmd.neq(true), createdAt: cmd.lte(startedAt - KEEP_MS)
	}).orderBy('createdAt', 'asc').limit(batchSize).get()).data || [];
	const result = { scanned: rows.length, deleted: 0, failed: 0, hasMore: rows.length === batchSize, durationMs: 0 };
	let next = 0;
	await Promise.all(Array.from({ length: Math.min(4, rows.length) }, async () => {
		while (next < rows.length && Date.now() < deadline) {
			const row = rows[next++];
			try {
				if (await removeOne(row, Date.now()) === 'deleted') result.deleted++;
				else result.failed++;
			} catch (error) {
				result.failed++;
				console.error('[export_cleanup] item failed', { id: row._id, code: error && (error.code || error.errCode) || 'PROCESS_FAILED' });
			}
		}
	}));
	result.durationMs = Date.now() - startedAt;
	return result;
}

module.exports = { KEEP_MS, MAX_ATTEMPTS, record, sweep };
