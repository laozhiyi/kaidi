const Ops = require('../../../biz/operations_biz.js');
const Admin = require('../../../../../comm/biz/admin_biz.js');
const TABS = [
  { id: 'overview', text: '概况' }, { id: 'orders', text: '订单' },
  { id: 'feedback', text: '投诉' }, { id: 'config', text: '配置' }
];
Page({
  data: {
    tab: 'overview', tabs: TABS, list: [], page: 0, hasMore: false,
    loading: false, detailLoading: false, error: false, busy: false,
    detail: null, note: '', overview: null, config: null, statusIndex: 0,
    statuses: ['全部', '待接单', '已接单', '已取件', '待收货', '异常中', '已完成', '已取消'],
    resolutionIndex: 0, resolutions: ['恢复原流程', '取消订单', '确认完成'], campusText: '',
    fields: [
      { key: 'smallPrice', label: '小件价格', unit: '元', type: 'digit' },
      { key: 'mediumPrice', label: '中件价格', unit: '元', type: 'digit' },
      { key: 'largePrice', label: '大件价格', unit: '元', type: 'digit' },
      { key: 'maxPackages', label: '每单最多件数', unit: '件', type: 'number' },
      { key: 'maxActiveOrders', label: '骑手同时接单上限', unit: '单', type: 'number' },
      { key: 'maxOpenOrders', label: '每人未结束发布单上限', unit: '单', type: 'number' },
      { key: 'deliveryMinutes', label: '普通单时效', unit: '分钟', type: 'number' },
      { key: 'urgentMinutes', label: '加急单时效', unit: '分钟', type: 'number' },
      { key: 'openHour', label: '营业开始整点', unit: '时', type: 'number' },
      { key: 'closeHour', label: '营业结束整点', unit: '时', type: 'number' }
    ]
  },
  onLoad(options = {}) {
    this._unloaded = false;
    if (Admin.isAdmin(this) !== true) return;
    this.setData({ tab: TABS.some(x => x.id === options.tab) ? options.tab : 'overview' });
    this._visible = true;
    return this.load(true);
  },
  onShow() {
    const reload = this._visible === false;
    this._visible = true;
    if (reload) { this.setData({ detail: null, note: '', detailLoading: false }); this.load(true); }
  },
  onHide() {
    this._visible = false;
    this._seq = (this._seq || 0) + 1;
    this._detailSeq = (this._detailSeq || 0) + 1;
  },
  onUnload() { this._unloaded = true; this.onHide(); },
  onPageScroll(e) { if (!this.data.detail) this._listScrollTop = e.scrollTop; },
  onReachBottom() { this.bindMore(); },
  async onPullDownRefresh() {
    try { if (!this.data.busy && !this.data.detail) await this.load(true); }
    finally { wx.stopPullDownRefresh(); }
  },
  async load(reset = true) {
    if (Admin.isAdmin(this) !== true) return;
    if (typeof reset !== 'boolean') reset = true;
    if (!reset && (this.data.loading || !this.data.hasMore)) return;
    const seq = this._seq = (this._seq || 0) + 1;
    const tab = this.data.tab, page = reset ? 1 : this.data.page + 1;
    this.setData({ loading: true, error: false });
    try {
      let result;
      if (tab === 'overview') {
        result = await Ops.get('admin/operations_overview');
        if (this._visible && seq === this._seq) this.setData({ overview: result });
      } else if (tab === 'config') {
        result = await Ops.get('admin/operations_config');
        if (this._visible && seq === this._seq) this.setData({ config: result, campusText: result.campuses.join('\n') });
      } else {
        const route = { orders: 'admin/operations_orders', feedback: 'admin/feedback_list' }[tab];
        const params = { page };
        if (tab === 'orders' && this.data.statusIndex > 0) params.status = [-1, 0, 1, 4, 2, 3, 9, 99][this.data.statusIndex];
        result = await Ops.get(route, params);
        if (this._visible && seq === this._seq) this.setData({
          list: reset ? result.list : this.data.list.concat(result.list), hasMore: !!result.hasMore, page
        });
      }
    } catch (error) {
      if (this._visible && seq === this._seq) { this.setData({ error: true }); Ops.error(error); }
    } finally { if (this._visible && seq === this._seq) this.setData({ loading: false }); }
  },
  bindTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (this.data.busy || tab === this.data.tab || !TABS.some(x => x.id === tab)) return;
    this._detailSeq = (this._detailSeq || 0) + 1;
    this.setData({ tab, detail: null, detailLoading: false, note: '', list: [], page: 0, hasMore: false });
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
    return this.load(true);
  },
  bindFilter(e) {
    if (this.data.busy) return;
    this._detailSeq = (this._detailSeq || 0) + 1;
    this.setData({ statusIndex: Number(e.detail.value), detail: null, detailLoading: false, list: [], hasMore: false });
    return this.load(true);
  },
  bindMore() { if (!this.data.detail && !this.data.loading && this.data.hasMore) return this.load(false); },
  async bindDetail(e) {
    if (this.data.busy) return;
    const id = e.currentTarget.dataset.id;
    const seq = this._detailSeq = (this._detailSeq || 0) + 1, tab = this.data.tab;
    this.setData({ detailLoading: true });
    try {
      let detail = this.data.list.find(x => x._id === id);
      if (tab === 'orders') detail = await Ops.get('admin/operations_order', { id });
      if (tab === 'feedback') detail = await Ops.get('admin/feedback_detail', { id });
      if (!this._visible || seq !== this._detailSeq || tab !== this.data.tab) return;
      if (!detail) throw new Error('记录不存在或已更新，请刷新列表');
      this.setData({ detail, note: '', resolutionIndex: 0 });
      wx.pageScrollTo({ scrollTop: 0, duration: 0 });
    } catch (error) { if (this._visible && seq === this._detailSeq) Ops.error(error); }
    finally { if (this._visible && seq === this._detailSeq) this.setData({ detailLoading: false }); }
  },
  bindClose() {
    if (this.data.busy) return;
    this._detailSeq = (this._detailSeq || 0) + 1;
    const scrollTop = this._listScrollTop || 0;
    this.setData({ detail: null, detailLoading: false, note: '' }, () => wx.pageScrollTo({ scrollTop, duration: 0 }));
  },
  bindNote(e) { this.setData({ note: e.detail.value }); },
  bindResolution(e) { this.setData({ resolutionIndex: Number(e.detail.value) }); },
  async bindProcess(e) {
    if (this.data.busy || !this.data.detail) return;
    const tab = this.data.tab, detail = this.data.detail, note = this.data.note.trim();
    if (!note) { Ops.error(new Error('请填写处理依据或审核说明')); return; }
    this.setData({ busy: true });
    try {
      if (tab === 'orders') {
        if (detail.MAIL_STATUS === 3) await Ops.command('admin/operations_resolve', {
          id: detail._id, note, resolution: ['resume', 'cancel', 'complete'][this.data.resolutionIndex]
        });
        else await Ops.command('admin/operations_hold', { id: detail._id, note });
      } else if (tab === 'feedback') await Ops.command('admin/feedback_reply', {
        id: detail._id, reply: note, version: detail.FB_VERSION || 0, status: Number(e.currentTarget.dataset.status)
      });
      if (this._visible) {
        this.setData({ detail: null, note: '' });
        await this.load(true);
        wx.showToast({ title: '处理成功' });
      }
    } catch (error) { if (this._visible) Ops.error(error); }
    finally { if (!this._unloaded) this.setData({ busy: false }); }
  },
  bindConfigNumber(e) {
    const key = e.currentTarget.dataset.key;
    // 保留输入中的小数点和空值，提交时再转换，避免输入 1.5 被中途改成 15。
    if (this.data.isSuperAdmin && !this.data.busy && this.data.fields.some(x => x.key === key)) this.setData({ ['config.' + key]: e.detail.value });
  },
  bindConfigSwitch(e) {
    const key = e.currentTarget.dataset.key;
    if (this.data.isSuperAdmin && !this.data.busy && ['enabled', 'registrationReview', 'urgentEnabled'].includes(key)) this.setData({ ['config.' + key]: !!e.detail.value });
  },
  bindCampuses(e) { if (this.data.isSuperAdmin && !this.data.busy) this.setData({ campusText: e.detail.value }); },
  bindNotice(e) { if (this.data.isSuperAdmin && !this.data.busy) this.setData({ 'config.offlineNotice': e.detail.value }); },
  async bindSave() {
    if (this.data.busy || !this.data.config || !this.data.isSuperAdmin) return;
    const value = { ...this.data.config, campuses: this.data.campusText.split('\n').map(x => x.trim()).filter(Boolean) };
    for (const field of this.data.fields) {
      if (String(value[field.key]).trim() === '' || !Number.isFinite(Number(value[field.key]))) {
        Ops.error(new Error('请填写有效的' + field.label)); return;
      }
      value[field.key] = Number(value[field.key]);
    }
    this.setData({ busy: true });
    try {
      await Ops.get('admin/operations_config_save', { value });
      if (this._visible) { await this.load(true); wx.showToast({ title: '配置已保存' }); }
    } catch (error) { if (this._visible) Ops.error(error); }
    finally { if (!this._unloaded) this.setData({ busy: false }); }
  },
  async bindMaintain() {
    if (this.data.busy || !this.data.isSuperAdmin) return;
    this.setData({ busy: true });
    try {
      const result = await Ops.get('admin/operations_maintain');
      if (!this._visible) return;
      wx.showModal({ title: '维护完成', content: '关闭过期单 ' + result.expired + '；超时提醒 ' + result.overdue + '；处理通知 ' + result.notifications, showCancel: false });
      await this.load(true);
    } catch (error) { if (this._visible) Ops.error(error); }
    finally { if (!this._unloaded) this.setData({ busy: false }); }
  },
  bindExport() { wx.navigateTo({ url: '/projects/crun/pages/admin/mail/export/admin_mail_export' }); },
  bindImage(e) { const url = e.currentTarget.dataset.url; if (url) wx.previewImage({ urls: [url], current: url }); }
});
