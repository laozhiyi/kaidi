const ProjectBiz = require('../../../biz/project_biz.js');
const InviteBiz = require('../../../biz/invite_biz.js');
const profileMethods = require('../profile_methods.js');
Page(Object.assign({
  data: { isLoad: false, isEdit: false, loadError: '', inviteCode: '', retUrl: '' },
  async onLoad(options = {}) {
    ProjectBiz.initPage(this);
    let retUrl = '';
    try { retUrl = decodeURIComponent(options.retUrl || ''); } catch (_) {}
    if (options.inviteCode) InviteBiz.capture(options.inviteCode);
    this.setData({ retUrl, inviteCode: InviteBiz.getPendingCode() });
    await Promise.all([profileMethods.loadCampuses(this), this._loadDetail()]);
  },
  onUnload() { this._unloaded = true; },
  async _loadDetail() {
    this.setData({ loadError: '' });
    try {
      const user = await profileMethods.getProfileUser({ hint: false }, true);
      if (this._unloaded) return;
      if (user) return wx.switchTab({ url: '/projects/crun/pages/my/index/my_index' });
      profileMethods.applyUser(this, { USER_NAME: '', USER_MOBILE: '', USER_PIC: '', USER_FORMS: [] });
      this.setData({ isLoad: true });
    } catch (error) {
      if (!this._unloaded) this.setData({ loadError: '注册信息加载失败，请重试' });
    }
  },
  bindInviteCodeInput(e) { this.setData({ inviteCode: InviteBiz.normalize(e.detail.value) }); },
  bindPicTap(e) {
    if (!e.detail.avatarUrl) return;
    this._profileDirty = true;
    this.setData({ formPic: e.detail.avatarUrl });
  }
}, profileMethods));
