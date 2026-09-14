const UI = require('../../../../biz/admin_console_biz.js');
const Ops = require('../../../../biz/operations_biz.js');
Page({
  data: { id: '', detail: null, loading: false, error: '', notFound: false, busy: false, note: '', actionIndex: 0, actions: ['回复并处理完成', '回复，继续跟进', '说明理由，不予处理'], ratingIndex: 0, reviewScore: 0, ratingActions: ['仅回复，不改变评分', '审核并评定星级', '撤销此前评分'] },
  onLoad(options = {}) {
    if (!UI.start(this)) return;
    if (!options.id) { this.setData({ notFound: true }); return; }
    this.setData({ id: options.id }); return this.load();
  },
  onShow() { const reload = this._visible === false; this._visible = true; if (reload && this.data.id) return this.load(); },
  onHide() { UI.hide(this); },
  onUnload() { this._unloaded = true; UI.hide(this); },
  async onPullDownRefresh() { try { if (!this.data.busy) await this.load(); } finally { wx.stopPullDownRefresh(); } },
  async load() {
    if (!this.data.id || !UI.authorize(this)) return;
    const seq = this._seq = (this._seq || 0) + 1;
    this.setData({ loading: true, error: '' });
    try {
      const data = await Ops.get('admin/feedback_detail', { id: this.data.id });
      if (!this._visible || seq !== this._seq) return;
      this.setData({ detail: data && data._id ? UI.feedback(data) : null, notFound: !data || !data._id });
    } catch (error) { if (this._visible && seq === this._seq) this.setData({ error: UI.message(error) }); }
    finally { if (this._visible && seq === this._seq) this.setData({ loading: false }); }
  },
  bindBack() { UI.back('feedback'); },
  bindNote(e) { if (!this.data.busy) this.setData({ note: e.detail.value }); },
  bindAction(e) { const index = Number(e.detail.value); if (!this.data.busy && [0, 1, 2].includes(index)) this.setData({ actionIndex: index, ...(index !== 0 ? { ratingIndex: 0, reviewScore: 0 } : {}) }); },
  bindRatingAction(e) {
    const index = Number(e.detail.value);
    if (!this.data.busy && this.data.actionIndex === 0 && [0, 1, 2].includes(index)) this.setData({ ratingIndex: index, reviewScore: 0 });
  },
  bindReviewScore(e) {
    const score = Number(e.currentTarget.dataset.score);
    if (!this.data.busy && this.data.ratingIndex === 1 && Number.isInteger(score) && score >= 1 && score <= 5) this.setData({ reviewScore: score });
  },
  bindOrder() { if (this.data.detail && this.data.detail.FB_ORDER_ID) UI.go('order', { id: this.data.detail.FB_ORDER_ID }); },
  bindImage(e) { const url = e.currentTarget.dataset.url; if (url) wx.previewImage({ urls: [url], current: url }); },
  async bindProcess() {
    if (this.data.busy || this.data.loading || this.data.error || !UI.authorize(this) || !this.data.detail) return;
    const detail = this.data.detail, reply = this.data.note.trim();
    if (!reply) { Ops.error(new Error('请填写回复内容和处理依据')); return; }
    const ratingAction = ['keep', 'rate', 'clear'][this.data.ratingIndex], reviewScore = this.data.reviewScore;
    if (ratingAction === 'rate' && (!detail.FB_CAN_RATE || this.data.actionIndex !== 0 || !Number.isInteger(reviewScore) || reviewScore < 1 || reviewScore > 5)) { Ops.error(new Error('请核实订单对方，并选择1至5星后完成审核')); return; }
    this.setData({ busy: true });
    try {
      const ratingNotice = ratingAction === 'rate' ? '本次将对' + detail.FB_TARGET_NAME + '评为' + reviewScore + '星，对应' + ((reviewScore - 3) * 2) + '分。评分依据对双方可见。' : ratingAction === 'clear' || this.data.actionIndex !== 0 && detail.FB_REVIEW_SCORE ? '此前的审核评分将不再计入对方信誉分。' : '';
      if (!await UI.confirm('提交反馈处理结果', '回复将展示给提交反馈的用户，并保留在处理记录中。' + ratingNotice)) return;
      if (!this._visible) return;
      await Ops.command('admin/feedback_reply', { id: detail._id, reply, version: Number(detail.FB_VERSION || 0), status: [1, 0, 2][this.data.actionIndex], ...(ratingAction !== 'keep' ? { ratingAction } : {}), ...(ratingAction === 'rate' ? { reviewScore } : {}) });
      UI.changed(this);
      if (this._visible) { this.setData({ note: '', actionIndex: 0, ratingIndex: 0, reviewScore: 0 }); wx.showToast({ title: '回复已提交' }); await this.load(); }
    } catch (error) { if (this._visible) Ops.error(error); }
    finally { if (!this._unloaded) this.setData({ busy: false }); }
  }
});
