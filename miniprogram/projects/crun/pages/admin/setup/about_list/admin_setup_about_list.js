const UI = require('../../../../biz/admin_console_biz.js');
const projectSetting = require('../../../../public/project_setting.js');
const pageHelper = require('../../../../../../helper/page_helper.js');
Page({
  data: { list: [] },
  onLoad() {
    if (!UI.start(this)) return;
    const meta = {
      SETUP_CONTENT_CONTACT: { icon: 'service', description: '联系渠道、咨询方式与服务说明' },
      SETUP_CONTENT_DISCLAIMER: { icon: 'info', description: '注册时用户需阅读并同意的免责声明；留空则显示默认文案' },
      SETUP_CONTENT_AFTERSALES: { icon: 'service', description: '反馈投诉页展示的售后群链接与二维码；文本可复制，图片可保存' }
    };
    this.setData({ list: projectSetting.SETUP_CONTENT_ITEMS.map(item => ({ ...item,
      icon: (meta[item.key] || {}).icon || 'info',
      description: (meta[item.key] || {}).description || '小程序介绍、服务范围与使用说明' })) });
  },
  bindBack() { UI.back('settings'); },
  bindServices() { UI.go('services'); },
  url(e) { pageHelper.url(e, this); }
});
