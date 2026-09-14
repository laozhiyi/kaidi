const Base = require('./base_project_service.js');
const store = require('./operation_store.js');
const Mail = require('./mail_service.js');
const Operations = require('./operations_service.js');
const TYPES = {
  news: { title: '通知公告', path: 'news/detail/news_detail', prefix: 'NEWS' },
  mail: { title: '快递代取', path: 'mail/detail/mail_detail', prefix: 'MAIL' }
};
function typeKey(type) {
  const value = String(type || '').toLowerCase();
  return TYPES[value] ? value : Object.keys(TYPES).find(key => TYPES[key].title === type) || '';
}
class FavService extends Base {
  async _records(userId, oid) {
    const result = await store.database().collection(store.collection('fav')).where({
      _pid: this.getProjectId(), FAV_USER_ID: userId, FAV_OID: oid
    }).limit(50).get();
    return result.data;
  }
  async isFav(userId, oid, type) {
    if (!userId) return { isFav: 0 };
    const key = typeKey(type);
    if (!key) return { isFav: 0 };
    const rows = await this._records(userId, oid);
    return { isFav: rows.some(row => typeKey(row.FAV_TYPE) === key) ? 1 : 0 };
  }
  _available(order, userId) {
    return !!order && order._pid === this.getProjectId() && order.MAIL_STATUS === 0
      && order.MAIL_PAYMENT_MODE === 'offline' && !order.MAIL_ACCEPT_USER_ID
      && order.MAIL_USER_ID !== userId && Number(order.MAIL_END_TIME) > Date.now();
  }
  // Read the actual favorite records so historical favorites and removals never
  // leave a drifting counter on the order. Only aggregate counts leave the server.
  async orderStats(userId, ids, orders) {
    if (!Array.isArray(ids) || ids.length > 50 || ids.some(id => typeof id !== 'string' || !id || id.length > 100)) this.AppError('订单编号无效，最多查询50个订单');
    ids = [...new Set(ids)];
    if (!ids.length) return { list: [] };
    const db = store.database(), types = db.command.in(['mail', TYPES.mail.title]);
    const targets = orders || (await db.collection(store.collection('mail')).where({
      _pid: this.getProjectId(), _id: db.command.in(ids)
    }).field({ _id: true, _pid: true, MAIL_STATUS: true, MAIL_PAYMENT_MODE: true,
      MAIL_USER_ID: true, MAIL_ACCEPT_USER_ID: true, MAIL_END_TIME: true }).limit(50).get()).data;
    const valid = new Map(targets.filter(row => row && row._pid === this.getProjectId()).map(row => [row._id, row]));
    const [mine, counts] = await Promise.all([
      userId ? db.collection(store.collection('fav')).where({
        _pid: this.getProjectId(), FAV_USER_ID: userId, FAV_OID: db.command.in(ids), FAV_TYPE: types
      }).limit(100).get() : { data: [] },
      db.collection(store.collection('fav')).aggregate().match({
        _pid: this.getProjectId(), FAV_OID: db.command.in(ids), FAV_TYPE: types
      }).group({ _id: '$FAV_OID', total: db.command.aggregate.sum(1) }).limit(50).end()
    ]);
    const saved = new Set(mine.data.map(row => row.FAV_OID));
    const totals = new Map(counts.list.map(row => [row._id, row.total]));
    const list = ids.map(id => {
      const order = valid.get(id);
      return { id, count: order ? totals.get(id) || 0 : 0, isFav: saved.has(id), available: this._available(order, userId), exists: !!order };
    });
    return { list };
  }
  async updateFav(userId, oid, type, favorite) {
    const user = await new Mail()._user(userId);
    const key = typeKey(type);
    if (!key) this.AppError('该内容暂不支持收藏');
    if (favorite !== undefined && typeof favorite !== 'boolean') this.AppError('收藏状态无效');
    const info = TYPES[key];
    const existing = (await this._records(userId, oid)).filter(row => typeKey(row.FAV_TYPE) === key);
    const id = store.key(this.getProjectId(), 'fav', userId, key, oid);
    const candidates = [...new Set([id, ...existing.map(row => row._id)])];
    const result = await store.transaction(async tx => {
      await new Mail()._actor(tx, { userId, user });
      const records = await Promise.all(candidates.map(candidate => store.get(tx, 'fav', candidate)));
      const old = records.filter(row => row && row._pid === this.getProjectId() && row.FAV_USER_ID === userId && row.FAV_OID === oid && typeKey(row.FAV_TYPE) === key);
      const desired = favorite === undefined ? !old.length : favorite;
      if (!desired) {
        for (const row of old) await tx.collection(store.collection('fav')).doc(row._id).remove();
        return { isFav: 0 };
      }
      if (old.length) return { isFav: 1 };
      const target = await store.get(tx, key, oid);
      if (!target || target._pid !== this.getProjectId() || (key === 'news' && target.NEWS_STATUS !== 1)) this.AppError('内容不存在或已下架');
      if (key === 'mail' && !this._available(target, userId)) this.AppError('该订单当前不可接单，无法新增收藏');
      const title = key === 'news' ? target.NEWS_TITLE : (target.MAIL_OBJ || {}).title || target.MAIL_CATE_NAME;
      const now = Date.now();
      await store.set(tx, 'fav', id, {
        _pid: this.getProjectId(), FAV_ID: id, FAV_USER_ID: userId, FAV_OID: oid,
        FAV_TYPE: key, FAV_TITLE: title || info.title,
        FAV_PATH: '/projects/crun/pages/' + info.path + '?id=' + encodeURIComponent(oid),
        FAV_ADD_TIME: now, FAV_EDIT_TIME: now
      });
      return { isFav: 1 };
    });
    if (key === 'mail') {
      const stats = (await this.orderStats(userId, [oid])).list[0];
      return { ...stats, isFav: stats.isFav ? 1 : 0 };
    }
    return result;
  }
  async delFav(userId, oid) {
    const user = await new Mail()._user(userId);
    const rows = await this._records(userId, oid);
    let effect = 0;
    await store.transaction(async tx => {
      await new Mail()._actor(tx, { userId, user });
      effect = 0;
      for (const row of rows) {
        const current = await store.get(tx, 'fav', row._id);
        if (current && current._pid === this.getProjectId() && current.FAV_USER_ID === userId) {
          await tx.collection(store.collection('fav')).doc(row._id).remove();
          effect++;
        }
      }
    });
    return { effect };
  }
  async getMyFavList(userId, { search = '', page = 1, size = 20 } = {}) {
    await new Mail()._user(userId);
    const where = { FAV_USER_ID: userId };
    if (search) where.FAV_TITLE = store.database().RegExp({ regexp: String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), options: 'i' });
    const result = await new Operations().list('fav', where, page, 'FAV_ADD_TIME', size);
    const orderIds = [...new Set(result.list.filter(row => typeKey(row.FAV_TYPE) === 'mail').map(row => row.FAV_OID))];
    const orders = await Promise.all(orderIds.map(id => store.get(store.database(), 'mail', id)));
    const orderMap = new Map(orders.filter(row => row && row._pid === this.getProjectId()).map(row => [row._id, row]));
    const stats = new Map((await this.orderStats(userId, orderIds, orders)).list.map(row => [row.id, row]));
    result.list = result.list.map(row => {
      const key = typeKey(row.FAV_TYPE);
      const order = key === 'mail' && orderMap.get(row.FAV_OID), stat = stats.get(row.FAV_OID);
      return { ...row, FAV_TYPE: key ? TYPES[key].title : row.FAV_TYPE,
        FAV_IS_ORDER: key === 'mail', FAV_MISSING: key === 'mail' && !order,
        FAV_TITLE: order ? (order.MAIL_OBJ || {}).title || row.FAV_TITLE : row.FAV_TITLE,
        FAV_ORDER_STATUS: order ? (this._available(order, userId) ? '可接单' : new Mail().getStatusDesc(order)) : '',
        FAV_ORDER_AVAILABLE: !!(stat && stat.available), FAV_COUNT: stat ? stat.count : 0,
        FAV_PRICE: order ? (order.MAIL_OBJ || {}).price : '',
        FAV_PATH: key && !(key === 'mail' && !order) ? '/projects/crun/pages/' + TYPES[key].path + '?id=' + encodeURIComponent(row.FAV_OID) : '' };
    });
    return result;
  }
}
module.exports = FavService;
