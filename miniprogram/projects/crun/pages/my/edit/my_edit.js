const ProjectBiz = require('../../../biz/project_biz.js');
Page({
  data: { isLoad: false },
  onLoad() { ProjectBiz.initPage(this); this.setData({ isLoad: true }); },
  bindPersonalTap() { wx.navigateTo({ url: '../personal/my_personal' }); },
  bindContactTap() { wx.navigateTo({ url: '../contact/my_contact' }); },
  bindAddressTap() { wx.navigateTo({ url: '../address/my_address' }); }
});
