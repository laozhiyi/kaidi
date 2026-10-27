const ProjectBiz = require('../../../biz/project_biz.js');
const cloudHelper = require('../../../../../helper/cloud_helper.js');
const PassportBiz = require('../../../../../comm/biz/passport_biz.js');

// 钱包：跑腿收益与邀请奖励两个账户。
// 跑腿收益：1 元起提，提现抽取 10% 服务费。
// 邀请奖励：每位好友注册成功 2 元，满 10 元可提现，不抽成。
const ACCOUNTS = {
  earn: { key: 'earn', name: '跑腿收益', min: 1, rate: 0.1, note: '每笔提现收取 10% 服务费，低于 1 元不可提现' },
  invite: { key: 'invite', name: '邀请奖励', min: 10, rate: 0, note: '好友注册成功每人 2 元，满 10 元可提现，不抽成' }
};
const money = value => (Math.round((Number(value) || 0) * 100) / 100).toFixed(2);

Page({
  data: {
    isLoad: false, account: 'earn', accountName: '跑腿收益', balance: '0.00', min: 1, rateLabel: '10%', ruleNote: ACCOUNTS.earn.note,
    inviteFriends: 0, inviteBalance: '0.00',
    sheet: false, amount: '', fee: '0.00', arrive: '0.00', error: ''
  },
  onLoad(options = {}) {
    ProjectBiz.initPage(this);
    const account = options.account === 'invite' ? 'invite' : 'earn';
    this.setData({ account });
    this._applyAccount(account);
  },
  onShow() {
    this._visible = true;
    if (!this.data.isLoad) this.load();
  },
  onHide() { this._visible = false; },
  onUnload() { this.onHide(); },
  async onPullDownRefresh() { try { await this.load(true); } finally { wx.stopPullDownRefresh(); } },
  _applyAccount(account) {
    const config = ACCOUNTS[account] || ACCOUNTS.earn;
    this.setData({
      account: config.key, accountName: config.name, min: config.min,
      rateLabel: config.rate ? Math.round(config.rate * 100) + '%' : '无抽成', ruleNote: config.note,
      balance: config.key === 'invite' ? this.data.inviteBalance : '0.00'
    });
  },
  async load(force) {
    if (this._loadingSafely) return;
    this._loadingSafely = true;
    try {
      if (!PassportBiz.isLogin()) { this.setData({ isLoad: true }); return; }
      const stat = await cloudHelper.callCloudData('invite/my_stat', {}, { hint: false }).catch(() => null);
      if (!this._visible && !force) return;
      const accepted = stat && Number.isFinite(Number(stat.accepted)) ? Number(stat.accepted) : 0;
      // 每位成功注册的好友 2 元邀请奖励。
      this.setData({ inviteFriends: accepted, inviteBalance: money(accepted * 2), isLoad: true });
      this._applyAccount(this.data.account);
    } finally { this._loadingSafely = false; }
  },
  bindSwitchAccount(e) {
    const account = e.currentTarget.dataset.account === 'invite' ? 'invite' : 'earn';
    if (account === this.data.account) return;
    this.setData({ sheet: false, amount: '', fee: '0.00', arrive: '0.00', error: '' });
    this._applyAccount(account);
  },
  bindOpenWithdraw() {
    const min = Number(this.data.min) || 1;
    if (Number(this.data.balance) < min) {
      return wx.showModal({
        title: '暂不可提现',
        content: '当前' + this.data.accountName + '为 ¥' + this.data.balance + '，低于最低提现金额 ¥' + money(min) + '，暂时不能提现。',
        showCancel: false, confirmText: '我知道了'
      });
    }
    if (typeof wx.hideKeyboard === 'function') wx.hideKeyboard();
    this.setData({ sheet: true, amount: '', fee: '0.00', arrive: '0.00', error: '' });
  },
  bindCloseSheet() { if (!this._submitting) this.setData({ sheet: false, error: '' }); },
  bindAmountInput(e) {
    const amount = String(e.detail.value || '').replace(/[^\d.]/g, '').replace(/^(\d*\.?\d{0,2}).*$/, '$1');
    this.setData({ amount, ...this._calc(amount) });
  },
  bindAllAmount() {
    const amount = money(this.data.balance);
    this.setData({ amount, ...this._calc(amount) });
  },
  _calc(amount) {
    const value = Number(amount) || 0;
    const rate = ACCOUNTS[this.data.account] ? ACCOUNTS[this.data.account].rate : 0;
    const fee = Math.round(value * rate * 100) / 100;
    return { fee: money(fee), arrive: money(Math.max(0, value - fee)), error: '' };
  },
  bindSubmitWithdraw() {
    if (this._submitting) return;
    const value = Number(this.data.amount) || 0;
    const min = Number(this.data.min) || 1;
    const balance = Number(this.data.balance) || 0;
    if (!value) return this.setData({ error: '请输入提现金额' });
    if (value < min) return this.setData({ error: '最低提现金额为 ¥' + money(min) });
    if (value > balance) return this.setData({ error: '提现金额不能超过可提现余额 ¥' + money(balance) });
    this._submitting = true;
    wx.showModal({
      title: '确认提现',
      content: '提现 ¥' + money(value) + (Number(this.data.fee) > 0 ? '，扣除服务费 ¥' + this.data.fee : '') + '，实际到账 ¥' + this.data.arrive + '。将在 1-3 个工作日内处理。',
      confirmText: '确认提现', cancelText: '再想想',
      success: res => {
        if (!res.confirm) { this._submitting = false; return; }
        this.setData({ sheet: false, amount: '', fee: '0.00', arrive: '0.00', error: '' });
        wx.showToast({ title: '提现申请已提交', icon: 'success' });
        this._submitting = false;
      },
      fail: () => { this._submitting = false; }
    });
  }
});
