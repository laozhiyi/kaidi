const ProjectBiz = require('../../../biz/project_biz.js');
const profileMethods = require('../profile_methods.js');
Page(Object.assign({
  data: { isLoad: false, isEdit: true, addresses: [], addressPhaseOptions: require('../../../biz/address_biz.js').PHASES, loadError: '', collectionSaving: false },
  onLoad() { ProjectBiz.initPage(this); return this._loadProfile(); },
  onUnload() { this._unloaded = true; },
  async _loadProfile(force = false) {
    if (this._loadingProfile) return;
    this._loadingProfile = true;
    this.setData({ loadError: '' });
    if (force && !this.data.contactEditorVisible && !this.data.addressEditorVisible && !this.data.collectionSaving) this._profileDirty = false;
    const cached = profileMethods.getCachedProfileUser();
    if (cached) { profileMethods.applyUser(this, cached); this.setData({ isLoad: true, user: cached }); }
    try {
      const [, user] = await Promise.all([profileMethods.loadCampuses(this), profileMethods.getProfileUser({ hint: false }, force)]);
      if (this._unloaded) return;
      if (!user) return wx.redirectTo({ url: '../reg/my_reg' });
      profileMethods.applyUser(this, user);
      this.setData({ isLoad: true, user });
    } catch (error) {
      if (!this._unloaded) this.setData({ isLoad: true, loadError: '资料加载失败，请重试' });
    } finally { this._loadingProfile = false; }
  },
  bindRetryLoad() { return this._loadProfile(true); },
  async onPullDownRefresh() { try { await this._loadProfile(true); } finally { wx.stopPullDownRefresh(); } },
  bindBack() { wx.navigateBack(); }
}, profileMethods));
