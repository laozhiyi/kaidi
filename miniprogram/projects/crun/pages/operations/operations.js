const Ops = require('../../biz/operations_biz.js');
const Notifications = require('../../biz/notification_biz.js');
const ProjectBiz = require('../../biz/project_biz.js');
const Passport = require('../../../../comm/biz/passport_biz.js');
function notificationTime(value) {
  const timestamp = typeof value === 'number' || /^\d+$/.test(String(value)) ? Number(value) : Date.parse(value);
  const date = new Date(timestamp + 8 * 3600000);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 16).replace('T', ' ') : '时间未知';
}

Page({
  data: {
    loading: false, error: false, config: null,
    list: [], page: 0, hasMore: false, nextCursor: null, unreadOnly: false,
    unreadCount: 0, summaryLoaded: false, summaryError: false, hasUpdates: false, markingAll: false
  },
  onLoad() { ProjectBiz.initPage(this); wx.setNavigationBarTitle({ title: '消息中心' }); },
  async onShow() {
    this._visible = true;
    if (!await Passport.loginMustBackWin(this) || !this._visible) return;
    if (this._stopMessages) this._stopMessages();
    this._stopMessages = Notifications.subscribe(summary => {
      const changed = this._summarySignature && summary.signature && summary.signature !== this._summarySignature;
      this._summarySignature = summary.signature;
      this.setData({ unreadCount: summary.unreadCount, summaryLoaded: summary.loaded, summaryError: summary.error,
        ...(changed && this.data.page > 0 ? { hasUpdates: true } : {}) });
    });
    Notifications.refresh(true);
    await this.load(true);
  },
  onHide() {
    this._visible = false; this._seq = (this._seq || 0) + 1; this._readSequence = (this._readSequence || 0) + 1;
    this._reading = false;
    if (this._stopMessages) this._stopMessages(); this._stopMessages = null;
    this.setData({ loading: false });
  },
  onUnload() { this._unloaded = true; this.onHide(); },
  async onPullDownRefresh() {
    try { await Promise.all([this.load(true), Notifications.refresh(true)]); } finally { wx.stopPullDownRefresh(); }
  },
  onReachBottom() { return this.bindMore(); },
  async load(reset = true) {
    if (typeof reset !== 'boolean') reset = true;
    if (!this._visible || !reset && (this.data.loading || !this.data.hasMore)) return;
    const seq = this._seq = (this._seq || 0) + 1;
    const page = reset ? 1 : this.data.page + 1;
    this.setData({ loading: true, error: false });
    try {
      if (reset) this._loadConfig();
      const params = { page, unreadOnly: this.data.unreadOnly };
      if (!reset && this.data.nextCursor) params.cursor = this.data.nextCursor;
      const result = await Ops.get('operations/notifications', params);
      if (!this._visible || seq !== this._seq) return;
      if (!result || !Array.isArray(result.list)) throw new Error('消息加载失败');
      const incoming = result.list.map(item => ({ ...item, key: item.key || (item.kind || 'notification') + ':' + item._id,
        time: notificationTime(item.createdAt),
        category: item.newsId || item.kind === 'news' ? '校园公告' : item.reputation ? '信誉分通知' : item.feedbackId ? '申诉处理' : item.orderId ? '订单动态' : '系统通知'
      }));
      const list = reset ? incoming : Array.from(new Map(this.data.list.concat(incoming).map(item => [item.key, item])).values());
      this.setData({ list, page, hasMore: !!result.hasMore, nextCursor: result.nextCursor || null, loading: false, hasUpdates: false });
    } catch (error) {
      if (this._visible && seq === this._seq) this.setData({ loading: false, error: true });
    }
  },
  _loadConfig() {
    if (this._configRequest) return;
    this._configRequest = Ops.get('operations/config').then(config => {
      if (this._visible) this.setData({ config });
    }).catch(() => { if (this._visible) this.setData({ config: null }); })
      .finally(() => { this._configRequest = null; });
  },
  bindUnreadFilter() {
    if (this.data.markingAll) return;
    this.setData({ unreadOnly: !this.data.unreadOnly, list: [], page: 0, nextCursor: null, hasMore: false });
    return this.load(true);
  },
  async bindRead(e) {
    const data = e.currentTarget.dataset;
    const item = this.data.list.find(row => data.key ? row.key === data.key : row._id === data.id);
    if (!item || this._reading || this.data.markingAll) return;
    this._reading = true;
    const sequence = this._readSequence = (this._readSequence || 0) + 1;
    const url = Notifications.messageUrl(item);
    if (url) {
      // The destination acknowledges only after its detail has loaded and rendered.
      wx.navigateTo({ url,
        fail: () => wx.showToast({ title: '页面打开失败，请重试', icon: 'none' }),
        complete: () => { if (sequence === this._readSequence) this._reading = false; }
      });
      return;
    }
    try {
      const viewed = await new Promise(resolve => wx.showModal({ title: item.title, content: item.content || '暂无补充内容',
        showCancel: false, confirmText: '我知道了', success: () => resolve(true), fail: () => resolve(false) }));
      if (!viewed || !this._visible || sequence !== this._readSequence) return;
      await Notifications.markRead(item._id, item.kind || 'notification');
      if (this._visible && sequence === this._readSequence) this.setData({ list: this.data.unreadOnly
        ? this.data.list.filter(row => row._id !== item._id || row.kind !== item.kind)
        : this.data.list.map(row => row._id === item._id && row.kind === item.kind ? { ...row, read: true } : row) });
    } catch (error) { if (this._visible) Ops.error(error); }
    finally { if (sequence === this._readSequence) this._reading = false; }
  },
  async bindReadAll() {
    if (this.data.markingAll || this._reading || !this.data.unreadCount) return;
    this.setData({ markingAll: true });
    try {
      await Notifications.markAllRead();
      if (this._visible) { await this.load(true); wx.showToast({ title: '已更新已读状态', icon: 'success' }); }
    } catch (error) { if (this._visible) Ops.error(error); }
    finally { if (!this._unloaded) this.setData({ markingAll: false }); }
  },
  bindRefreshMessages() { Notifications.refresh(true); return this.load(true); },
  bindMore() { if (this.data.hasMore && !this.data.loading) return this.load(false); },
  async bindSubscribe() {
    if (this.data.subscribing) return;
    this.setData({ subscribing: true });
    try {
      const result = await Ops.subscribe(this.data.config || {});
      const titles = { subscribed: '订阅成功', declined: '已取消订阅', unavailable: '暂未开通微信提醒', failed: '订阅失败，请重试' };
      if (this._visible) wx.showToast({ title: titles[result] || '请在微信中确认订阅', icon: result === 'subscribed' ? 'success' : 'none' });
    } finally { if (this._visible) this.setData({ subscribing: false }); }
  }
});
