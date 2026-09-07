'use strict';
const cloudBase = require('../../../framework/cloud/cloud_base.js');
const config = require('../../../config/config.js');
const crypto = require('crypto');
const AppError = require('../../../framework/core/app_error.js');
const key = (...parts) => crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0,32);
const collection = name => config.COLLECTION_PRFIX + name;
function database() { return cloudBase.getCloud().database({throwOnNotFound:false}); }
// Never treat network/permission errors as missing records.
async function get(tx, name, id) {
 try { const res = await tx.collection(collection(name)).doc(id).get(); return Array.isArray(res.data) ? (res.data[0] || null) : (res.data || null); }
 catch (e) { if (e.errCode === -1 && /not exist|not found/i.test(e.errMsg || e.message || '') || /DOCUMENT_NOT_FOUND|document does not exist/i.test(e.code || e.message || '')) return null; throw e; }
}
async function set(tx, name, id, row) { const data = { ...row }; delete data._id; await tx.collection(collection(name)).doc(id).set({ data }); }
async function transaction(fn) { return database().runTransaction(fn); }
async function limit(pid, identity, action, max, windowMs) {
 const now = Date.now(), bucket = Math.floor(now / windowMs), id = key(pid, identity, action, bucket);
 await transaction(async tx => { const row = await get(tx, 'operation_limit', id); if (row && row.count >= max) throw new AppError('操作过于频繁，请稍后再试'); await set(tx, 'operation_limit', id, { _pid: pid, count: (row && row.count || 0) + 1, expiresAt: (bucket + 2) * windowMs }); });
}
module.exports = { key, collection, database, get, set, transaction, limit };
