const UI = require('../../../../biz/admin_console_biz.js');
const Ops = require('../../../../biz/operations_biz.js');
const cloud = require('../../../../../../helper/cloud_helper.js');
const Check = require('../../../../../../helper/content_check_helper.js');

// 反馈投诉页的「售后群」和这里共用一份 setup 内容：文字是群说明，图片是群二维码。
// 微信群二维码 7 天就过期，单独开这个页面让管理员/超管随时换一张，不用重新发布小程序。
const KEY = 'SETUP_CONTENT_AFTERSALES';
const FALLBACK_QR = '/projects/crun/images/aftersales_qr.jpg';

Page({
  data: { isLoad: false, loading: false, error: '', busy: false, qrBusy: false, qrUrl: '', fallbackQr: FALLBACK_QR },
  onLoad() {
    if (!UI.start(this)) return;
    return this.load();
  },
  onShow() { if (this.data.isAdmin) UI.authorize(this); },
  onHide() { UI.hide(this); },
  onUnload() { this._unloaded = true; UI.hide(this); },
  async onPullDownRefresh() { try { await this.load(); } finally { wx.stopPullDownRefresh(); } },
  bindBack() { UI.back('settings'); },
  async load() {
    if (!UI.authorize(this) || this.data.busy) return;
    this.setData({ loading: true, error: '' });
    try {
      const content = await Ops.get('home/setup_get', { key: KEY });
      if (this._unloaded) return;
      const list = Array.isArray(content) ? content.filter(node => node && node.type && String(node.val || '').trim()) : [];
      const qr = list.find(node => node.type === 'img');
      this.setData({ isLoad: true, qrUrl: qr ? qr.val : '' });
    } catch (error) {
      if (!this._unloaded) this.setData({ error: UI.message(error) });
    } finally {
      if (!this._unloaded) this.setData({ loading: false });
    }
  },
  async bindChoose() {
    if (!UI.authorize(this) || this.data.busy || this.data.qrBusy) return;
    let file = null;
    try {
      // 用压缩图：群二维码肉眼看不出差别，但原图动辄好几兆，上传和内容审核都容易被卡。
      const media = await new Promise((resolve, reject) => wx.chooseMedia({
        count: 1, mediaType: ['image'], sourceType: ['album', 'camera'], sizeType: ['compressed'],
        success: resolve, fail: reject
      }));
      file = media && media.tempFiles && media.tempFiles[0];
    } catch (error) {
      return; // 用户取消选图不算失败
    }
    if (!file || !file.tempFilePath) return;
    if (!Check.imgTypeCheck(file.tempFilePath)) { wx.showToast({ title: '请选择 png 或 jpg 图片', icon: 'none' }); return; }
    if (file.size && !Check.imgSizeCheck(file.size, 10 * 1024 * 1024)) { wx.showToast({ title: '图片不能超过 10MB', icon: 'none' }); return; }

    this.setData({ qrBusy: true });
    wx.showLoading({ title: '上传中', mask: true });
    try {
      // 这里传 false 跳过服务市场的内容安全校验：全项目其他上传入口同样是 false，
      // 而校验服务一旦没开通就会 reject，管理员会看到「不合适的图片」这种误导提示。
      // 群二维码只由管理员/超管上传，不是用户 UGC，本地已做类型与体积拦截。
      const url = await cloud.transTempPicOne(file.tempFilePath, 'setup/', KEY, false);
      if (!url) throw new Error('二维码没有上传成功，请检查网络后重试');
      await this.saveQr(url);
    } catch (error) {
      if (!this._unloaded) Ops.error(error);
    } finally {
      wx.hideLoading();
      if (!this._unloaded) this.setData({ qrBusy: false });
    }
  },
  async bindReset() {
    if (!UI.authorize(this) || this.data.busy || this.data.qrBusy || !this.data.qrUrl) return;
    if (!await UI.confirm('恢复内置二维码', '上传的二维码会被移除，云存储里的旧图同时清理，用户端改回小程序内置那张。内置群码可能已经过期。')) return;
    this.setData({ qrBusy: true });
    try {
      await this.saveQr('');
    } catch (error) {
      if (!this._unloaded) Ops.error(error);
    } finally {
      if (!this._unloaded) this.setData({ qrBusy: false });
    }
  },
  async saveQr(url) {
    this.setData({ busy: true });
    try {
      // 先读最新内容再合并：管理员可能刚在「关于与联系」改过群说明，不能覆盖。
      const content = await Ops.get('home/setup_get', { key: KEY });
      const list = Array.isArray(content) ? content.filter(node => node && node.type && node.type !== 'img' && String(node.val || '').trim()) : [];
      if (url) list.push({ type: 'img', val: url });
      if (!list.length) list.push({ type: 'text', val: '' });
      await cloud.transRichEditorTempPics(list, 'setup/', KEY, 'admin/setup_set_content');
      if (!this._unloaded) this.setData({ isLoad: true, qrUrl: url });
      // 先关掉「上传中」的 loading 再弹 toast，否则 hideLoading 会把刚弹出的提示一起关掉。
      wx.hideLoading();
      wx.showToast({ title: url ? '二维码已更新' : '已恢复内置二维码', icon: 'none' });
    } finally {
      if (!this._unloaded) this.setData({ busy: false });
    }
  },
  async bindPreview() {
    const url = this.data.qrUrl || this.data.fallbackQr;
    let target = url;
    if (/^cloud:\/\//.test(url)) {
      try { target = await cloud.getTempFileURLOne(url) || url; } catch (error) { /* 预览失败不影响页面 */ }
    }
    wx.previewImage({ current: target, urls: [target] });
  },
  bindEditText() {
    wx.navigateTo({ url: '/projects/crun/pages/admin/setup/about/admin_setup_about?key=' + KEY });
  },
  bindViewPage() {
    wx.navigateTo({ url: '/projects/crun/pages/feedback/index/feedback_index' });
  }
});
