const cloudHelper = require('../../../../../helper/cloud_helper.js');
const ProjectBiz = require('../../../biz/project_biz.js');
const PassportBiz = require('../../../../../comm/biz/passport_biz.js');
Page({
  data: { isLoad: false, loading: false, error: '', code: '', qr: '', qrFileID: '', qrEnv: '', qrLoading: false, qrError: '',
    stat: { total: 0, accepted: 0, reward: 0, pending: 0 }, reward: '0.00', canWithdraw: false, minWithdraw: 10, perFriend: 2, list: [], page: 0, hasMore: false },
  onLoad() { ProjectBiz.initPage(this); },
  async onShow() {
    this._visible = true;
    if (await PassportBiz.loginMustBackWin(this) && this._visible) return this._loadAll();
  },
  onHide() { this._visible = false; this._seq = (this._seq || 0) + 1; this.setData({ loading: false }); },
  onUnload() { this.onHide(); },
  async onPullDownRefresh() { try { this._qrCode = ''; await this._loadAll(); } finally { wx.stopPullDownRefresh(); } },
  onReachBottom() { return this.bindMore(); },
  _loadAll() { return this.load(true); },
  async load(reset = true) {
    if (!this._visible || (!reset && (this.data.loading || !this.data.hasMore))) return;
    const seq = this._seq = (this._seq || 0) + 1;
    const page = reset ? 1 : this.data.page + 1;
    this.setData({ loading: true, error: '' });
    try {
      const opts = { hint: false };
      const [listRes, codeRes, statRes] = await Promise.all([
        cloudHelper.callCloudData('invite/my_list', { page, size: 20 }, opts),
        reset ? cloudHelper.callCloudData('invite/my_code', {}, opts) : { code: this.data.code },
        reset ? cloudHelper.callCloudData('invite/my_stat', {}, opts) : this.data.stat
      ]);
      if (!this._visible || seq !== this._seq) return;
      if (!listRes || !Array.isArray(listRes.list) || !codeRes || !codeRes.code || !statRes) throw new Error('邀请信息加载失败');
      // 每位好友注册成功 2 元，满 10 元可提现且不抽成。
      const accepted = Number(statRes.accepted) || 0;
      const reward = (accepted * 2).toFixed(2);
      this.setData({ code: codeRes.code, stat: statRes, reward, canWithdraw: Number(reward) >= this.data.minWithdraw,
        list: reset ? listRes.list : this.data.list.concat(listRes.list), page, hasMore: !!listRes.hasMore, isLoad: true });
      if (reset) this.loadQr(codeRes.code);
    } catch (error) {
      if (this._visible && seq === this._seq) this.setData({ error: '邀请信息加载失败，请重试' });
    } finally {
      if (this._visible && seq === this._seq) this.setData({ loading: false });
    }
  },
  /**
   * 小程序码单独加载：生成接口依赖微信云调用，失败只降级这块卡片，
   * 不能把整页邀请信息和奖励一起拖垮。
   */
  async loadQr(code = this.data.code) {
    if (!code || this._qrCode === code) return;
    this._qrCode = code;
    this.setData({ qrLoading: true, qrError: '' });
    try {
      const result = await cloudHelper.callCloudData('invite/my_qrcode', {}, { hint: false });
      if (!result || result.code !== code || !result.url) throw new Error('qrcode unavailable');
      this.setData({ qr: result.url, qrFileID: result.fileID || '', qrEnv: result.envVersion || '' });
    } catch (error) {
      this._qrCode = '';
      this.setData({ qr: '', qrFileID: '', qrError: '小程序码暂时无法生成，可先用「立即邀请」或邀请码邀请好友' });
    } finally {
      this.setData({ qrLoading: false });
    }
  },
  async _qrTempFile() {
    try {
      const file = await wx.cloud.downloadFile({ fileID: this.data.qrFileID });
      return file.tempFilePath;
    } catch (error) {
      // 云存储权限收紧时退回临时链接下载；两条都不通才提示用户。
      const file = await new Promise((resolve, reject) => wx.downloadFile({ url: this.data.qr, success: resolve, fail: reject }));
      return file.tempFilePath;
    }
  },
  async bindSaveQr() {
    if (!this.data.qrFileID) return wx.showToast({ title: '小程序码还没生成好', icon: 'none' });
    if (!wx.cloud || typeof wx.cloud.downloadFile !== 'function') return wx.showToast({ title: '当前微信版本不支持保存', icon: 'none' });
    wx.showLoading({ title: '保存中', mask: true });
    try {
      const path = await this._qrTempFile();
      await new Promise((resolve, reject) => wx.saveImageToPhotosAlbum({ filePath: path, success: resolve, fail: reject }));
      wx.showToast({ title: '已保存到相册', icon: 'success' });
    } catch (error) {
      wx.showModal({ title: '保存失败', content: '请允许保存到相册后重试', confirmText: '去设置',
        success: result => { if (result.confirm) wx.openSetting({}); } });
    } finally {
      wx.hideLoading();
    }
  },
  bindMore() { if (this.data.hasMore && !this.data.loading) return this.load(false); },
  bindWithdrawTap() {
    if (!this.data.canWithdraw) return wx.showToast({ title: '满 ' + this.data.minWithdraw + ' 元可提现', icon: 'none' });
    wx.navigateTo({ url: '/projects/crun/pages/my/wallet/wallet?account=invite' });
  },
  bindCopyCode() {
    if (!this.data.code) return wx.showToast({ title: '请先加载邀请码', icon: 'none' });
    wx.setClipboardData({ data: this.data.code, success: () => wx.showToast({ title: '已复制邀请码', icon: 'success' }),
      fail: () => wx.showToast({ title: '复制失败，请重试', icon: 'none' }) });
  },
  onShareAppMessage() {
    const query = this.data.code ? '?inviteCode=' + encodeURIComponent(this.data.code) : '';
    return { title: 'GXNU随手取，便捷互助，邀请你一起加入', path: '/projects/crun/pages/default/index/default_index' + query };
  }
});
