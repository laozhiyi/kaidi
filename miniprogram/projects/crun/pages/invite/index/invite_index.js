const cloudHelper = require('../../../../../helper/cloud_helper.js');
const ProjectBiz = require('../../../biz/project_biz.js');
const PassportBiz = require('../../../../../comm/biz/passport_biz.js');
Page({
  data: { isLoad: false, loading: false, error: '', code: '', stat: { total: 0, accepted: 0, reward: 0, pending: 0 }, list: [], page: 0, hasMore: false },
  onLoad() { ProjectBiz.initPage(this); },
  async onShow() {
    this._visible = true;
    if (await PassportBiz.loginMustBackWin(this) && this._visible) return this._loadAll();
  },
  onHide() { this._visible = false; this._seq = (this._seq || 0) + 1; this.setData({ loading: false }); },
  onUnload() { this.onHide(); },
  async onPullDownRefresh() { try { await this._loadAll(); } finally { wx.stopPullDownRefresh(); } },
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
      this.setData({ code: codeRes.code, stat: statRes, list: reset ? listRes.list : this.data.list.concat(listRes.list),
        page, hasMore: !!listRes.hasMore, isLoad: true });
    } catch (error) {
      if (this._visible && seq === this._seq) this.setData({ error: '邀请信息加载失败，请重试' });
    } finally {
      if (this._visible && seq === this._seq) this.setData({ loading: false });
    }
  },
  bindMore() { if (this.data.hasMore && !this.data.loading) return this.load(false); },
  bindCopyCode() {
    if (!this.data.code) return wx.showToast({ title: '请先加载邀请码', icon: 'none' });
    wx.setClipboardData({ data: this.data.code, success: () => wx.showToast({ title: '已复制邀请码', icon: 'success' }),
      fail: () => wx.showToast({ title: '复制失败，请重试', icon: 'none' }) });
  },
  onShareAppMessage() {
    const query = this.data.code ? '?inviteCode=' + encodeURIComponent(this.data.code) : '';
    return { title: 'GXNU校跑，便捷互助，邀请你一起加入', path: '/projects/crun/pages/default/index/default_index' + query };
  }
});
