const Settings = require('../../../../biz/admin_settings_biz.js');
const UI = require('../../../../biz/admin_console_biz.js');
Page({
  data: { section: 'rules', config: null, campusText: '', loading: true, busy: false, dirty: false, error: '', fields: [
    { key: 'maxActiveOrders', label: '每人同时接单上限', unit: '单', type: 'number', min: 1, max: 20 },
    { key: 'maxOpenOrders', label: '每人未结束发布单上限', unit: '单', type: 'number', min: 1, max: 50 },
    { key: 'deliveryMinutes', label: '普通单配送时效', unit: '分钟', type: 'number', min: 10, max: 1440 },
    { key: 'urgentMinutes', label: '加急单配送时效', unit: '分钟', type: 'number', min: 10, max: 1440 }
  ] },
  onLoad() { return Settings.start(this); },
  onShow() { return Settings.show(this); },
  onHide() { UI.hide(this); },
  onUnload() { this._unloaded = true; UI.hide(this); },
  async onPullDownRefresh() { try { await Settings.load(this); } finally { wx.stopPullDownRefresh(); } },
  bindLoad() { return Settings.load(this); },
  bindEdit(e) { Settings.edit(this, e); },
  bindSave() { return Settings.save(this); },
  bindDiscard() { return Settings.discard(this); },
  bindBack() { UI.back('settings'); }
});
