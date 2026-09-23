const pageHelper = require('../../../../../helper/page_helper.js');
const ProjectBiz = require('../../../biz/project_biz.js');
const AdminBiz = require('../../../../../comm/biz/admin_biz.js');
const PassportBiz = require('../../../../../comm/biz/passport_biz.js');
const profileMethods = require('../profile_methods.js');
const InviteBiz = require('../../../biz/invite_biz.js');
const Notifications = require('../../../biz/notification_biz.js');
const accountActions = require('../account_actions.js');

Page(Object.assign({
  data: { user: null, hasSession: false, loggingOut: false, cancellingAccount: false, loading: false, userError: '', settingsVisible: false, unreadCount: 0, messageBadge: '' },
  onLoad() {
    ProjectBiz.initPage(this);
    this.setData({ hasSession: !!PassportBiz.getToken() });
    if (PassportBiz.getToken()) {
      const token = PassportBiz.getToken();
      this.setData({ user: { USER_NAME: token.name, USER_PIC: token.pic || '', USER_STATUS: token.status, USER_MOBILE_VERIFIED: token.phoneVerified, USER_PROFILE_COMPLETE: token.profileComplete, allowManualRegistration: token.allowManualRegistration } });
    }
  },
  async onShow() {
    this._visible = true;
    if (this._stopMessages) this._stopMessages();
    this._stopMessages = Notifications.subscribe(summary => this.setData({ unreadCount: summary.unreadCount, messageBadge: summary.badge }));
    const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null;
    if (tabBar) tabBar.setData({ selected: 2 });
    await PassportBiz.loginSilenceMust(this);
    if (!this._unloaded) this.setData({ hasSession: !!PassportBiz.getToken() });
    if (this._visible && PassportBiz.isLogin()) Notifications.refresh(true);
    if (!this._unloaded) await this._loadUser();
  },
  onHide() { this._visible = false; if (this._stopMessages) this._stopMessages(); this._stopMessages = null; this.setData({ settingsVisible: false }); },
  onUnload() { this._unloaded = true; this.onHide(); },
  _loadUser() {
    if (this._userRequest) return this._userRequest;
    this.setData({ loading: true, userError: '' });
    this._userRequest = (async () => {
      try {
        const user = await profileMethods.getProfileUser({ hint: false }, true);
        if (this._unloaded) return;
        this.setData({ user: user || null, hasSession: !!PassportBiz.getToken() });
        if (user && user.USER_STATUS === 1 && profileMethods.isProfileReady(user)) InviteBiz.acceptPending().catch(() => {});
      } catch (error) {
        if (!this._unloaded) this.setData({ userError: '资料加载失败，点击重试' });
      } finally {
        this._userRequest = null;
        if (!this._unloaded) this.setData({ loading: false });
      }
    })();
    return this._userRequest;
  },
  async onPullDownRefresh() {
    try { await Promise.all([this._loadUser(), Notifications.refresh(true)]); } finally { wx.stopPullDownRefresh(); }
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
  bindInviteTap() { return this._openUserPage('/projects/crun/pages/invite/index/invite_index'); },
  bindAboutTap() { wx.navigateTo({ url: '/projects/crun/pages/about/index/about_index' }); },
  bindCampusServiceTap() { wx.navigateTo({ url: '/projects/crun/pages/campus_service/list/campus_service_list' }); },
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
    return { title: 'GXNU校跑，便捷互助', path: '/projects/crun/pages/default/index/default_index' };
  }
}, accountActions));
