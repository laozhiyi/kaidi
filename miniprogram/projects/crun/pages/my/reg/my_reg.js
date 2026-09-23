const ProjectBiz = require('../../../biz/project_biz.js');
const InviteBiz = require('../../../biz/invite_biz.js');
const PassportBiz = require('../../../../../comm/biz/passport_biz.js');
const profileMethods = require('../profile_methods.js');
Page(Object.assign({
  data: { isLoad: false, isEdit: false, hasSession: false, wechatProfileVisible: false, showContactProfile: false, identityLoggingIn: false, phoneLoginEnabled: false,
    phoneVerified: false, phoneAuthorizing: false, allowManualRegistration: false,
    canGetWechatPhone: true, canChooseWechatAvatar: true, canUseWechatNickname: true, loginError: '', loadError: '', inviteCode: '', retUrl: '' },
  async onLoad(options = {}) {
    ProjectBiz.initPage(this);
    profileMethods.initProfileCapabilities(this);
    profileMethods.applyUser(this, { USER_NAME: '', USER_MOBILE: '', USER_PIC: '', USER_FORMS: [] });
    let retUrl = '';
    try { retUrl = decodeURIComponent(options.retUrl || ''); } catch (_) {}
    if (options.inviteCode) InviteBiz.capture(options.inviteCode);
    this.setData({ retUrl, showContactProfile: !!retUrl, inviteCode: InviteBiz.getPendingCode() });
    await Promise.all([profileMethods.loadCampuses(this, true), this._loadDetail()]);
    this._updateTitle();
  },
  onUnload() { this._unloaded = true; },
  _updateTitle() {
    if (!this._unloaded) wx.setNavigationBarTitle({ title: this.data.phoneLoginEnabled !== true
      ? (this.data.hasSession ? (this.data.showContactProfile ? '完善联系资料' : '头像和昵称') : 'GXNU校跑')
      : this.data.phoneVerified ? '完善个人资料' : '登录 / 注册' });
  },
  async _loadDetail() {
    if (this.data.phoneAuthorizing || this.data.identityLoggingIn || this.data.saving) return;
    const version = this._detailVersion = (this._detailVersion || 0) + 1;
    const isCurrent = () => !this._unloaded && version === this._detailVersion && !this.data.phoneAuthorizing && !this.data.identityLoggingIn && !this.data.saving;
    this.setData({ loadError: '' });
    if (PassportBiz.isLoggedOut() || this.data.phoneLoginEnabled !== true && !PassportBiz.getUserId()) {
      this.setData({ hasSession: false, isLoad: true, phoneVerified: false });
      this._updateTitle();
      return;
    }
    try {
      const user = await profileMethods.getProfileUser({ hint: false }, true);
      if (!isCurrent() || PassportBiz.isLoggedOut()) return;
      if (user && user.USER_STATUS === 9) return wx.switchTab({ url: '/projects/crun/pages/my/index/my_index' });
      profileMethods.applyUser(this, user || { USER_NAME: '', USER_MOBILE: '', USER_PIC: '', USER_FORMS: [] });
      this.setData({ isLoad: true, hasSession: !!PassportBiz.getUserId() });
      if (this.data.phoneLoginEnabled !== true && this.data.hasSession) {
        if (profileMethods.isProfileReady(user)) await PassportBiz.loginSilenceMust();
        if (isCurrent()) return this._openPersonal();
        return;
      }
      if (profileMethods.isProfileReady(user)) {
        // A previous save may have committed even if its response was lost.
        // Reconcile the session before returning to a guarded business page.
        await PassportBiz.loginSilenceMust();
        if (!isCurrent()) return;
        const token = PassportBiz.getToken();
        if (!token || !token.id || !PassportBiz.isProfileReady(token)) throw new Error('登录状态暂未同步，请重试');
        this.setData({ accountStatus: token.status });
        return profileMethods.finishProfile(this);
      }
      this._updateTitle();
    } catch (error) {
      if (isCurrent()) this.setData({ loadError: '登录信息加载失败，请重试' });
    }
  },
  _openPersonal() {
    if (this._unloaded || this._navigating || PassportBiz.isLoggedOut() || !PassportBiz.getUserId()) return;
    this._navigating = true;
    const suffix = this.data.retUrl ? '?retUrl=' + encodeURIComponent(this.data.retUrl) : '';
    wx.redirectTo({ url: '/projects/crun/pages/my/personal/my_personal' + suffix,
      fail: () => { this._navigating = false; this.setData({ loginError: '页面打开失败，请重试' }); } });
  },
  bindOpenWechatProfile() {
    if (this._unloaded || this._navigating || this.data.phoneLoginEnabled || this.data.identityLoggingIn || this.data.saving) return;
    return this.bindWechatAccountLogin();
  },
  async bindWechatAccountLogin() {
    if (this._unloaded || this._navigating || this.data.phoneLoginEnabled === true || this.data.identityLoggingIn || this.data.phoneAuthorizing || this.data.saving) return;
    const version = this._detailVersion = (this._detailVersion || 0) + 1;
    const isCurrent = () => !this._unloaded && version === this._detailVersion;
    this.setData({ identityLoggingIn: true, loginError: '', loadError: '' });
    try {
      const current = PassportBiz.getToken();
      const result = this._profileLoginResult && current && current.sessionToken === this._profileLoginResult.token.sessionToken
        ? this._profileLoginResult : await PassportBiz.loginByUser();
      this._profileLoginResult = result;
      profileMethods.invalidateProfileCache();
      if (!isCurrent() || PassportBiz.isLoggedOut()) return;
      this.setData({ hasSession: true, isLoad: true, loginError: '', loadError: '' });
      this._profileDirty = false;
      profileMethods.applyUser(this, result.user);
      if (result.cancellationCancelled) wx.showToast({ title: '已取消账户注销', icon: 'none' });
      return this._openPersonal();
    } catch (error) {
      if (isCurrent()) {
        const message = error && (error.msg || error.message) || '微信登录失败，请重试';
        this.setData({ loginError: message });
        wx.showToast({ title: message, icon: 'none', duration: 3000 });
      }
    } finally { if (isCurrent()) this.setData({ identityLoggingIn: false }); }
  },
  async bindWechatLogin(e) {
    if (this.data.phoneLoginEnabled !== true || this.data.phoneAuthorizing || this.data.identityLoggingIn || this.data.saving) return;
    this._detailVersion = (this._detailVersion || 0) + 1;
    this.setData({ phoneAuthorizing: true, loginError: '' });
    try {
      const result = await PassportBiz.loginByWechatPhone(e);
      profileMethods.invalidateProfileCache();
      if (this._unloaded) return;
      if (!result.user || result.user.USER_MOBILE_VERIFIED !== true) throw new Error('手机号授权未完成，请重试');
      profileMethods.applyUser(this, result.user);
      this.setData({ isLoad: true, hasSession: true, phoneVerified: true, formMobile: result.user.USER_MOBILE, loginError: '', loadError: '' });
      if (result.user.USER_PROFILE_COMPLETE === true && !this._profileDirty) return profileMethods.finishProfile(this);
      this._updateTitle();
    } catch (error) {
      if (!this._unloaded) {
        const message = error && (error.msg || error.message) || '微信登录失败，请重新授权';
        this.setData({ loginError: message });
        this._updateTitle();
        wx.showToast({ title: this.data.loginError, icon: 'none', duration: 3000 });
      }
    } finally { if (!this._unloaded) this.setData({ phoneAuthorizing: false }); }
  },
  async onPullDownRefresh() {
    try { await Promise.all([profileMethods.loadCampuses(this, true), this._loadDetail()]); this._updateTitle(); }
    finally { wx.stopPullDownRefresh(); }
  },
  bindInviteCodeInput(e) { this.setData({ inviteCode: InviteBiz.normalize(e.detail.value) }); },
  bindProfileFormSubmit(e) {
    if (!this.data.phoneLoginEnabled && !this.data.hasSession) return this.bindWechatAccountLogin(e);
    return this.data.phoneLoginEnabled || this.data.showContactProfile
      ? profileMethods.bindSubmitTap.call(this, e) : profileMethods.bindSaveWechatProfile.call(this, e);
  },
  bindCompleteProfile() {
    if (this._unloaded || this.data.saving || this.data.identityLoggingIn || this.data.phoneAuthorizing || !PassportBiz.getUserId()) return;
    this.setData({ showContactProfile: true, saveError: '' });
    this._updateTitle();
  },
  bindSkipWechatProfile() {
    if (this._unloaded || this.data.saving || this.data.identityLoggingIn || this.data.phoneAuthorizing || !PassportBiz.getUserId()) return;
    wx.switchTab({ url: '/projects/crun/pages/my/index/my_index' });
  }
}, profileMethods));
