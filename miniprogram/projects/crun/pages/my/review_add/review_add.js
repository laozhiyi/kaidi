const Ops = require('../../../biz/operations_biz.js');
const ProjectBiz = require('../../../biz/project_biz.js');
const Passport = require('../../../../../comm/biz/passport_biz.js');

Page({
  data: { orderId: '', context: null, score: 0, content: '', busy: false, loading: false, error: '', scoreLabels: ['', '很不满意', '不满意', '一般', '满意', '非常满意'] },
  onLoad(options = {}) {
    ProjectBiz.initPage(this);
    this.setData({ orderId: options.orderId || '' });
  },
  async onShow() {
    this._visible = true;
    if (await Passport.loginMustBackWin(this) && this._visible) return this.load();
  },
  onHide() { this._visible = false; this._seq = (this._seq || 0) + 1; this.setData({ loading: false }); },
  onUnload() { this._unloaded = true; this.onHide(); },
  async load() {
    if (!this.data.orderId) { this.setData({ error: '缺少订单编号，请从已完成订单进入', loading: false }); return; }
    const seq = this._seq = (this._seq || 0) + 1;
    this.setData({ loading: true, error: '' });
    try {
      const context = await Ops.get('review/context', { orderId: this.data.orderId });
      if (!context || typeof context.canReview !== 'boolean') throw new Error('评价信息加载失败');
      if (!this._visible || seq !== this._seq) return;
      const patch = { context };
      if (context.review) Object.assign(patch, { score: context.review.score, content: context.review.content });
      this.setData(patch);
    } catch (error) { if (this._visible && seq === this._seq) this.setData({ error: error.msg || error.message || '加载失败，请重试' }); }
    finally { if (this._visible && seq === this._seq) this.setData({ loading: false }); }
  },
  bindScore(e) {
    const score = Number(e.currentTarget.dataset.score);
    if (this.data.context && this.data.context.canReview && !this.data.busy && Number.isInteger(score) && score >= 1 && score <= 5) this.setData({ score });
  },
  bindContent(e) {
    if (this.data.context && this.data.context.canReview && !this.data.busy) this.setData({ content: e.detail.value });
  },
  async bindSubmit() {
    if (this.data.busy || this.data.loading || this.data.error || !this.data.context || !this.data.context.canReview || !this.data.orderId) return;
    if (!Number.isInteger(this.data.score) || this.data.score < 1 || this.data.score > 5) return wx.showToast({ title: '请选择评分', icon: 'none' });
    this.setData({ busy: true });
    try {
      if (!await Passport.loginMustCancelWin(this) || !this._visible) return;
      await Ops.command('review/insert', {
        orderId: this.data.orderId,
        score: this.data.score,
        content: this.data.content.trim()
      });
      for (const key of ['order-mail-take', 'order-mail-mine', 'order-mail-posted', 'order-mail-done']) wx.removeStorageSync(key.toUpperCase() + '_LIST');
      if (!this._visible) return;
      this.setData({ 'context.canReview': false, 'context.reviewed': true });
      wx.showModal({
        title: '评价成功',
        content: '评价已记录，并参与对方信誉分计算。',
        showCancel: false,
        success: () => wx.navigateBack()
      });
    } catch (e) {
      if (this._visible) {
        Ops.error(e);
        if (/已经评价/.test(e.msg || e.message || '')) await this.load();
      }
    } finally {
      if (!this._unloaded) this.setData({ busy: false });
    }
  },
  bindOrders() { wx.setStorageSync('crun-order-tab', 3); wx.switchTab({ url: '/projects/crun/pages/order/index/order_index' }); }
});
