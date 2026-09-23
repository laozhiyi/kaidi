const Ops = require('./operations_biz.js');
const cloud = require('../../../helper/cloud_helper.js');
const Feed = require('./order_feed_biz.js');

const listeners = new Set();
const MIN_GAP = 1500;
let foreground = true, online = true, watcher = null, generation = 0, watchGeneration = 0, connected = false;
let pollTimer = null, refreshTimer = null, reconnectTimer = null, running = null, queued = false;
let lastRefresh = 0, failures = 0, reconnects = 0, signature = '', networkHandler = null, stopChanges = null;
const enabled = () => foreground && online && listeners.size > 0;
const jitter = ms => Math.round(ms * (1 + Math.random() * 0.2));
function clearTimers() {
  for (const timer of [pollTimer, refreshTimer, reconnectTimer]) if (timer !== null) clearTimeout(timer);
  pollTimer = refreshTimer = reconnectTimer = null;
}
function closeWatcher() {
  watchGeneration++;
  const old = watcher; watcher = null; connected = false;
  if (old) { try { Promise.resolve(old.close()).catch(() => {}); } catch (_) {} }
}
function stop() {
  generation++; clearTimers(); closeWatcher(); running = null; queued = false;
}
function schedulePoll() {
  if (pollTimer !== null) clearTimeout(pollTimer);
  pollTimer = null;
  if (!enabled()) return;
  const delay = Math.min(60000, (connected ? 30000 : 8000) * Math.pow(2, Math.min(failures, 3)));
  pollTimer = setTimeout(() => { pollTimer = null; queueRefresh(0); }, jitter(delay));
}
function queueRefresh(delay = 200) {
  if (!enabled()) return;
  if (cloud.invalidateReadRequests) cloud.invalidateReadRequests();
  if (running) { queued = true; return; }
  if (refreshTimer !== null) return;
  refreshTimer = setTimeout(refresh, Math.max(delay, MIN_GAP - (Date.now() - lastRefresh)));
}
function refresh() {
  refreshTimer = null;
  if (!enabled()) return Promise.resolve();
  if (running) { queued = true; return running; }
  const token = generation;
  lastRefresh = Date.now(); queued = false;
  const pending = Promise.all(Array.from(listeners, listener => Promise.resolve().then(() => {
    if (token === generation && enabled() && listeners.has(listener)) return listener();
  }).then(result => !result || result.ok !== false, () => false))).then(results => {
    if (token === generation) failures = results.some(ok => !ok) ? failures + 1 : 0;
  }).finally(() => {
    if (running !== pending) return;
    running = null;
    if (token !== generation || !enabled()) return;
    if (queued) queueRefresh();
    schedulePoll();
  });
  running = pending;
  return pending;
}
function connect() {
  if (!enabled() || watcher) return;
  const token = generation;
  const watchToken = ++watchGeneration;
  function onError() {
    if (token !== generation || watchToken !== watchGeneration || !enabled()) return;
    closeWatcher(); schedulePoll();
    if (reconnectTimer === null) reconnectTimer = setTimeout(() => {
      reconnectTimer = null; connect();
    }, jitter(Math.min(60000, 1000 * Math.pow(2, Math.min(reconnects++, 6)))));
  }
  try {
    const scope = cloud.scopeSnapshot && cloud.scopeSnapshot();
    if (cloud.scopeSnapshot && !scope) { schedulePoll(); return; }
    const handle = Feed.watch({ scope,
      onChange(snapshot) {
        if (token !== generation || watchToken !== watchGeneration || !enabled()) return;
        connected = true; reconnects = 0;
        const next = JSON.stringify((snapshot.docs || []).map(row => [row._id, row.revision]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
        if (next !== signature) { signature = next; queueRefresh(); }
        schedulePoll();
      }, onError
    });
    if (token === generation && watchToken === watchGeneration && enabled()) watcher = handle;
    else if (handle) Promise.resolve(handle.close()).catch(() => {});
  } catch (_) { onError(); }
}
function start() { if (enabled()) { connect(); schedulePoll(); } }
if (cloud.onScopeChange) cloud.onScopeChange(() => { stop(); signature = ''; lastRefresh = 0; start(); });
if (cloud.onSessionChange) cloud.onSessionChange(() => { stop(); signature = ''; lastRefresh = 0; start(); });
function subscribe(listener) {
  listeners.add(listener);
  if (listeners.size === 1) {
    online = true;
    signature = ''; lastRefresh = 0;
    if (Ops.onOrderChanged) stopChanges = Ops.onOrderChanged(() => queueRefresh(0));
    if (typeof wx.onNetworkStatusChange === 'function') {
      networkHandler = state => {
        online = state.isConnected !== false;
        if (online) { failures = 0; start(); queueRefresh(0); } else stop();
      };
      wx.onNetworkStatusChange(networkHandler);
    }
    start();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size) return;
    stop();
    if (stopChanges) stopChanges(); stopChanges = null;
    if (networkHandler && wx.offNetworkStatusChange) wx.offNetworkStatusChange(networkHandler);
    networkHandler = null;
  };
}
function pause() { foreground = false; stop(); }
function resume() { foreground = true; online = true; start(); queueRefresh(0); }
module.exports = { subscribe, pause, resume };
