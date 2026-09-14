const UI = require('../../../biz/admin_console_biz.js');
const Ops = require('../../../biz/operations_biz.js');
Page({
  data: { loading: true, error: '', overview: null },
  onLoad() { if (UI.start(this)) return this.load(); },
  onShow() { const reload = this._visible === false; this._visible = true; if (reload) return this.load(); },
  onHide() { UI.hide(this); },
  onUnload() { this._unloaded = true; UI.hide(this); },
  async onPullDownRefresh() { try { await this.load(); } finally { wx.stopPullDownRefresh(); } },
  async load() {
    if (!UI.authorize(this)) return;
    const seq = this._seq = (this._seq || 0) + 1;
    this.setData({ loading: true, error: '' });
    try { const data = await Ops.get('admin/operations_overview'); if (this._visible && seq === this._seq) this.setData({ overview: UI.summary(data) }); }
    catch (error) { if (this._visible && seq === this._seq) this.setData({ error: UI.message(error) }); }
    finally { if (this._visible && seq === this._seq) this.setData({ loading: false }); }
  },
  bindBack() { UI.back('settings'); },
  bindStatus(e) { UI.go('orders', { status: e.currentTarget.dataset.status }); },
  bindNavigate(e) { const { key, status, overdue } = e.currentTarget.dataset; UI.go(key, { status, overdue }); }
});
