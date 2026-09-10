const Ops = require('../../biz/operations_biz.js');
const ProjectBiz = require('../../biz/project_biz.js');
const Passport = require('../../../../comm/biz/passport_biz.js');
const TITLES = { messages: '消息中心' };

Page({
  data: {
    tab: 'messages', loading: false, error: false, config: null, user: null,
    campusIndex: 0, list: [], page: 0, hasMore: false, busy: false
  },
  onLoad(options = {}) {
    ProjectBiz.initPage(this);
    this.setTab('messages');
  },
  async onShow() {
    this._visible = true;
    if (await Passport.loginMustBackWin(this) && this._visible) await this.load(true);
  },
  onHide() { this._visible = false; this._seq = (this._seq || 0) + 1; },
  onUnload() { this._unloaded = true; this.onHide(); },
  async onPullDownRefresh() {
    try { await this.load(true); } finally { wx.stopPullDownRefresh(); }
  },
  onReachBottom() { this.bindMore(); },
  setTab(tab) {
    this.setData({ tab: 'messages' });
    wx.setNavigationBarTitle({ title: TITLES.messages });
  },
  async load(reset = true) {
    if (typeof reset !== 'boolean') reset = true;
    if (!reset && (this.data.loading || !this.data.hasMore || this.data.tab !== 'messages')) return;
    const seq = this._seq = (this._seq || 0) + 1;
    const tab = this.data.tab;
    const page = reset ? 1 : this.data.page + 1;
    this.setData({ loading: true, error: false });
    try {
      // 通知分页保持独立；服务配置仅用于可选订阅提示。
      let config = this.data.config;
      if (reset) { try { config = await Ops.get('operations/config'); } catch (_) { config = null; } }
      const result = await Ops.get('operations/notifications', { page });
      if (!this._visible || seq !== this._seq) return;
      const list = result.list.map(item => ({ ...item,
        time: new Date(item.createdAt + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ')
      }));
      this.setData({ config, list: reset ? list : this.data.list.concat(list), page,
        hasMore: !!result.hasMore, loading: false });
    } catch (error) {
      if (this._visible && seq === this._seq) this.setData({ loading: false, error: true });
    }
  },
  bindTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (!TITLES[tab] || tab === this.data.tab || this.data.busy) return;
    this.setTab(tab);
    return this.load(true);
  },
  async bindRead(e) {
    const item = this.data.list.find(x => x._id === e.currentTarget.dataset.id);
    if (!item || this._reading) return;
    this._reading = true;
    try {
      await Ops.get('operations/read', { id: item._id });
      if (!this._visible) return;
      this.setData({ list: this.data.list.map(x => x._id === item._id ? { ...x, read: true } : x) });
      // 投诉通知优先查看回复，而不是跳到关联订单。
      const url = item.feedbackId
        ? '/projects/crun/pages/feedback/detail/feedback_detail?id=' + encodeURIComponent(item.feedbackId)
        : item.orderId ? '/projects/crun/pages/mail/my_detail/mail_my_detail?id=' + encodeURIComponent(item.orderId) : '';
      if (url) wx.navigateTo({ url });
    } catch (error) { if (this._visible) Ops.error(error); }
    finally { this._reading = false; }
  },
  bindMore() { if (this.data.tab === 'messages' && this.data.hasMore && !this.data.loading) return this.load(false); },
  bindSubscribe() { Ops.subscribe(this.data.config || {}); }
});