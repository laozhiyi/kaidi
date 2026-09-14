const UI = require('../../../../biz/admin_console_biz.js');
Page({
  data: { list: [], page: 0, total: 0, hasMore: false, loading: false, refreshing: false, error: '', searchDraft: '', search: '', status: -1,
    statuses: [{ value: -1, label: '全部反馈' }, { value: 0, label: '待处理' }, { value: 1, label: '已处理' }, { value: 2, label: '不予处理' }] },
  onLoad(options = {}) {
    if (!UI.start(this)) return;
    const status = Number(options.status);
    this.setData({ status: this.data.statuses.some(item => item.value === status) ? status : -1 });
    return this.load();
  },
  onShow() { if (this.data.isAdmin) return UI.showList(this); },
  onHide() { UI.hide(this); },
  onUnload() { this._unloaded = true; UI.hide(this); },
  onPageScroll(e) { this._scrollTop = e.scrollTop; },
  onReachBottom() { return this.bindMore(); },
  async onPullDownRefresh() { try { await this.load(true, true); } finally { wx.stopPullDownRefresh(); } },
  load(reset = true, preserve = false) { return UI.loadList(this, 'admin/feedback_list', { status: this.data.status, search: this.data.search }, UI.feedback, typeof reset === 'boolean' ? reset : true, preserve); },
  resetList(patch) { this._scrollTop = 0; this.setData({ ...patch, list: [], page: 0, total: 0, hasMore: false }); return this.load(); },
  bindInput(e) { this.setData({ searchDraft: e.detail.value }); },
  bindSearch() { return this.resetList({ search: this.data.searchDraft.trim() }); },
  bindStatus(e) { const status = Number(e.currentTarget.dataset.value); if (status !== this.data.status && this.data.statuses.some(item => item.value === status)) return this.resetList({ status }); },
  bindReset() { return this.resetList({ searchDraft: '', search: '', status: -1 }); },
  bindMore() { return this.load(false); },
  bindRetry() { return this.load(true, this.data.list.length > 0); },
  bindDetail(e) { return UI.openDetail(this, 'feedbackDetail', e.currentTarget.dataset.id); }
});
