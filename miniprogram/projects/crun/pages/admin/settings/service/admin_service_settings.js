const Settings = require('../../../../biz/admin_settings_biz.js');
const UI = require('../../../../biz/admin_console_biz.js');
Page({
  data: { section: 'service', config: null, campusText: '', loading: true, busy: false, dirty: false, error: '', fields: [
    { key: 'openHour', label: '营业开始时间', unit: '时', type: 'number', min: 0, max: 23 },
    { key: 'closeHour', label: '营业结束时间', unit: '时', type: 'number', min: 1, max: 24 }
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
