const Ops = require('./operations_biz.js');
const Passport = require('../../../comm/biz/passport_biz.js');

const POLL_MS = 60000;
const listeners = new Set(), reading = new Map(), acknowledged = new Set();
const empty = () => ({ unreadCount: 0, newsUnread: 0, personalUnread: 0, badge: '', featuredNews: null, loaded: false, error: false, signature: '' });
let identity = '', state = empty(), active = true, timer = null, request = null, generation = 0, lastFetch = 0;
const ignore = () => {};

function emit() { for (const listener of listeners) listener({ ...state }); }
function syncIdentity() {
  const current = Passport.getUserId();
  const marker = current + ':' + (Ops.scopeKey ? Ops.scopeKey() : '');
  if (marker !== identity) {
    identity = marker; state = empty(); lastFetch = 0; generation++; request = null; acknowledged.clear();
    emit();
  }
  return current;
}
function stopTimer() { if (timer !== null) clearTimeout(timer); timer = null; }
if (Passport.onSessionChange) Passport.onSessionChange(() => { generation++; request = null; syncIdentity(); });
function schedule() {
  stopTimer();
  if (active && listeners.size) timer = setTimeout(() => {
    timer = null;
    refresh(true).finally(schedule);
  }, POLL_MS);
}

function refresh(force = false) {
  const userId = syncIdentity();
  if (request) return request;
  if (!force && state.loaded && Date.now() - lastFetch < 1000) return Promise.resolve({ ...state });
  const seq = ++generation;
  const pending = (async () => {
    try {
      const result = await Ops.get(userId ? 'operations/summary' : 'news/featured');
      if (!result || !Object.prototype.hasOwnProperty.call(result, 'featuredNews') ||
        userId && (!Number.isSafeInteger(result.unreadCount) || result.unreadCount < 0)) throw new Error('未读消息加载失败');
      if (seq !== generation || userId !== Passport.getUserId()) return { ...state };
      const count = userId ? result.unreadCount : 0;
      state = { ...empty(), ...result, unreadCount: count, badge: count > 99 ? '99+' : count ? String(count) : '', loaded: true, error: false };
      lastFetch = Date.now();
      emit();
    } catch (error) {
      // Keep the last confirmed count during a network failure; failure does not mean "all read".
      if (seq === generation && userId === Passport.getUserId()) { state = { ...state, error: true }; emit(); }
    } finally { if (seq === generation) request = null; }
    return { ...state };
  })();
  request = pending;
  return pending;
}

function subscribe(listener) {
  syncIdentity();
  listeners.add(listener);
  listener({ ...state });
  if (active) { refresh().catch(ignore); schedule(); }
  return () => { listeners.delete(listener); if (!listeners.size) stopTimer(); };
}
function pause() { active = false; stopTimer(); generation++; request = null; }
function resume() {
  active = true;
  if (listeners.size) refresh(true).catch(ignore);
  schedule();
}

async function afterWrite(userId) {
  if (userId !== Passport.getUserId()) return;
  // An earlier summary must never restore the count from before a successful read.
  generation++; request = null; lastFetch = 0;
  if (active) await refresh(true);
}
function markRead(id, kind = 'notification') {
  const userId = syncIdentity();
  if (!userId || !id) return Promise.resolve(false);
  const key = userId + ':' + kind + ':' + id;
  if (acknowledged.has(key)) return Promise.resolve(true);
  if (reading.has(key)) return reading.get(key);
  const pending = (async () => {
    try {
      await Ops.get('operations/read', { id, kind });
      if (userId === Passport.getUserId()) acknowledged.add(key);
      await afterWrite(userId);
      return true;
    } finally { reading.delete(key); }
  })();
  reading.set(key, pending);
  return pending;
}
async function markAllRead() {
  const userId = syncIdentity();
  if (!userId) return false;
  await Ops.get('operations/read_all');
  await afterWrite(userId);
  return true;
}
function messageUrl(item) {
  if (item.newsId || item.kind === 'news') return '/projects/crun/pages/news/detail/news_detail?id=' + encodeURIComponent(item.newsId || item._id);
  const suffix = 'notificationId=' + encodeURIComponent(item._id);
  if (item.reputation) return '/projects/crun/pages/my/reputation/my_reputation?' + suffix;
  if (item.feedbackId) return '/projects/crun/pages/feedback/detail/feedback_detail?id=' + encodeURIComponent(item.feedbackId) + '&' + suffix;
  if (item.orderId) return '/projects/crun/pages/mail/my_detail/mail_my_detail?id=' + encodeURIComponent(item.orderId) + '&' + suffix;
  return '';
}

module.exports = { subscribe, refresh, pause, resume, markRead, markAllRead, messageUrl, snapshot: () => { syncIdentity(); return { ...state }; } };
