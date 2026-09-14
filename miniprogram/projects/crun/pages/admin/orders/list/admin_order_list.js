const UI = require('../../../../biz/admin_console_biz.js');
const Ops = require('../../../../biz/operations_biz.js');
Page({
  data: {
    list: [], page: 0, total: 0, hasMore: false, loading: false, refreshing: false, error: '',
    searchDraft: '', search: '', status: -1, campusIndex: 0, campuses: ['全部校区'], campusError: false,
    sortIndex: 0, sortLabels: ['最新发布', '最早发布', '费用从高到低', '费用从低到高'], overdue: false,
    statuses: [{ value: -1, label: '全部' }, { value: 0, label: '待接单' }, { value: 1, label: '已接单' }, { value: 4, label: '已取件' }, { value: 2, label: '待收货' }, { value: 3, label: '异常中' }, { value: 9, label: '已完成' }, { value: 99, label: '已取消' }]
  },
  onLoad(options = {}) {
    if (!UI.start(this)) return;
    const status = Number(options.status);
    this.setData({ status: this.data.statuses.some(item => item.value === status) ? status : -1, overdue: options.overdue === 'true' || options.overdue === true });
    return Promise.allSettled([this.load(), this.loadCampuses()]);
  },
  onShow() {
    if (!this.data.isAdmin) return;
    const refresh = UI.showList(this);
    return Promise.allSettled([refresh, !this._campusesLoaded ? this.loadCampuses() : null]);
  },
  onHide() { UI.hide(this); },
  onUnload() { this._unloaded = true; UI.hide(this); },
  onPageScroll(e) { this._scrollTop = e.scrollTop; },
  onReachBottom() { return this.bindMore(); },
  async onPullDownRefresh() { try { await this.load(true, true); } finally { wx.stopPullDownRefresh(); } },
  load(reset = true, preserve = false) {
    const params = { status: this.data.status, search: this.data.search, sort: ['recent', 'oldest', 'price_high', 'price_low'][this.data.sortIndex], overdue: this.data.overdue };
    if (this.data.campusIndex) params.campus = this.data.campuses[this.data.campusIndex];
    return UI.loadList(this, 'admin/operations_orders', params, UI.order, typeof reset === 'boolean' ? reset : true, preserve);
  },
  loadCampuses() {
    if (this._campusPromise) return this._campusPromise;
    if (!UI.authorize(this)) return;
    this._campusPromise = Ops.get('admin/operations_config').then(config => {
      if (!Array.isArray(config.campuses)) throw new Error('校区配置无效');
      if (this._visible && !this._unloaded) {
        this._campusesLoaded = true;
        this.setData({ campuses: ['全部校区', ...config.campuses], campusError: false });
      }
    }).catch(() => { if (this._visible && !this._unloaded) this.setData({ campusError: true }); })
      .finally(() => { this._campusPromise = null; });
    return this._campusPromise;
  },
  resetList(patch) { this._scrollTop = 0; this.setData({ ...patch, list: [], page: 0, total: 0, hasMore: false }); return this.load(); },
  bindInput(e) { this.setData({ searchDraft: e.detail.value }); },
  bindSearch() { return this.resetList({ search: this.data.searchDraft.trim() }); },
  bindStatus(e) { const status = Number(e.currentTarget.dataset.value); if (status !== this.data.status && this.data.statuses.some(item => item.value === status)) return this.resetList({ status }); },
  bindCampus(e) { const campusIndex = Number(e.detail.value); if (campusIndex >= 0 && campusIndex < this.data.campuses.length) return this.resetList({ campusIndex }); },
  bindSort(e) { const sortIndex = Number(e.detail.value); if (sortIndex >= 0 && sortIndex < 4) return this.resetList({ sortIndex }); },
  bindOverdue(e) { return this.resetList({ overdue: !!e.detail.value }); },
  bindReset() { return this.resetList({ searchDraft: '', search: '', status: -1, campusIndex: 0, sortIndex: 0, overdue: false }); },
  bindMore() { return this.load(false); },
  bindRetry() { return this.load(true, this.data.list.length > 0); },
  bindDetail(e) { return UI.openDetail(this, 'order', e.currentTarget.dataset.id); },
  bindExport() { UI.go('export'); }
});
