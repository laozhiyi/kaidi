const ProjectBiz = require('../../../biz/project_biz.js');
const projectSetting = require('../../../public/project_setting.js');
const cloudHelper = require('../../../../../helper/cloud_helper.js');
Page({
  data: { key: 'SETUP_CONTENT_ABOUT', title: '关于我们', about: [], loading: false, error: false },
  onLoad(options = {}) {
    ProjectBiz.initPage(this);
    const item = projectSetting.SETUP_CONTENT_ITEMS.find(x => x.key === options.key) || projectSetting.SETUP_CONTENT_ITEMS[0];
    this.setData({ key: item.key, title: item.title });
    wx.setNavigationBarTitle({ title: item.title });
    this.load();
  },
  onUnload() { this._unloaded = true; },
  async load() {
    if (this.data.loading) return;
    this.setData({ loading: true, error: false });
    try {
      const about = await cloudHelper.callCloudData('home/setup_get', { key: this.data.key }, { title: 'bar' });
      if (!this._unloaded) this.setData({ about: Array.isArray(about) ? about : [] });
    } catch (error) { if (!this._unloaded) this.setData({ error: true }); }
    finally { if (!this._unloaded) this.setData({ loading: false }); }
  },
  async onPullDownRefresh() { try { await this.load(); } finally { wx.stopPullDownRefresh(); } },
  bindImage(e) { const url = e.currentTarget.dataset.url; if (url) wx.previewImage({ current: url, urls: [url] }); },
  bindContact() { wx.navigateTo({ url: '/projects/crun/pages/about/index/about_index?key=SETUP_CONTENT_CONTACT' }); },
  bindService() { wx.navigateTo({ url: '/projects/crun/pages/campus_service/list/campus_service_list' }); }
});