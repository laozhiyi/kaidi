const Ops = require('../../../../biz/operations_biz.js');
const UI = require('../../../../biz/admin_console_biz.js');

Page({
  data: { loading: true, error: '', overview: null, config: null, configError: false, dateText: '', admin: null },
  onLoad() {
    if (!UI.start(this)) return;
    this.setData({ dateText: UI.time(Date.now()).slice(0, 10) });
    return this.load();
  },
  onShow() { const reload = this._visible === false; this._visible = true; if (reload && UI.authorize(this)) return this.load(); },
  onHide() { UI.hide(this); },
  onUnload() { this._unloaded = true; UI.hide(this); },
  async onPullDownRefresh() { try { await this.load(); } finally { wx.stopPullDownRefresh(); } },
  async load() {
    if (!UI.authorize(this)) return;
    const seq = this._seq = (this._seq || 0) + 1;
    this.setData({ loading: true, error: '', configError: false });
    const overview = Ops.get('admin/operations_overview').then(data => {
      if (this._visible && seq === this._seq) this.setData({ overview: UI.summary(data) });
    }).catch(error => { if (this._visible && seq === this._seq) this.setData({ error: UI.message(error) }); })
      .finally(() => { if (this._visible && seq === this._seq) this.setData({ loading: false }); });
    const config = Ops.get('admin/operations_config').then(data => {
      if (this._visible && seq === this._seq) this.setData({ config: data });
    }).catch(() => { if (this._visible && seq === this._seq) this.setData({ configError: true }); });
    return Promise.allSettled([overview, config]);
  },
  bindNavigate(e) {
    const { key, status, overdue } = e.currentTarget.dataset;
    return UI.go(key, { status, overdue });
  }
});
