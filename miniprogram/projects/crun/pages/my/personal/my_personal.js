const Guide = require('../../../biz/form_guide_biz.js');
const ProjectBiz = require('../../../biz/project_biz.js');
const PassportBiz = require('../../../../../comm/biz/passport_biz.js');
const InviteBiz = require('../../../biz/invite_biz.js');
const profileMethods = require('../profile_methods.js');
const accountActions = require('../account_actions.js');
Page(Object.assign({
  data: { isLoad: false, isEdit: true, hasSession: false, retUrl: '', inviteCode: '', loggingOut: false, cancellingAccount: false, phoneLoginEnabled: false, allowManualRegistration: false,
    canGetWechatPhone: true, canChooseWechatAvatar: true, canUseWechatNickname: true, loadError: '' },
  async onLoad(options = {}) {
    ProjectBiz.initPage(this);
    this._focusAgreement = options.focus === 'agreement';
    let retUrl = '';
    try { retUrl = decodeURIComponent(options.retUrl || ''); } catch (_) {}
    this.setData({ retUrl, returnToPublish: options.returnToPublish === '1' });
    const token = PassportBiz.getToken();
    if (!token) return this._openLogin();
    this.setData({ hasSession: true, isEdit: token.profilePhoneRequired ? token.profileComplete === true : PassportBiz.isProfileReady(token), inviteCode: InviteBiz.getPendingCode() });
    profileMethods.initProfileCapabilities(this);
    const cached = profileMethods.getCachedProfileUser();
    if (cached && typeof cached.profilePhoneRequired === 'boolean') {
      profileMethods.applyUser(this, cached); this.setData({ isLoad: true, user: cached });
    }
    await Promise.all([profileMethods.loadCampuses(this), this._loadDetail()]);
    this._focusAgreementIfReady();
  },
  _focusAgreementIfReady() {
    if (!this._unloaded && this._focusAgreement && this.data.isLoad) {
      this._focusAgreement = false;
      Guide.show(this, 'agreement', '请阅读协议，并自主勾选后保存资料；返回后可继续原来的操作。');
    }
  },
  onUnload() { this._unloaded = true; },
  _openLogin() {
    if (this._unloaded || this.data.loggingOut || this.data.cancellingAccount) return;
    const { retUrl, returnToPublish } = this.data;
    const suffix = retUrl ? '?retUrl=' + encodeURIComponent(retUrl) + (returnToPublish ? '&returnToPublish=1' : '') : '';
    this.setData({ hasSession: false, isLoad: false });
    return wx.redirectTo({ url: '../reg/my_reg' + suffix, fail: () => this.setData({ loadError: '请重新登录' }) });
  },
  async _loadDetail() {
    const logoutEpoch = PassportBiz.logoutEpoch?.();
    const isCurrent = () => !this._unloaded && logoutEpoch === PassportBiz.logoutEpoch?.();
    this.setData({ loadError: '' });
    try {
      const user = await profileMethods.getProfileUser({ hint: false }, true);
      if (!isCurrent()) return;
      if (!PassportBiz.getUserId()) return this._openLogin();
      if (!user) return this._openLogin();
      profileMethods.applyUser(this, user);
      profileMethods.loadInviteInfo(this);
      this.setData({ isLoad: true, user, ...(user.profilePhoneRequired ? { isEdit: user.USER_PROFILE_COMPLETE === true } : {}) });
      this._focusAgreementIfReady();
    } catch (error) {
      if (!isCurrent()) return;
      if (!PassportBiz.getUserId()) return this._openLogin();
      this.setData({ loadError: '资料加载失败，请重试' });
    }
  },
  async onPullDownRefresh() {
    try { await Promise.all([profileMethods.loadCampuses(this, true), this._loadDetail()]); }
    finally { wx.stopPullDownRefresh(); }
  },
  bindPersonalSubmit(e) {
    return profileMethods.bindSubmitTap.call(this, e);
  },
}, profileMethods, accountActions));
