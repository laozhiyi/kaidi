const UI = require('../../../biz/admin_console_biz.js');
Page({
  data: { error: false },
  onLoad(options = {}) {
    if (!UI.start(this)) return;
    const destinations = { overview: 'home', orders: 'orders', feedback: 'feedback', config: 'settings' };
    this._target = Object.prototype.hasOwnProperty.call(destinations, options.tab) ? destinations[options.tab] : 'home';
    this._params = {};
    if (options.status !== undefined) this._params.status = options.status;
    if (options.id && this._target === 'orders') { this._target = 'order'; this._params.id = options.id; }
    if (options.id && this._target === 'feedback') { this._target = 'feedbackDetail'; this._params.id = options.id; }
    return this.bindRetry();
  },
  bindRetry() {
    if (!UI.authorize(this)) return;
    this.setData({ error: false });
    return wx.redirectTo({ url: UI.url(this._target || 'home', this._params), fail: () => this.setData({ error: true }) });
  }
});
