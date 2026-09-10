const cloudHelper = require('../../../../../helper/cloud_helper.js');
const ProjectBiz = require('../../../biz/project_biz.js');
const profileMethods = require('../profile_methods.js');
Page(Object.assign({
  data: { isLoad: false, isEdit: true },
  async onLoad() { ProjectBiz.initPage(this); await profileMethods.loadCampuses(this); const user = await cloudHelper.callCloudData('passport/my_detail', {}, { title: 'bar' }); if (!user) return wx.redirectTo({ url: '../reg/my_reg' }); this.setData({ isLoad: true, user }); profileMethods.applyUser(this, user); },
  onPullDownRefresh() { return this.onLoad().finally(() => wx.stopPullDownRefresh()); },
  bindBack() { wx.navigateBack(); }
}, profileMethods));
