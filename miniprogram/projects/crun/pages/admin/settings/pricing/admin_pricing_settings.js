const Settings = require('../../../../biz/admin_settings_biz.js');
const UI = require('../../../../biz/admin_console_biz.js');
Page({
  data: { section: 'pricing', config: null, campusText: '', loading: true, busy: false, dirty: false, error: '', fields: [
    { key: 'smallPrice', label: '小件参考价', unit: '元/件', type: 'digit', min: 0, max: 100 },
    { key: 'mediumPrice', label: '中件参考价', unit: '元/件', type: 'digit', min: 0, max: 100 },
    { key: 'largePrice', label: '大件参考价', unit: '元/件', type: 'digit', min: 0, max: 100 },
    { key: 'maxPackages', label: '每单最多包裹数', unit: '件', type: 'number', min: 1, max: 100 }
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
