const Ops = require('../../../../biz/operations_biz.js');
const UI = require('../../../../biz/admin_console_biz.js');

Page({
  data: { loading: true, error: '', overview: null, config: null, configError: false, dateText: '', admin: null, serviceUnread: 0, serviceFeedback: 0, servicePending: 0 },
  onLoad() {
    if (!UI.start(this)) return;
    this.setData({ dateText: UI.time(Date.now()).slice(0, 10) });
    return this.load();
  },
  onShow() { const reload = this._visible === false; this._visible = true; if (reload && UI.authorize(this)) return this.load(); },
  onHide() { UI.hide(this); },
  onUnload() { this._unloaded = true; UI.hide(this); },
  async onPullDownRefresh() { try { await this.load(); } finally { wx.stopPullDownRefresh(); } },
  async load() {
    if (!UI.authorize(this)) return;
    // 客服能接待咨询、处理投诉与订单履约，运营汇总数据仍只给管理员。
    if (this.data.isServiceAdmin) return this._loadServiceBadge();
    const seq = this._seq = (this._seq || 0) + 1;
    this.setData({ loading: true, error: '', configError: false });
    const overview = Ops.get('admin/operations_overview').then(data => {
      if (this._visible && seq === this._seq) this.setData({ overview: UI.summary(data) });
    }).catch(error => { if (this._visible && seq === this._seq) this.setData({ error: UI.message(error) }); })
      .finally(() => { if (this._visible && seq === this._seq) this.setData({ loading: false }); });
    const config = Ops.get('admin/operations_config').then(data => {
      if (this._visible && seq === this._seq) this.setData({ config: data });
    }).catch(() => { if (this._visible && seq === this._seq) this.setData({ configError: true }); });
    return Promise.allSettled([overview, config]);
  },
  /** 客服工作台：待回复会话、待处理投诉与待审核用户。 */
  async _loadServiceBadge() {
    const [badge, feedback, pending] = await Promise.allSettled([
      Ops.get('admin/customer_service_badge'),
      Ops.get('admin/feedback_list', { status: 0, page: 1 }),
      Ops.get('admin/user_list', { sortType: 'status', sortVal: 0, page: 1, size: 1 })
    ]);
    if (!this._visible || this._unloaded) return;
    this.setData({
      loading: false,
      serviceUnread: badge.status === 'fulfilled' ? Number(badge.value && badge.value.unread) || 0 : 0,
      serviceFeedback: feedback.status === 'fulfilled' ? Number(feedback.value && feedback.value.total) || 0 : 0,
      servicePending: pending.status === 'fulfilled' ? Number(pending.value && pending.value.total) || 0 : 0
    });
  },
  bindNavigate(e) {
    const { key, status, overdue } = e.currentTarget.dataset;
    return UI.go(key, { status, overdue });
  }
});
