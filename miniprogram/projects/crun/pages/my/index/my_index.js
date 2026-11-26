const pageHelper = require('../../../../../helper/page_helper.js');
const cloudHelper = require('../../../../../helper/cloud_helper.js');
const ProjectBiz = require('../../../biz/project_biz.js');
const AdminBiz = require('../../../../../comm/biz/admin_biz.js');
const PassportBiz = require('../../../../../comm/biz/passport_biz.js');
const profileMethods = require('../profile_methods.js');
const InviteBiz = require('../../../biz/invite_biz.js');
const Notifications = require('../../../biz/notification_biz.js');
const accountActions = require('../account_actions.js');
const Ops = require('../../../biz/operations_biz.js');
const Agreements = require('../../../public/agreements.js');

function profileFromToken(token) {
  if (!token) return null;
  return {
    USER_NAME: token.name,
    USER_PIC: token.pic || '',
    USER_ROLE: token.role,
    USER_STATUS: token.status,
    USER_MOBILE_VERIFIED: token.phoneVerified,
    USER_PROFILE_COMPLETE: token.profileComplete,
    USER_AGREEMENTS: token.agreements,
    allowManualRegistration: token.allowManualRegistration,
    profilePhoneRequired: token.profilePhoneRequired
  };
}

Page(Object.assign({
  data: { user: null, hasSession: false, loggingOut: false, cancellingAccount: false, loading: false, userError: '', settingsVisible: false, unreadCount: 0, messageBadge: '', serviceBadge: '' },
  onLoad() {
    ProjectBiz.initPage(this);
    this._showSavedProfile();
  },
  _showSavedProfile() {
    const token = PassportBiz.getToken();
    this.setData({ user: profileFromToken(token), hasSession: !!token, agreementsCurrent: Agreements.currentUser(token && token.agreements) });
  },
  async onShow() {
    this._visible = true;
    const visit = this._visit = (this._visit || 0) + 1;
    // Saving updates the session snapshot before returning to this tab.
    this._userRequest = null;
    this._showSavedProfile();
    if (this._stopMessages) this._stopMessages();
    this._stopMessages = Notifications.subscribe(summary => this.setData({ unreadCount: summary.unreadCount, messageBadge: summary.badge }));
    const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null;
    if (tabBar) tabBar.setData({ selected: 2 });
    await PassportBiz.loginSilenceMust(this);
    if (this._unloaded || !this._visible || this._visit !== visit) return;
    this._showSavedProfile();
    this._loadServiceBadge();
    if (PassportBiz.isLogin()) Notifications.refresh(true);
    await this._loadUser();
  },
  onHide() { this._visible = false; if (this._stopMessages) this._stopMessages(); this._stopMessages = null; this.setData({ settingsVisible: false }); },
  onUnload() { this._unloaded = true; this.onHide(); },
  _loadUser() {
    if (this._userRequest) return this._userRequest;
    const credential = PassportBiz.getToken()?.sessionToken;
    const scope = cloudHelper.scopeKey?.();
    this.setData({ loading: true, userError: '' });
    const isCurrent = () => !this._unloaded && this._userRequest === request;
    const sameSession = token => token?.sessionToken === credential && cloudHelper.scopeKey?.() === scope;
    const request = Promise.resolve().then(() => profileMethods.getProfileUser({ hint: false }, true)).then(user => {
      if (!isCurrent()) return;
      const token = PassportBiz.getToken();
      if (!token || !sameSession(token) || !user) {
        this._showSavedProfile();
        return;
      }
      this.setData({ user, hasSession: true, agreementsCurrent: Agreements.currentUser(user.USER_AGREEMENTS) });
      if (user.USER_STATUS === 1 && profileMethods.isProfileReady(user)) InviteBiz.acceptPending().catch(() => {});
    }).catch(() => {
      if (!isCurrent()) return;
      const token = PassportBiz.getToken();
      if (!token || !sameSession(token)) this._showSavedProfile();
      else this.setData({ userError: '资料加载失败，点击重试' });
    }).finally(() => {
      if (!isCurrent()) return;
      this._userRequest = null;
      this.setData({ loading: false });
    });
    this._userRequest = request;
    return request;
  },
  async onPullDownRefresh() {
    try { await Promise.all([this._loadUser(), Notifications.refresh(true), this._loadServiceBadge()]); } finally { wx.stopPullDownRefresh(); }
  },
  // 客服回复的红点：只取未读数，不拉消息体，失败静默。
  async _loadServiceBadge() {
    const token = PassportBiz.getToken();
    if (!token || !token.id || token.status === 9) {
      if (!this._unloaded) this.setData({ serviceBadge: '' });
      return;
    }
    try {
      const res = await cloudHelper.callCloud('customer_service/badge', {}, { hint: false });
      const unread = Number(res && res.data && res.data.unread) || 0;
      if (!this._unloaded && this._visible) this.setData({ serviceBadge: unread > 99 ? '99+' : unread ? String(unread) : '' });
    } catch (_) { }
  },
  async _openUserPage(url) {
    if (this._openingPage) return;
    this._openingPage = true;
    try {
      if (!await PassportBiz.loginMustCancelWin(this) || this._unloaded) return;
      wx.navigateTo({ url, fail: () => pageHelper.showNoneToast('页面打开失败，请重试') });
    } catch (error) {
      pageHelper.showNoneToast('暂时无法打开，请稍后重试');
    } finally { this._openingPage = false; }
  },
  url(e) { pageHelper.url(e, this); },
  bindMyFeedbackTap() { return this._openUserPage('/projects/crun/pages/feedback/my_list/feedback_my_list'); },
  bindMyReviewTap() { return this._openUserPage('/projects/crun/pages/my/review/my_review'); },
  bindMyFavTap() { return this._openUserPage('/projects/crun/pages/my/fav/my_fav'); },
  bindMyReputationTap() { return this._openUserPage('/projects/crun/pages/my/reputation/my_reputation'); },
  bindMessagesTap() { return this._openUserPage('/projects/crun/pages/operations/operations'); },
  bindFeedbackTap() { return this._openUserPage('/projects/crun/pages/feedback/index/feedback_index'); },
  bindProfileContactTap() { return this._openUserPage('/projects/crun/pages/my/contact/contact'); },
  bindProfileAddressTap() { return this._openUserPage('/projects/crun/pages/my/address/address'); },
  bindUpdateAgreementsTap() { return this._openUserPage('/projects/crun/pages/my/personal/my_personal'); },
  bindAgreementsTap() {
    const titles=['用户服务协议','骑手服务与结算协议','隐私政策','实名与结算信息处理说明'];
    wx.showActionSheet({itemList:titles,success:r=>{const key=['user','rider','privacy','identity'][r.tapIndex];if(key)wx.navigateTo({url:'/projects/crun/pages/about/agreement/about_agreement?key='+key});}});
  },
  bindInviteTap() { return this._openUserPage('/projects/crun/pages/invite/index/invite_index'); },
  async bindSettlementTap() {
    if (this._openingSettlement) return;
    this._openingSettlement = true;
    try {
      if (!await PassportBiz.loginMustCancelWin(this) || this._unloaded || !this._visible) return;
      const visit = this._visit;
      const credential = PassportBiz.getToken()?.sessionToken;
      const scope = cloudHelper.scopeKey?.();
      const isCurrent = () => !this._unloaded && this._visible && this._visit === visit
        && PassportBiz.getToken()?.sessionToken === credential && cloudHelper.scopeKey?.() === scope;
      const account = await Ops.get('settlement/status');
      if (!isCurrent()) return;
      if (!account || typeof account.opened !== 'boolean') throw new Error('INVALID_SETTLEMENT_STATUS');
      if (!account.opened) {
        const result = await new Promise(resolve => wx.showModal({
          title: '申请跑腿结算',
          content: '是否确定申请成为跑腿？',
          confirmText: '确认申请',
          cancelText: '暂不申请',
          success: resolve,
          fail: () => resolve({ confirm: false })
        }));
        if (!result.confirm || !isCurrent()) return;
      }
      wx.navigateTo({
        url: '/projects/crun/pages/my/settlement/settlement',
        fail: () => pageHelper.showNoneToast('页面打开失败，请重试')
      });
    } catch (_) {
      if (!this._unloaded && this._visible) pageHelper.showNoneToast('结算状态查询失败，请稍后重试');
    } finally { this._openingSettlement = false; }
  },
  bindWalletTap() { return this._openUserPage('/projects/crun/pages/my/wallet/wallet'); },
  bindAboutTap() { wx.navigateTo({ url: '/projects/crun/pages/about/index/about_index' }); },
  bindCampusServiceTap() { require('../../../biz/customer_service_biz.js').openCustomerService(); },
  bindMyAcceptTap() {
    wx.setStorageSync('crun-order-tab', 1);
    wx.switchTab({ url: '/projects/crun/pages/order/index/order_index' });
  },
  bindMyPostTap() {
    wx.setStorageSync('crun-order-tab', 2);
    wx.switchTab({ url: '/projects/crun/pages/order/index/order_index' });
  },
  bindSetTap() { this.setData({ settingsVisible: true }); },
  bindCloseSettings() { this.setData({ settingsVisible: false }); },
  bindSettingsTouchMove() {},
  bindClearCacheTap() {
    try {
      profileMethods.clearLocalCaches();
      this.bindCloseSettings();
      pageHelper.showSuccToast('缓存已清除');
    } catch (error) { pageHelper.showNoneToast('缓存清除失败，请重试'); }
  },
  bindAdminTap() {
    this.bindCloseSettings();
    const url = AdminBiz.getAdminToken() ? '/projects/crun/pages/admin/index/home/admin_home' : '/projects/crun/pages/admin/index/login/admin_login';
    wx.navigateTo({ url });
  },
  onShareAppMessage() {
    return { title: '云速取，便捷互助', path: '/projects/crun/pages/default/index/default_index' };
  }
}, accountActions));
