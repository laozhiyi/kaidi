const ProjectBiz = require('../../../biz/project_biz.js');
const cloudHelper = require('../../../../../helper/cloud_helper.js');
const PassportBiz = require('../../../../../comm/biz/passport_biz.js');

// 积分商城：我的积分 + 可兑换 / 已兑换两个 Tab；积分明细放在「明细」弹层里。
// 商品目录与价格全部来自云端 point/items，客户端只展示，不能改价。
const PAGE_SIZE = 20;
const REASONS = { post_complete: '订单完成收货', invite_first_order: '邀请好友首单', redeem: '兑换商品' };
const PENDING_KEY = 'crun-point-redeem-pending';
const PENDING_TTL = 10 * 60 * 1000;
// 商品图标只认本地图片，不使用服务端返回的路径。
const ICONS = { print: '/projects/crun/images/mall/print.svg', sto: '/projects/crun/images/mall/sto.svg', official: '/projects/crun/images/mall/official.svg' };
const iconOf = key => ICONS[key] ? { iconKey: key, iconSrc: ICONS[key] } : { iconKey: 'default', iconSrc: '' };
const decorateVoucher = voucher => voucher ? { ...voucher, ...iconOf(voucher.icon) } : voucher;
const newRequestId = () => 'point_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);

function decorate(items, points) {
  return (items || []).map(item => {
    const cost = Number(item.cost) || 0;
    const lack = Math.max(0, cost - points);
    return { id: item.id, name: item.name, cost, disabled: lack > 0, lack, icon: item.icon, hint: item.hint || '', ...iconOf(item.icon) };
  });
}

Page({
  data: {
    isLoad: false, loading: false, error: '', points: 0, tab: 'shop',
    items: [], vouchers: [], voucherPage: 0, voucherMore: false, voucherLoading: false, voucherLoaded: false,
    logs: [], page: 0, hasMore: false, logsVisible: false,
    voucherVisible: false, voucher: null, redeeming: false, using: false
  },
  onLoad() {
    ProjectBiz.initPage(this);
    if (wx.setNavigationBarTitle) wx.setNavigationBarTitle({ title: '积分商城' });
  },
  onShow() {
    this._visible = true;
    return this.refresh();
  },
  onHide() { this._visible = false; },
  onUnload() { this.onHide(); },
  async onPullDownRefresh() { try { await this.refresh(); } finally { wx.stopPullDownRefresh(); } },
  onReachBottom() {
    if (this.data.tab === 'done' && !this.data.logsVisible) return this.loadVouchers(false);
  },
  async refresh() {
    if (!PassportBiz.isLogin()) { this.setData({ isLoad: true }); return; }
    await this.loadItems();
    if (this.data.tab === 'done') await this.loadVouchers(true);
  },
  async loadItems() {
    this.setData({ loading: true, error: '' });
    try {
      const result = await cloudHelper.callCloudData('point/items', {}, { hint: false });
      if (!this._visible) return;
      if (!result || !Array.isArray(result.items)) throw new Error('商品加载失败');
      const points = Number(result.points) || 0;
      this.setData({ points, items: decorate(result.items, points), isLoad: true });
    } catch (error) {
      if (this._visible) this.setData({ error: '商品加载失败，请下拉重试', isLoad: true });
    } finally {
      this.setData({ loading: false });
    }
  },
  bindTab(e) {
    const tab = e.currentTarget.dataset.tab === 'done' ? 'done' : 'shop';
    if (tab === this.data.tab) return;
    this.setData({ tab });
    if (tab === 'done') this.loadVouchers(true);
  },
  async loadVouchers(reset = true) {
    if (this._voucherBusy) return;
    if (!reset && !this.data.voucherMore) return;
    if (!PassportBiz.isLogin()) return;
    this._voucherBusy = true;
    const page = reset ? 1 : this.data.voucherPage + 1;
    this.setData({ voucherLoading: true });
    try {
      const result = await cloudHelper.callCloudData('point/vouchers', { page, size: PAGE_SIZE }, { hint: false });
      if (!this._visible) return;
      if (!result || !Array.isArray(result.list)) throw new Error('已兑换加载失败');
      this.setData({
        vouchers: (reset ? [] : this.data.vouchers).concat(result.list.map(decorateVoucher)),
        voucherPage: page, voucherMore: !!result.hasMore, voucherLoaded: true
      });
    } catch (error) {
      if (this._visible) this.setData({ error: '已兑换加载失败，请下拉重试', voucherLoaded: true });
    } finally {
      this._voucherBusy = false;
      this.setData({ voucherLoading: false });
    }
  },
  bindMoreVouchers() { return this.loadVouchers(false); },
  // 同一件商品的重试沿用同一个 requestId：网络超时后再点一次不会重复扣分。
  _requestFor(itemId) {
    const saved = wx.getStorageSync(PENDING_KEY);
    if (saved && saved.itemId === itemId && saved.requestId && Date.now() - saved.at < PENDING_TTL) return saved.requestId;
    const pending = { itemId, requestId: newRequestId(), at: Date.now() };
    wx.setStorageSync(PENDING_KEY, pending);
    return pending.requestId;
  },
  bindRedeemTap(e) {
    if (this.data.redeeming) return;
    const item = this.data.items.find(entry => entry.id === e.currentTarget.dataset.id);
    if (!item) return;
    if (item.disabled) return wx.showToast({ title: '还差 ' + item.lack + ' 积分', icon: 'none' });
    wx.showModal({
      title: '兑换确认', content: '消耗 ' + item.cost + ' 积分兑换' + item.name + '？', confirmText: '兑换',
      success: result => { if (result.confirm) this._redeem(item); }
    });
  },
  async _redeem(item) {
    if (this.data.redeeming) return;
    this.setData({ redeeming: true });
    wx.showLoading({ title: '兑换中', mask: true });
    try {
      const result = await cloudHelper.callCloudSumbit('point/redeem', { itemId: item.id, requestId: this._requestFor(item.id) }, { hint: false });
      const voucher = decorateVoucher(result && result.data);
      if (!voucher || !voucher.code) throw Object.assign(new Error('兑换结果未确认'), { retryable: true });
      wx.removeStorageSync(PENDING_KEY);
      const points = Number(voucher.points) || 0;
      // 兑换成功后切到「已兑换」并直接弹出这张券。
      this.setData({ points, items: decorate(this.data.items, points), tab: 'done', voucher, voucherVisible: true });
      wx.hideLoading();
      this.loadVouchers(true);
    } catch (error) {
      wx.hideLoading();
      const definite = error && typeof error.code === 'number' && !error.retryable;
      if (definite) wx.removeStorageSync(PENDING_KEY);
      wx.showModal({
        title: '兑换失败', showCancel: false,
        content: definite ? (error.msg || error.message || '兑换失败') : '网络不稳定，结果未确认。请稍后再点一次兑换，不会重复扣分。'
      });
      if (definite) this.loadItems();
    } finally {
      this.setData({ redeeming: false });
    }
  },
  bindViewVoucher(e) {
    const voucher = this.data.vouchers.find(entry => entry.id === e.currentTarget.dataset.id);
    if (voucher) this.setData({ voucher, voucherVisible: true });
  },
  bindCloseVoucher() { this.setData({ voucherVisible: false }); },
  // 核销：本人当面点击，核销后不能撤销。
  bindUseVoucher() {
    const voucher = this.data.voucher;
    if (!voucher || voucher.status === 'used' || this.data.using) return;
    wx.showModal({
      title: '确认核销', content: '核销后此券即视为已使用，不能撤销。请在使用时当面点击。', confirmText: '确认核销',
      success: result => { if (result.confirm) this._useVoucher(voucher.id); }
    });
  },
  async _useVoucher(id) {
    if (this.data.using) return;
    this.setData({ using: true });
    try {
      const result = await cloudHelper.callCloudSumbit('point/use', { id }, { hint: false });
      const used = decorateVoucher(result && result.data);
      if (!used || used.status !== 'used') throw new Error('核销结果未确认');
      const vouchers = this.data.vouchers.map(entry => entry.id === id ? used : entry);
      const patch = { vouchers };
      if (this.data.voucher && this.data.voucher.id === id) patch.voucher = used;
      this.setData(patch);
      wx.showToast({ title: used.alreadyUsed ? '此券已核销过' : '已核销', icon: used.alreadyUsed ? 'none' : 'success' });
    } catch (error) {
      wx.showModal({ title: '核销失败', showCancel: false, content: (error && (error.msg || error.message)) || '网络不稳定，请稍后重试' });
    } finally {
      this.setData({ using: false });
    }
  },
  bindCopyCode() {
    const code = this.data.voucher && this.data.voucher.code;
    if (!code) return;
    wx.setClipboardData({ data: code, success: () => wx.showToast({ title: '已复制券码', icon: 'success' }),
      fail: () => wx.showToast({ title: '复制失败，请重试', icon: 'none' }) });
  },
  noop() {},
  bindOpenLogs() {
    this.setData({ logsVisible: true });
    if (!this.data.logs.length) this.loadLogs(true);
  },
  bindCloseLogs() { this.setData({ logsVisible: false }); },
  bindMoreLogs() { return this.loadLogs(false); },
  async loadLogs(reset = true) {
    if (this._logBusy) return;
    if (!reset && !this.data.hasMore) return;
    if (!PassportBiz.isLogin()) return;
    this._logBusy = true;
    const page = reset ? 1 : Number(this.data.page) + 1;
    this.setData({ loading: true });
    try {
      const result = await cloudHelper.callCloudData('point/my', { page, size: PAGE_SIZE }, { hint: false });
      if (!result) throw new Error('积分明细加载失败');
      const list = (Array.isArray(result.list) ? result.list : []).map(item => {
        const change = Number(item.change) || 0;
        return {
          id: item.id,
          reasonText: item.reasonText || REASONS[item.reason] || '积分变动',
          at: item.at || '',
          change,
          changeText: (change > 0 ? '+' : '') + change
        };
      });
      this.setData({ logs: reset ? list : this.data.logs.concat(list), page, hasMore: !!result.hasMore });
    } catch (error) {
      wx.showToast({ title: '积分明细加载失败', icon: 'none' });
    } finally {
      this._logBusy = false;
      this.setData({ loading: false });
    }
  }
});
