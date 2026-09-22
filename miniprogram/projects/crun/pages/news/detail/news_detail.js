const cloudHelper = require('../../../../../helper/cloud_helper.js');
const pageHelper = require('../../../../../helper/page_helper.js');
const ProjectBiz = require('../../../biz/project_biz.js');
const Notifications = require('../../../biz/notification_biz.js');

Page({
  data: { id: '', isLoad: false, error: false, news: null },
  onLoad(options) { ProjectBiz.initPage(this); pageHelper.getOptions(this, options); },
  onShow() { this._visible = true; return this._loadDetail(); },
  onHide() { this._visible = false; this._seq = (this._seq || 0) + 1; },
  onUnload() { this.onHide(); },
  async _loadDetail() {
    if (!this.data.id || !this._visible) return;
    const seq = this._seq = (this._seq || 0) + 1;
    this.setData({ error: false });
    try {
      const result = await cloudHelper.callCloudSumbit('news/view', { id: this.data.id }, { hint: false });
      if (!result || result.data === undefined) throw new Error('公告加载失败');
      const news = result.data && Object.keys(result.data).length ? result.data : null;
      if (!this._visible || seq !== this._seq) return;
      this.setData({ isLoad: news ? true : null, news: news || null }, () => {
        if (news && this._visible && seq === this._seq) Notifications.markRead(news._id || this.data.id, 'news').catch(() => {});
      });
    } catch (error) {
      if (this._visible && seq === this._seq) this.setData({ error: true, isLoad: !!this.data.news });
    }
  },
  async onPullDownRefresh() { try { await this._loadDetail(); } finally { wx.stopPullDownRefresh(); } },
  url(e) { pageHelper.url(e, this); },
  onPageScroll(e) { pageHelper.showTopBtn(e, this); },
  onShareAppMessage() {
    const news = this.data.news || {};
    return { title: news.NEWS_TITLE || '校园公告', imageUrl: (news.NEWS_PIC || [])[0] || '',
      path: '/projects/crun/pages/news/detail/news_detail?id=' + encodeURIComponent(this.data.id) };
  }
});
