const UI = require('../../../biz/admin_console_biz.js');
const Ops = require('../../../biz/operations_biz.js');
Page({
  data: { loading: true, error: '', overview: null, busy: false, result: null, ranAt: '' },
  onLoad() { if (UI.start(this)) return this.load(); },
  onShow() { const reload = this._visible === false; this._visible = true; if (reload) return this.load(); },
  onHide() { UI.hide(this); },
  onUnload() { this._unloaded = true; UI.hide(this); },
  async onPullDownRefresh() { try { if (!this.data.busy) await this.load(); } finally { wx.stopPullDownRefresh(); } },
  async load() {
    if (!UI.authorize(this)) return;
    const seq = this._seq = (this._seq || 0) + 1;
    this.setData({ loading: true, error: '' });
    try { const data = await Ops.get('admin/operations_overview'); if (this._visible && seq === this._seq) this.setData({ overview: data }); }
    catch (error) { if (this._visible && seq === this._seq) this.setData({ error: UI.message(error) }); }
    finally { if (this._visible && seq === this._seq) this.setData({ loading: false }); }
  },
  bindBack() { UI.back('settings'); },
  async bindMaintain() {
    if (!UI.authorize(this) || !this.data.isSuperAdmin || this.data.busy) return;
    this.setData({ busy: true });
    try {
      if (!await UI.confirm('执行系统维护', '将关闭已过期的待接单订单，并处理超时提醒与待发送通知。')) return;
      if (!this._visible) return;
      const result = await Ops.get('admin/operations_maintain');
      if (this._visible) { this.setData({ result, ranAt: UI.time(Date.now()) }); await this.load(); }
    } catch (error) { if (this._visible) Ops.error(error); }
    finally { if (!this._unloaded) this.setData({ busy: false }); }
  }
});
