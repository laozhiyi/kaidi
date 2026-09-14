const Ops = require('../../../biz/operations_biz.js');
const ProjectBiz = require('../../../biz/project_biz.js');
const Passport = require('../../../../../comm/biz/passport_biz.js');
const Notifications = require('../../../biz/notification_biz.js');
const signed = value => value > 0 ? '+' + value : String(value);

Page({
  data: { summary: null, source: 'review', list: [], page: 0, hasMore: false, loading: false, error: false, isLoad: false },
  onLoad(options = {}) { ProjectBiz.initPage(this); this._notificationId = options.notificationId || ''; },
  async onShow() {
    this._visible = true;
    if (await Passport.loginMustBackWin(this) && this._visible) return this.load(true);
  },
  onHide() { this._visible = false; this._seq = (this._seq || 0) + 1; this.setData({ loading: false }); },
  onUnload() { this.onHide(); },
  async load(reset = true) {
    if (typeof reset !== 'boolean') reset = true;
    if (!this._visible || !reset && (this.data.loading || !this.data.hasMore)) return;
    const seq = this._seq = (this._seq || 0) + 1, page = reset ? 1 : this.data.page + 1, source = this.data.source;
    this.setData({ loading: true, error: false });
    try {
      const [summary, records] = await Promise.all([
        reset ? Ops.get('reputation/summary') : Promise.resolve(this.data.summary),
        Ops.get('reputation/records', { source, page, size: 20 })
      ]);
      if (!summary || !Number.isFinite(summary.score) || !summary.reviews || !summary.admin || !records || !Array.isArray(records.list)) throw new Error('信誉分加载失败');
      if (!this._visible || seq !== this._seq) return;
      const list = records.list.map(row => ({ ...row, pointsText: signed(row.points), stars: '★'.repeat(row.score) + '☆'.repeat(5 - row.score) }));
      this.setData({ summary: { ...summary,
        reviews: { ...summary.reviews, pointsText: signed(summary.reviews.points), averageText: summary.reviews.average === null ? '暂无' : summary.reviews.average + ' 星' },
        admin: { ...summary.admin, pointsText: signed(summary.admin.points), averageText: summary.admin.average === null ? '暂无' : summary.admin.average + ' 星' },
        rules: (summary.rules || []).map(rule => ({ ...rule, pointsText: signed(rule.points) }))
      }, list: reset ? list : this.data.list.concat(list), page, hasMore: !!records.hasMore, isLoad: true }, () => {
        if (this._notificationId && this._visible && seq === this._seq) Notifications.markRead(this._notificationId).catch(() => {});
      });
    } catch (error) { if (this._visible && seq === this._seq) this.setData({ error: true, isLoad: true }); }
    finally { if (this._visible && seq === this._seq) this.setData({ loading: false }); }
  },
  bindSource(e) {
    const source = e.currentTarget.dataset.source;
    if (!['review', 'admin'].includes(source) || source === this.data.source) return;
    this.setData({ source, list: [], page: 0, hasMore: false });
    return this.load(true);
  },
  async onPullDownRefresh() { try { await this.load(true); } finally { wx.stopPullDownRefresh(); } },
  onReachBottom() { if (this.data.hasMore && !this.data.loading) return this.load(false); },
  bindOrder(e) {
    const id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: '/projects/crun/pages/mail/my_detail/mail_my_detail?id=' + encodeURIComponent(id) });
  },
  bindCompletedOrders() {
    wx.setStorageSync('crun-order-tab', 3);
    wx.switchTab({ url: '/projects/crun/pages/order/index/order_index' });
  }
});
