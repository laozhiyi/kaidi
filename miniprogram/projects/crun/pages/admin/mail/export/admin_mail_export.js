const Export = require('../../../../biz/admin_export_biz.js');
const UI = require('../../../../biz/admin_console_biz.js');
Page({
  data: { reportType: 'mail', loading: false, busy: false, error: '', reportUrl: '', generatedAt: '', total: null, condition: '', startDate: '', endDate: '', statusIndex: 0, statuses: ['全部状态', '待接单', '已接单', '已取件', '待收货', '异常中', '已完成', '已取消'] },
  onLoad(options = {}) { return Export.start(this, options); },
  onShow() { const reload = this._visible === false; this._visible = true; if (reload) return Export.load(this); },
  onHide() { UI.hide(this); },
  onUnload() { this._unloaded = true; UI.hide(this); },
  async onPullDownRefresh() { try { await Export.load(this); } finally { wx.stopPullDownRefresh(); } },
  bindLoad() { return Export.load(this); },
  bindStart(e) { if (!this.data.busy) this.setData({ startDate: e.detail.value }); },
  bindEnd(e) { if (!this.data.busy) this.setData({ endDate: e.detail.value }); },
  bindStatus(e) { const statusIndex = Number(e.detail.value); if (!this.data.busy && statusIndex >= 0 && statusIndex < 8) this.setData({ statusIndex }); },
  bindExportTap() { return Export.generate(this); },
  bindOpenTap() { return Export.open(this); },
  bindCopy() { Export.copy(this); },
  bindDelTap() { return Export.remove(this); },
  bindBack() { UI.back('orders'); }
});
