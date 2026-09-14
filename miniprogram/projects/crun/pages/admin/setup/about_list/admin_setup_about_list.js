const UI = require('../../../../biz/admin_console_biz.js');
const projectSetting = require('../../../../public/project_setting.js');
const pageHelper = require('../../../../../../helper/page_helper.js');
Page({
  data: { list: [] },
  onLoad() {
    if (!UI.start(this)) return;
    this.setData({ list: projectSetting.SETUP_CONTENT_ITEMS.map(item => ({ ...item,
      icon: item.key === 'SETUP_CONTENT_CONTACT' ? 'service' : 'info',
      description: item.key === 'SETUP_CONTENT_CONTACT' ? '联系渠道、咨询方式与服务说明' : '小程序介绍、服务范围与使用说明' })) });
  },
  bindBack() { UI.back('settings'); },
  bindServices() { UI.go('services'); },
  url(e) { pageHelper.url(e, this); }
});
