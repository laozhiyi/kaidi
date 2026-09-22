const Ops = require('./operations_biz.js');
const REFRESH_MS = 30000;

async function stats(ids, active = () => true) {
  const unique = [...new Set(ids.filter(Boolean))], rows = [];
  for (let offset = 0; offset < unique.length; offset += 50) {
    if (!active()) break;
    const result = await Ops.get('fav/order_stats', { ids: unique.slice(offset, offset + 50) });
    if (!result || !Array.isArray(result.list)) throw new Error('收藏数量更新失败');
    rows.push(...result.list);
  }
  return rows;
}
function setFavorite(id, favorite) {
  return Ops.get('fav/update', { oid: id, type: 'mail', favorite });
}
// The public endpoint returns counts only. Never watch the private order or
// favorite collections from a client. Stop polling as soon as a page is hidden.
function watch(getIds, apply, onError = () => {}) {
  let stopped = false, version = 0, timer = null, pending = null;
  const clear = () => { if (timer !== null) clearTimeout(timer); timer = null; };
  function refresh() {
    clear();
    if (stopped) return Promise.resolve();
    if (pending) return pending;
    const current = version;
    pending = stats(getIds(), () => !stopped && current === version).then(rows => { if (!stopped && current === version) apply(rows); })
      .catch(error => { if (!stopped && current === version) onError(error); })
      .finally(() => {
        pending = null;
        if (!stopped) { timer = setTimeout(refresh, REFRESH_MS); if (timer && timer.unref) timer.unref(); }
      });
    return pending;
  }
  return { refresh, invalidate() { version++; }, stop() { stopped = true; version++; clear(); } };
}
module.exports = { stats, setFavorite, watch, REFRESH_MS };
