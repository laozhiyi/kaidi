'use strict';
const crypto = require('crypto');
const requests = require('../../../framework/core/account_context.js');
const AppError = require('../../../framework/core/app_error.js');
const tenant = require('../../../framework/tenancy/tenant_context.js');
const store = require('./operation_store.js');
const SESSION_MS = 86400000;
const CANCELLATION_MS = 7200000;
const PUBLIC = new Set(['tenant/catalog', 'home/setup_get', 'home/list', 'news/list', 'news/view', 'news/featured',
  'mail/view', 'mail/list', 'fav/order_stats', 'operations/config', 'campus_service/list', 'campus_service/detail', 'check/img']);
const LOGIN = new Set(['passport/wechat_identity_login', 'passport/wechat_login']);
const key = userId => store.key('crun', 'account-session', userId);
const digest = token => crypto.createHash('sha256').update(token).digest('hex');
const validToken = token => typeof token === 'string' && /^[a-f0-9]{64}$/.test(token);
const signedOut = () => { throw new AppError('登录已失效，请重新点击微信登录', 2301); };
function matches(row, userId, token) {
  return !!(row && row._pid === 'crun' && row.userId === userId && row.status === 'active'
    && row.expiresAt > Date.now() && validToken(token) && row.sessionHash === digest(token));
}

class AccountService {
  static credential() { const request = requests.getStore(); return request && request.token || ''; }
  static mediaGeneration() { const request = requests.getStore(); return request && request.mediaGeneration || ''; }
  static async recordMedia(tx, userId, values) {
    for (const fileID of require('./account_cleanup_files.js').ownedFiles(values, userId)) {
      const id = store.key('crun', 'account-media', userId, fileID);
      await store.set(tx, 'account_media', id, { _pid: 'crun', userId, fileID });
    }
  }

  static async runRequest(route, userId, token, work) {
    if (route.startsWith('admin/') || route === 'job/timer' || LOGIN.has(route)
      || ['passport/logout', 'passport/cancel'].includes(route)) return requests.run(null, () => work(userId));
    const account = new AccountService(), session = await account.authenticate(userId, token);
    if (!session) {
      if (route === 'passport/login') return { token: null };
      if (PUBLIC.has(route)) return requests.run(null, () => work(''));
      signedOut();
    }
    return requests.run({ userId, token, mediaGeneration: session.mediaGeneration || '',
      trackMedia: values => store.transaction(tx => AccountService.recordMedia(tx, userId, values)) }, () => work(userId));
  }

  // Every user mutation shares this document with logout/cancellation. A
  // concurrent commit forces a transaction retry and another session check.
  static async guardTransaction(tx) {
    const request = requests.getStore();
    if (!request) return;
    const id = key(request.userId), row = await store.get(tx, 'account_session', id);
    if (!matches(row, request.userId, request.token)) signedOut();
    await store.set(tx, 'account_session', id, { ...row, revision: (row.revision || 0) + 1 });
  }

  // Writers acting for another person (invites, administrator replies) must
  // conflict with that account's cancellation too, not only their own session.
  static async guardRelated(tx, userId) {
    const id = key(userId), row = await store.get(tx, 'account_session', id);
    if (row && row.status !== 'active') return false;
    if (row) await store.set(tx, 'account_session', id, { ...row, revision: (row.revision || 0) + 1 });
    return true;
  }

  async authenticate(userId, token) {
    if (!userId || !validToken(token)) return null;
    const row = await store.get(store.database(), 'account_session', key(userId));
    return matches(row, userId, token) ? row : null;
  }

  async prepareLogin(userId) {
    const row = await store.get(store.database(), 'account_session', key(userId));
    if (row && (row.status === 'deleting' || row.status === 'pending' && row.cancelAt <= Date.now())) {
      const result = await this.finalize(userId);
      if (!result.complete) throw new AppError('账号注销正在处理，请稍后重新登录');
    }
  }

  async activate(tx, userId) {
    const id = key(userId), old = await store.get(tx, 'account_session', id), now = Date.now();
    if (old && (old.status === 'deleting' || old.status === 'pending' && old.cancelAt <= now)) {
      throw new AppError('账号注销已到期，请重新点击微信登录');
    }
    const token = crypto.randomBytes(32).toString('hex');
    const mediaGeneration = old && old.mediaGeneration || crypto.randomBytes(16).toString('hex');
    const cancellationCancelled = !!(old && old.status === 'pending');
    await store.set(tx, 'account_session', id, { _pid: 'crun', userId, status: 'active', sessionHash: digest(token),
      mediaGeneration, expiresAt: now + SESSION_MS, revision: (old && old.revision || 0) + 1, updatedAt: now });
    return { sessionToken: token, mediaGeneration, cancellationCancelled };
  }

  async logout(userId, token) {
    if (!userId || !validToken(token)) return { ok: true };
    return requests.run(null, () => store.transaction(async tx => {
      const id = key(userId), row = await store.get(tx, 'account_session', id);
      if (row && row.userId === userId && row.sessionHash === digest(token)) {
        await store.set(tx, 'account_session', id, { ...row, sessionHash: '', expiresAt: 0, updatedAt: Date.now() });
      }
      return { ok: true };
    }));
  }

  async hasUnfinishedOrders(tx, userId) {
    // Account cancellation covers this WeChat identity in every school/campus.
    // Only the two terminal states count as finished, including legacy rows.
    return tenant.system(async () => {
      const cmd = store.database().command;
      for (const field of ['MAIL_USER_ID', 'MAIL_ACCEPT_USER_ID']) {
        const result = await tx.collection(store.collection('mail')).where(cmd.and([
          { _pid: 'crun', [field]: userId }, { MAIL_STATUS: cmd.neq(9) }, { MAIL_STATUS: cmd.neq(99) }
        ])).limit(1).get();
        if (result.data.length) return true;
      }
      return false;
    });
  }

  async requestCancellation(userId, token) {
    if (!userId || !validToken(token)) signedOut();
    return requests.run(null, () => store.transaction(async tx => {
      const id = key(userId), row = await store.get(tx, 'account_session', id);
      if (row && row.userId === userId && row.status === 'pending' && row.cancelSessionHash === digest(token)) {
        return { requestedAt: row.requestedAt, cancelAt: row.cancelAt };
      }
      if (!matches(row, userId, token)) signedOut();
      if (await this.hasUnfinishedOrders(tx, userId)) throw new AppError('还有未完成的发单或接单，请先完成或取消订单后再注销账户');
      const now = Date.now(), cancelId = crypto.randomBytes(16).toString('hex');
      await store.set(tx, 'account_session', id, { ...row, status: 'pending', sessionHash: '', expiresAt: 0,
        cancelSessionHash: digest(token), requestedAt: now, cancelAt: now + CANCELLATION_MS, cancelId, updatedAt: now });
      return { requestedAt: now, cancelAt: now + CANCELLATION_MS };
    }));
  }

  async finalize(userId, options = {}) {
    return requests.run(null, () => tenant.system(async () => {
      const id = key(userId);
      const claim = await store.transaction(async tx => {
        const row = await store.get(tx, 'account_session', id);
        if (!row || !['pending', 'deleting'].includes(row.status)) return null;
        if (row.status === 'pending' && row.cancelAt > Date.now()) return null;
        if (await this.hasUnfinishedOrders(tx, userId)) throw new AppError('注销暂未执行，仍有未完成订单');
        const next = { ...row, status: 'deleting', sessionHash: '', expiresAt: 0, updatedAt: Date.now() };
        await store.set(tx, 'account_session', id, next);
        return next;
      });
      if (!claim) return { complete: true };
      return require('./account_cleanup.js').clean(claim, options);
    }));
  }

  async sweep(options = {}) {
    return requests.run(null, () => tenant.system(async () => {
      const db = store.database(), cmd = db.command, deadline = Date.now() + (options.budgetMs || 8000);
      const rows = await db.collection(store.collection('account_session')).where(cmd.and([
        { _pid: 'crun', status: cmd.in(['pending', 'deleting']) }, { cancelAt: cmd.lte(Date.now()) }
      ])).orderBy('cancelAt', 'asc').limit(20).get();
      const result = { processed: 0, failed: 0, hasMore: rows.data.length === 20 };
      for (const row of rows.data) {
        if (Date.now() >= deadline) { result.hasMore = true; break; }
        try { const cleaned = await this.finalize(row.userId, { budgetMs: Math.max(1, deadline - Date.now()) });
          if (cleaned.complete) result.processed++; else result.hasMore = true;
        } catch (error) { result.failed++; console.error('[account-cleanup]', { code: error.code || 'CLEANUP_FAILED' }); }
      }
      return result;
    }));
  }
}
module.exports = AccountService;
