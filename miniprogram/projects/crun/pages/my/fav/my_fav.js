const Ops = require('../../../biz/operations_biz.js');
const ProjectBiz = require('../../../biz/project_biz.js');
const PassportBiz = require('../../../../../comm/biz/passport_biz.js');
Page({
  data: { list: [], keyword: '', search: '', page: 0, total: 0, hasMore: false, loading: false, isLoad: false, error: false, deletingId: '' },
  onLoad() { ProjectBiz.initPage(this); },
  async onShow() {
    this._visible = true;
    if (await PassportBiz.loginMustBackWin(this) && this._visible) return this.load(true);
  },
  onHide() { this._visible = false; this._seq = (this._seq || 0) + 1; this.setData({ loading: false }); },
  onUnload() { this.onHide(); },
  async load(reset = true) {
    if (typeof reset !== 'boolean') reset = true;
    if (!this._visible || (!reset && (this.data.loading || !this.data.hasMore))) return;
    const seq = this._seq = (this._seq || 0) + 1;
    const page = reset ? 1 : this.data.page + 1;
    this.setData({ loading: true, error: false });
    try {
      const result = await Ops.get('fav/my_list', { page, size: 20, search: this.data.search });
      if (!result || !Array.isArray(result.list)) throw new Error('收藏加载失败');
      if (this._visible && seq === this._seq) this.setData({ list: reset ? result.list : this.data.list.concat(result.list),
        page, total: result.total, hasMore: !!result.hasMore, isLoad: true });
    } catch (error) {
      if (this._visible && seq === this._seq) this.setData({ error: true, isLoad: true });
    } finally {
      if (this._visible && seq === this._seq) this.setData({ loading: false });
    }
  },
  async onPullDownRefresh() { try { await this.load(true); } finally { wx.stopPullDownRefresh(); } },
  onReachBottom() { if (this.data.hasMore && !this.data.loading) return this.load(false); },
  bindKeywordInput(e) { this.setData({ keyword: e.detail.value }); },
  bindSearch() { this.setData({ search: this.data.keyword.trim() }); return this.load(true); },
  bindClearSearch() { this.setData({ keyword: '', search: '' }); return this.load(true); },
  bindOpen(e) {
    const item = this.data.list.find(row => row._id === e.currentTarget.dataset.id);
    if (!item || !item.FAV_PATH) return wx.showToast({ title: '内容已下架，可移除收藏', icon: 'none' });
    wx.navigateTo({ url: item.FAV_PATH, fail: () => wx.showToast({ title: '内容暂时无法打开', icon: 'none' }) });
  },
  async bindDelete(e) {
    if (this.data.deletingId) return;
    const item = this.data.list.find(row => row._id === e.currentTarget.dataset.id);
    if (!item) return;
    this.setData({ deletingId: item._id });
    try {
      const confirmed = await new Promise(resolve => wx.showModal({
        title: '移除收藏', content: '确定不再收藏这条内容吗？', confirmText: '移除',
        success: result => resolve(!!result.confirm), fail: () => resolve(false)
      }));
      if (!confirmed || !this._visible) return;
      await Ops.get('fav/del', { oid: item.FAV_OID });
      if (!this._visible) return;
      this.setData({ list: this.data.list.filter(row => row.FAV_OID !== item.FAV_OID), total: Math.max(0, this.data.total - 1) });
      wx.showToast({ title: '已移除收藏', icon: 'success' });
      await this.load(true);
    } catch (error) { if (this._visible) Ops.error(error); }
    finally { this.setData({ deletingId: '' }); }
  },
  bindBrowse() { wx.setStorageSync('crun-order-tab', 0); wx.switchTab({ url: '/projects/crun/pages/order/index/order_index' }); }
});
