const ProjectBiz = require('../../../biz/project_biz.js');
const profileMethods = require('../profile_methods.js');
Page(Object.assign({
  data: { isLoad: false, isEdit: true, allowManualRegistration: false, manualRegistration: false,
    canGetWechatPhone: true, canChooseWechatAvatar: true, canUseWechatNickname: true, loadError: '' },
  async onLoad() {
    ProjectBiz.initPage(this);
    profileMethods.initProfileCapabilities(this);
    const cached = profileMethods.getCachedProfileUser();
    if (profileMethods.isProfileReady(cached)) { profileMethods.applyUser(this, cached); this.setData({ isLoad: true, user: cached }); }
    await Promise.all([profileMethods.loadCampuses(this), this._loadDetail()]);
  },
  onUnload() { this._unloaded = true; },
  async _loadDetail() {
    this.setData({ loadError: '' });
    try {
      const user = await profileMethods.getProfileUser({ hint: false }, true);
      if (this._unloaded) return;
      if (!user || user.USER_STATUS !== 9 && !profileMethods.isProfileReady(user)) return wx.redirectTo({ url: '../reg/my_reg' });
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
  bindPicTap(e) {
    if (!e.detail.avatarUrl) return;
    this._profileDirty = true;
    this.setData({ formPic: e.detail.avatarUrl });
  }
}, profileMethods));
