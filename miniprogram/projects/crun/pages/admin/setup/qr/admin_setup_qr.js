const UI = require('../../../../biz/admin_console_biz.js');
const Ops = require('../../../../biz/operations_biz.js');
Page({
  data: { title: 'GXNU 随手取', path: '/projects/crun/pages/default/index/default_index', sc: 'qr', qrUrl: '', loading: false, error: '', imageError: false },
  onLoad(options = {}) {
    if (!UI.start(this)) return;
    try {
      const title = options.title ? decodeURIComponent(options.title) : this.data.title;
      const qr = options.qr ? decodeURIComponent(options.qr) : '';
      const path = options.path ? decodeURIComponent(options.path) : this.data.path;
      const sc = options.sc ? decodeURIComponent(options.sc) : 'qr';
      this.setData({ title, path, sc });
      if (qr && qr !== 'undefined' && qr !== 'null') { this.setData({ qrUrl: qr }); return; }
    } catch (_) { this.setData({ error: '小程序码参数无效，请返回重新打开' }); return; }
    return this.load();
  },
  onShow() { const reload = this._visible === false && !this.data.qrUrl; this._visible = true; if (reload) return this.load(); },
  onHide() { UI.hide(this); },
  onUnload() { this._unloaded = true; UI.hide(this); },
  async onPullDownRefresh() { try { await this.load(); } finally { wx.stopPullDownRefresh(); } },
  bindBack() { UI.back('settings'); },
  bindImageError() { this.setData({ imageError: true }); },
  bindPreview() { if (this.data.qrUrl && !this.data.imageError) wx.previewImage({ current: this.data.qrUrl, urls: [this.data.qrUrl] }); },
  async load() {
    if (!UI.authorize(this)) return;
    const seq = this._seq = (this._seq || 0) + 1;
    this.setData({ loading: true, error: '' });
    try {
      const qrUrl = await Ops.get('admin/setup_qr', { path: this.data.path, sc: this.data.sc });
      if (typeof qrUrl !== 'string' || !qrUrl) throw new Error('小程序码暂未生成，请稍后重试');
      if (this._visible && seq === this._seq) this.setData({ qrUrl, imageError: false });
    } catch (error) { if (this._visible && seq === this._seq) this.setData({ error: UI.message(error) }); }
    finally { if (this._visible && seq === this._seq) this.setData({ loading: false }); }
  }
});
