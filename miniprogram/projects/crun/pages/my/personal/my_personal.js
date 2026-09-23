const ProjectBiz = require('../../../biz/project_biz.js');
const PassportBiz = require('../../../../../comm/biz/passport_biz.js');
const profileMethods = require('../profile_methods.js');
const accountActions = require('../account_actions.js');
const MY_PAGE = '/projects/crun/pages/my/index/my_index';
Page(Object.assign({
  data: { isLoad: false, isEdit: true, hasSession: false, retUrl: '', loggingOut: false, cancellingAccount: false, phoneLoginEnabled: false, allowManualRegistration: false,
    canGetWechatPhone: true, canChooseWechatAvatar: true, canUseWechatNickname: true, loadError: '' },
  async onLoad(options = {}) {
    ProjectBiz.initPage(this);
    if (PassportBiz.isLoggedOut() || !PassportBiz.getUserId()) return wx.reLaunch({ url: MY_PAGE });
    let retUrl = '';
    try { retUrl = decodeURIComponent(options.retUrl || ''); } catch (_) {}
    this.setData({ hasSession: true, isEdit: PassportBiz.isProfileReady(PassportBiz.getToken()), retUrl });
    profileMethods.initProfileCapabilities(this);
    const cached = profileMethods.getCachedProfileUser();
    if (cached) { profileMethods.applyUser(this, cached); this.setData({ isLoad: true, user: cached }); }
    await Promise.all([profileMethods.loadCampuses(this), this._loadDetail()]);
  },
  onUnload() { this._unloaded = true; },
  async _loadDetail() {
    this.setData({ loadError: '' });
    try {
      const user = await profileMethods.getProfileUser({ hint: false }, true);
      if (this._unloaded || PassportBiz.isLoggedOut()) return;
      if (!user) return wx.redirectTo({ url: '../reg/my_reg' });
      profileMethods.applyUser(this, user);
      this.setData({ isLoad: true, user });
    } catch (error) {
      if (!this._unloaded) this.setData({ loadError: '资料加载失败，请重试' });
    }
  },
  async onPullDownRefresh() {
    try { await Promise.all([profileMethods.loadCampuses(this, true), this._loadDetail()]); }
    finally { wx.stopPullDownRefresh(); }
  },
  bindPersonalSubmit(e) {
    return profileMethods.bindSubmitTap.call(this, e);
  }
}, profileMethods, accountActions));
