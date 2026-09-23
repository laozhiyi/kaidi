'use strict';
const store = require('./operation_store.js');
const cloudBase = require('../../../framework/cloud/cloud_base.js');
const config = require('../../../config/config.js');

function ownedFiles(value, userId, files = new Set()) {
  if (typeof value === 'string') {
    const match = /^cloud:\/\/([^/\s]+)\/(.+)$/.exec(value);
    const openid = userId.split('^^^').pop(), env = process.env.CLOUD_ENV_ID || config.CLOUD_ID;
    if (!match || !/^[\w-]+$/.test(openid) || !env || match[1] !== env && !match[1].startsWith(env + '.')) return files;
    const path = match[2];
    if (!/^[\w/.-]+$/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) return files;
    if (path.startsWith('private/' + openid + '/') || path.startsWith('private-evidence/' + openid + '/')) files.add(value);
  } else if (value && typeof value === 'object') {
    for (const child of Object.values(value)) ownedFiles(child, userId, files);
  }
  return files;
}

// Journal the file list in the same transaction that erases its source row.
// Legacy shared avatar paths have no trustworthy owner; never delete them by URL.
async function enqueue(tx, claim, name, row) {
  const files = [...ownedFiles(row, claim.userId)];
  if (!files.length) return;
  const id = store.key('crun', 'account-files', claim.cancelId, name, row._id);
  await store.set(tx, 'account_cleanup_file', id, { _pid: 'crun', cancelId: claim.cancelId, files });
}

const currentClaim = (state, claim) => state && state.status === 'deleting' && state.cancelId === claim.cancelId;
function pending(tx, claim, limit = 10) {
  return tx.collection(store.collection('account_cleanup_file')).where({ _pid: 'crun', cancelId: claim.cancelId }).limit(limit).get();
}

async function drain(claim, deadline) {
  const id = store.key('crun', 'account-session', claim.userId);
  while (Date.now() < deadline) {
    const rows = await store.transaction(async tx => {
      if (!currentClaim(await store.get(tx, 'account_session', id), claim)) return null;
      return (await pending(tx, claim)).data;
    });
    if (!rows || !rows.length) return true;
    const files = [...new Set(rows.flatMap(row => row.files))].slice(0, 50);
    const result = await cloudBase.getCloud().deleteFile({ fileList: files });
    // wx-server-sdk maps STORAGE_FILE_NONEXIST to -503003. A previously
    // successful deletion whose response was lost is safe to acknowledge.
    const deleted = new Set((result && result.fileList || [])
      .filter(file => [0, -503003].includes(file.status)).map(file => file.fileID));
    await store.transaction(async tx => {
      const state = await store.get(tx, 'account_session', id);
      if (!currentClaim(state, claim)) return;
      for (const row of rows) {
        const current = await store.get(tx, 'account_cleanup_file', row._id);
        if (!current || current.cancelId !== claim.cancelId) continue;
        const remaining = current.files.filter(file => !deleted.has(file));
        if (remaining.length) await store.set(tx, 'account_cleanup_file', row._id, { ...current, files: remaining });
        else await tx.collection(store.collection('account_cleanup_file')).doc(row._id).remove();
      }
      await store.set(tx, 'account_session', id, { ...state, revision: (state.revision || 0) + 1 });
    });
    if (files.some(file => !deleted.has(file))) return false;
  }
  return false;
}
module.exports = { ownedFiles, enqueue, pending, drain };
