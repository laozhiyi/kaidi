const ProjectBiz = require('../../../biz/project_biz.js');
const projectSetting = require('../../../public/project_setting.js');
const cloudHelper = require('../../../../../helper/cloud_helper.js');
const EMPTY_TEXT = {
  SETUP_CONTENT_ABOUT: 'GXNU随手取提供校区内的快递代取与互助服务。具体开放校区和服务规则以平台当前配置为准。',
  SETUP_CONTENT_CONTACT: '联系方式尚未配置，如需帮助，请通过在线客服联系运营人员。',
  SETUP_CONTENT_DISCLAIMER: '本平台仅为校园同学之间的互助信息撮合，不对订单履约、物品完好及交易纠纷承担担保责任。请在发布和接单前核实对方信息，妥善保管个人隐私与贵重物品，并遵守校规校纪与相关法律法规。使用平台即表示你已知悉并同意以上内容。',
  SETUP_CONTENT_AFTERSALES: '售后群信息尚未配置，如需帮助，请通过在线客服联系运营人员。'
};
// 售后群二维码兜底图（后台未上传图片时使用，过期后需替换）。
const FALLBACK_AFTERSALES_QR = '/projects/crun/images/aftersales_qr.jpg';
Page({
  data: { key: 'SETUP_CONTENT_ABOUT', title: '关于我们', emptyText: EMPTY_TEXT.SETUP_CONTENT_ABOUT, about: [], hasImage: false, fallbackQr: FALLBACK_AFTERSALES_QR, loading: false, error: false },
  onLoad(options = {}) {
    ProjectBiz.initPage(this);
    const item = projectSetting.SETUP_CONTENT_ITEMS.find(x => x.key === options.key) || projectSetting.SETUP_CONTENT_ITEMS[0];
    this.setData({ key: item.key, title: item.title, emptyText: EMPTY_TEXT[item.key] || EMPTY_TEXT.SETUP_CONTENT_CONTACT });
    wx.setNavigationBarTitle({ title: item.title });
    this.load();
  },
  onUnload() { this._unloaded = true; },
  async load() {
    if (this.data.loading) return;
    this.setData({ loading: true, error: false });
    try {
      const result = await cloudHelper.callCloudSumbit('home/setup_get', { key: this.data.key }, { hint: false });
      if (!result || result.data === undefined) throw new Error('内容加载失败');
      const about = result.data;
      if (!this._unloaded) this.setData({ about: Array.isArray(about) ? about : [], hasImage: Array.isArray(about) && about.some(x => x && x.type === 'img') });
    } catch (error) { if (!this._unloaded) this.setData({ error: true }); }
    finally { if (!this._unloaded) this.setData({ loading: false }); }
  },
  async onPullDownRefresh() { try { await this.load(); } finally { wx.stopPullDownRefresh(); } },
  bindImage(e) { const url = e.currentTarget.dataset.url; if (url) wx.previewImage({ current: url, urls: [url] }); },
  bindContact() { wx.navigateTo({ url: '/projects/crun/pages/about/index/about_index?key=SETUP_CONTENT_CONTACT' }); },
  bindService() { wx.navigateTo({ url: '/projects/crun/pages/customer_service/chat/customer_service_chat' }); }
});
