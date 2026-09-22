const ProjectBiz = require('../../../biz/project_biz.js');
const InviteBiz = require('../../../biz/invite_biz.js');
const PassportBiz = require('../../../../../comm/biz/passport_biz.js');
const profileMethods = require('../profile_methods.js');
Page(Object.assign({
  data: { isLoad: false, isEdit: false, phoneVerified: false, phoneAuthorizing: false, allowManualRegistration: false, manualRegistration: false,
    canGetWechatPhone: true, canChooseWechatAvatar: true, canUseWechatNickname: true, phoneCapabilityError: '', loginError: '', loadError: '', inviteCode: '', retUrl: '' },
  async onLoad(options = {}) {
    ProjectBiz.initPage(this);
    profileMethods.initProfileCapabilities(this);
    let retUrl = '';
    try { retUrl = decodeURIComponent(options.retUrl || ''); } catch (_) {}
    if (options.inviteCode) InviteBiz.capture(options.inviteCode);
    this.setData({ retUrl, inviteCode: InviteBiz.getPendingCode() });
    await Promise.all([profileMethods.loadCampuses(this, true), this._loadDetail()]);
    this._updateTitle();
  },
  onUnload() { this._unloaded = true; },
  _updateTitle() {
    if (!this._unloaded) wx.setNavigationBarTitle({ title: this.data.phoneVerified ? '完善个人资料' : this.data.manualRegistration ? '填写资料注册' : '登录 / 注册' });
  },
  bindManualRegistration() {
    if (!this.data.allowManualRegistration || this.data.phoneVerified || this.data.phoneAuthorizing || this.data.saving) return;
    this._detailVersion = (this._detailVersion || 0) + 1;
    this.setData({ manualRegistration: true, isLoad: true, loginError: '', loadError: '' });
    this._updateTitle();
  },
  async _loadDetail() {
    if (this.data.phoneAuthorizing || this.data.saving) return;
    const version = this._detailVersion = (this._detailVersion || 0) + 1;
    const isCurrent = () => !this._unloaded && version === this._detailVersion && !this.data.phoneAuthorizing && !this.data.saving;
    this.setData({ loadError: '' });
    try {
      const user = await profileMethods.getProfileUser({ hint: false }, true);
      if (!isCurrent()) return;
      if (user && user.USER_STATUS === 9) return wx.switchTab({ url: '/projects/crun/pages/my/index/my_index' });
      profileMethods.applyUser(this, user || { USER_NAME: '', USER_MOBILE: '', USER_PIC: '', USER_FORMS: [] });
      this.setData({ isLoad: true });
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
  async bindWechatLogin(e) {
    if (this.data.phoneAuthorizing || this.data.saving) return;
    this._detailVersion = (this._detailVersion || 0) + 1;
    this.setData({ phoneAuthorizing: true, loginError: '' });
    try {
      const result = await PassportBiz.loginByWechatPhone(e);
      profileMethods.invalidateProfileCache();
      if (this._unloaded) return;
      if (!result.user || result.user.USER_MOBILE_VERIFIED !== true) throw new Error('手机号授权未完成，请重试');
      profileMethods.applyUser(this, result.user);
      this.setData({ isLoad: true, phoneVerified: true, formMobile: result.user.USER_MOBILE, manualRegistration: false, phoneCapabilityError: '', loginError: '', loadError: '' });
      if (result.user.USER_PROFILE_COMPLETE === true && !this._profileDirty) return profileMethods.finishProfile(this);
      this._updateTitle();
    } catch (error) {
      if (!this._unloaded) {
        const unavailable = ['permission_denied', 'unsupported', 'unavailable', 'privacy'].includes(error && error.reason);
        const message = error && (error.msg || error.message) || '微信登录失败，请重新授权';
        // Config can arrive after the native callback. Retain the capability
        // failure so the server policy can still select manual registration.
        this.setData({ loginError: message, ...(unavailable ? { phoneCapabilityError: message } : {}) });
        profileMethods.applyRegistrationPolicy(this, this.data.allowManualRegistration);
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
  bindPicTap(e) {
    if (!e.detail.avatarUrl) return;
    this._profileDirty = true;
    this.setData({ formPic: e.detail.avatarUrl });
  }
}, profileMethods));
