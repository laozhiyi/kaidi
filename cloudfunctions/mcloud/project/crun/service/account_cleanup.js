'use strict';
const store = require('./operation_store.js');
const files = require('./account_cleanup_files.js');

// Keep shared completed records useful to the other party, while detaching
// the closed account. A new login with the same OpenID cannot reclaim them.
const DELETE = [
  ['user', ['USER_MINI_OPENID']], ['identity_unique', ['userId']], ['fav', ['FAV_USER_ID']],
  ['notification', ['userId']], ['subscription', ['userId']], ['news_read', ['userId']],
  ['news_unread', ['userId']], ['order_quota', ['userId']], ['campus_service_message', ['CSM_USER_ID']], ['account_media', ['userId']]
];
const ANONYMIZE = [
  ['mail', ['MAIL_USER_ID', 'MAIL_ACCEPT_USER_ID']], ['order_event', ['actorId']],
  ['feedback', ['FB_USER_ID', 'FB_TARGET_USER_ID']], ['order_review', ['REVIEW_FROM_USER_ID', 'REVIEW_TO_USER_ID']],
  ['invite', ['INV_USER_ID', 'INV_ACCEPT_USER_ID']]
];
function anonymize(name, row, userId, replacement) {
  const next = { ...row };
  const own = key => row[key] === userId;
  for (const [, fields] of ANONYMIZE.filter(([collection]) => collection === name)) {
    for (const field of fields) if (own(field)) next[field] = replacement;
  }
  if (name === 'mail') {
    if (own('MAIL_USER_ID')) {
      next.MAIL_USER_NAME = '已注销用户';
      const privateMarks = new Set(['poster', 'tel', 'tel2', 'address2', 'code', 'desc', 'img', 'imgUrl', 'imgUrls', 'packages']);
      next.MAIL_OBJ = Object.fromEntries(Object.entries(row.MAIL_OBJ || {}).filter(([field]) => !privateMarks.has(field)));
      next.MAIL_FORMS = (row.MAIL_FORMS || []).filter(field => !privateMarks.has(field.mark));
    }
    if (own('MAIL_ACCEPT_USER_ID')) { next.MAIL_ACCEPT_USER_NAME = '已注销用户'; next.MAIL_ACCEPT_PAY_PIC = ''; }
    next.MAIL_HISTORY = (row.MAIL_HISTORY || []).map(event => ({ ...event, note: '' }));
    next.MAIL_EXCEPTION = null; next.MAIL_DELIVERY_PROOF = null;
    next.MAIL_ADD_IP = ''; next.MAIL_EDIT_IP = '';
  }
  if (name === 'order_event') { next.note = ''; next.proof = null; next.exception = null; }
  if (name === 'feedback') {
    if (own('FB_USER_ID')) Object.assign(next, { FB_USER_NAME: '已注销用户', FB_USER_MOBILE: '', FB_CONTACT: '', FB_TITLE: '已注销用户的反馈', FB_CONTENT: '', FB_IMG: [], FB_HISTORY: [] });
    if (own('FB_TARGET_USER_ID')) next.FB_TARGET_NAME = '已注销用户';
    next.FB_REPLY = ''; next.FB_REVIEW_REASON = ''; next.FB_ADD_IP = ''; next.FB_EDIT_IP = '';
  }
  if (name === 'invite') {
    if (own('INV_USER_ID')) { next.INV_USER_NAME = '已注销用户'; next.INV_CODE = ''; }
    if (own('INV_ACCEPT_USER_ID')) next.INV_ACCEPT_USER_NAME = '已注销用户';
  }
  if (name === 'order_review') {
    if (own('REVIEW_FROM_USER_ID')) next.REVIEW_FROM_NAME = '已注销用户';
    if (own('REVIEW_TO_USER_ID')) next.REVIEW_TO_NAME = '已注销用户';
    next.REVIEW_CONTENT = '';
  }
  return next;
}

async function clean(claim, options = {}) {
  const deadline = Date.now() + (options.budgetMs || 8000), id = claim._id || store.key('crun', 'account-session', claim.userId);
  const replacement = 'deleted:' + claim.cancelId;
  for (const [name, fields] of [...DELETE, ...ANONYMIZE]) {
    const batchSize = name === 'mail' ? 1 : 40;
    for (;;) {
      if (Date.now() >= deadline) return { complete: false };
      const batch = await store.transaction(async tx => {
        const state = await store.get(tx, 'account_session', id);
        if (!state || state.status !== 'deleting' || state.cancelId !== claim.cancelId) return null;
        const cmd = store.database().command;
        const rows = await tx.collection(store.collection(name)).where(cmd.and([
          { _pid: 'crun' }, cmd.or(fields.map(field => ({ [field]: claim.userId })))
        ])).limit(batchSize).get();
        let moreEvents = false;
        for (const row of rows.data) {
          await files.enqueue(tx, claim, name, row);
          if (DELETE.some(([collection]) => collection === name)) await tx.collection(store.collection(name)).doc(row._id).remove();
          else if (name === 'invite') {
            // Free deterministic code/accept keys for a genuinely new account.
            // Preserve the other participant's history under an opaque archive key.
            if (row.INV_ACCEPT_USER_ID) {
              const archivedId = store.key('crun', 'closed-invite', claim.cancelId, row._id);
              await store.set(tx, name, archivedId, { ...anonymize(name, row, claim.userId, replacement), INV_ID: archivedId });
            }
            await tx.collection(store.collection(name)).doc(row._id).remove();
          } else {
            if (name === 'mail') {
              // Every event copies proof/exception data, even another actor's
              // event. Scrub all copies before detaching the order identity.
              const events = await tx.collection(store.collection('order_event')).where({ _pid: 'crun', orderId: row._id, accountCleanupId: cmd.neq(claim.cancelId) }).limit(40).get();
              for (const event of events.data) {
                await files.enqueue(tx, claim, 'order_event', event);
                await store.set(tx, 'order_event', event._id, { ...anonymize('order_event', event, claim.userId, replacement), accountCleanupId: claim.cancelId });
              }
              if (events.data.length === 40) { moreEvents = true; continue; }
            }
            await store.set(tx, name, row._id, anonymize(name, row, claim.userId, replacement));
          }
        }
        // Fence other cleanup workers against a later re-registration.
        await store.set(tx, 'account_session', id, { ...state, revision: (state.revision || 0) + 1 });
        return { count: rows.data.length, moreEvents };
      });
      if (!batch) return { complete: true };
      if (batch.count < batchSize && !batch.moreEvents) break;
    }
  }
  if (!await files.drain(claim, deadline)) return { complete: false };
  return store.transaction(async tx => {
    const state = await store.get(tx, 'account_session', id);
    if (state && state.status === 'deleting' && state.cancelId === claim.cancelId) {
      if ((await files.pending(tx, claim, 1)).data.length) return { complete: false };
      // The tombstone contains no OpenID/profile/phone/session credential.
      await store.set(tx, 'account_session', id, { _pid: 'crun', status: 'deleted', deletedAt: Date.now(), revision: (state.revision || 0) + 1 });
    }
    return { complete: true };
  });
}
module.exports = { clean };
