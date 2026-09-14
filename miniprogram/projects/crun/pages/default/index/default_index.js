const pageHelper = require('../../../../../helper/page_helper.js');
const cloudHelper = require('../../../../../helper/cloud_helper.js');
const Ops = require('../../../biz/operations_biz.js');
const ProjectBiz = require('../../../biz/project_biz.js');
const Passport = require('../../../../../comm/biz/passport_biz.js');
const Notifications = require('../../../biz/notification_biz.js');

Page({
  data: {
    isLoad: false, activeService: 'take', referencePrice: '1.50',
    featuredNews: null, unreadCount: 0, messageBadge: '', noticeLoaded: false, noticeError: false,
    serviceOptions: [
      { key: 'take', title: '帮我取', desc: '快递代取', icon: 'mail' },
      { key: 'send', title: '帮我送', desc: '待上线', icon: 'deliver' },
      { key: 'buy', title: '帮我买', desc: '待上线', icon: 'shop' }
    ]
  },
  onLoad() { ProjectBiz.initPage(this); },
  onShow() {
    this._visible = true;
    const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null;
    if (tabBar) tabBar.setData({ selected: 0 });
    if (this._stopMessages) this._stopMessages();
    this._stopMessages = Notifications.subscribe(summary => this.setData({ featuredNews: summary.featuredNews,
      unreadCount: summary.unreadCount, messageBadge: summary.badge, noticeLoaded: summary.loaded, noticeError: summary.error }));
    Notifications.refresh(true);
    this._loadList();
  },
  onHide() { this._visible = false; if (this._stopMessages) this._stopMessages(); this._stopMessages = null; },
  onUnload() { this.onHide(); },
  bindNoticeTap() {
    if (this.data.featuredNews) return wx.navigateTo({ url: Notifications.messageUrl(this.data.featuredNews) });
    if (this.data.noticeError) return Notifications.refresh(true);
    return this.bindAllNews();
  },
  bindAllNews() { wx.navigateTo({ url: '/projects/crun/pages/news/index/news_index' }); },
  async bindMessagesTap() {
    if (this._openingMessages) return;
    this._openingMessages = true;
    try {
      if (await Passport.loginMustCancelWin(this) && this._visible) wx.navigateTo({ url: '/projects/crun/pages/operations/operations' });
    } finally { this._openingMessages = false; }
  },
  async _loadList() {
    if (this._listRequest) return this._listRequest;
    this._listRequest = (async () => {
      try {
        const [res, config] = await Promise.all([
          cloudHelper.callCloudSumbit('home/list', {}, { title: 'bar' }),
          Ops.get('operations/config').catch(() => null)
        ]);
        const data = res && res.data ? res.data : { list: [], cnt: 0 };
        if (typeof data.cnt === 'undefined') data.cnt = (data.list || []).length;
        const referencePrice = config && Number.isFinite(Number(config.smallPrice)) ? Number(config.smallPrice).toFixed(2) : this.data.referencePrice;
        this.setData({ ...data, isLoad: true, referencePrice });
      } catch (error) {
        console.error('加载首页列表失败', error);
        this.setData({ isLoad: true, cnt: 0 });
      } finally { this._listRequest = null; }
    })();
    return this._listRequest;
  },
  bindServiceTap(e) {
    if (e.currentTarget.dataset.key !== 'take') {
      wx.showToast({ title: '此功能待上线', icon: 'none' });
      return;
    }
    this.setData({ activeService: 'take' });
  },
  bindExpressTap() { this.setData({ activeService: 'take' }); },
  bindEmbeddedPublished() {
    const form = this.selectComponent('#home-take-form');
    if (form && typeof form.resetAfterPublish === 'function') form.resetAfterPublish();
    this.setData({ activeService: 'take' });
    wx.showToast({ title: '发布成功', icon: 'success' });
    this._loadList();
  },
  handleFeatureTap(e) { if (e.currentTarget.dataset.url) this.url(e); },
  url(e) { pageHelper.url(e, this); },
  async onPullDownRefresh() {
    try {
      const form = this.selectComponent('#home-take-form');
      await Promise.all([this._loadList(), Notifications.refresh(true), form && form.onPullDownRefresh ? form.onPullDownRefresh() : Promise.resolve()]);
    } finally { wx.stopPullDownRefresh(); }
  },
  onShareAppMessage() {}
});
