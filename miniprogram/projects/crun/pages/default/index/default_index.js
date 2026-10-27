const pageHelper = require('../../../../../helper/page_helper.js');
const cloudHelper = require('../../../../../helper/cloud_helper.js');
const Ops = require('../../../biz/operations_biz.js');
const ProjectBiz = require('../../../biz/project_biz.js');
const Passport = require('../../../../../comm/biz/passport_biz.js');
const Notifications = require('../../../biz/notification_biz.js');
const Tenant = require('../../../biz/tenant_biz.js');

Page({
  data: {
    isLoad: false, activeService: 'take', referencePrice: '1.50',
    featuredNews: null, unreadCount: 0, messageBadge: '', noticeLoaded: false, noticeError: false,
    schoolName: '', campusName: '', schools: [], campusOptions: [], activeSchoolId: '', campusSheet: false,
    serviceOptions: [
      { key: 'take', title: '帮我取', desc: '快递代取', icon: 'mail' },
      // 「帮我送」「帮我买」暂未开放，点击只提示开发中。
      { key: 'send', title: '帮我送', desc: '开发中', icon: 'deliver', disabled: true },
      { key: 'buy', title: '帮我买', desc: '开发中', icon: 'shop', disabled: true }
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
    this._loadTenant();
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
    const key = e.currentTarget.dataset.key;
    const option = this.data.serviceOptions.find(item => item.key === key);
    if (!option) return;
    // 尚未开放的服务只做提示，不切换表单。
    if (option.disabled) return wx.showToast({ title: option.title + '正在开发中，敬请期待', icon: 'none' });
    const current = this.selectComponent('#home-' + this.data.activeService + '-form');
    if (current && current.data.submitting) return;
    this.setData({ activeService: key });
  },
  // 顶部学校/校区：先选学校再选校区，也可以直接点校区切换。
  async _loadTenant() {
    try {
      const directory = await Tenant.directory(async () => (await cloudHelper.callCloudSumbit('tenant/catalog', {}, { hint: false })).data);
      if (!this._visible) return;
      const scope = Tenant.snapshot() || await Tenant.ensure(async () => directory);
      if (!this._visible) return;
      const schools = directory.schools.filter(school => school.enabled !== false
        && directory.campuses.some(campus => campus.schoolId === school.schoolId && campus.enabled !== false));
      this._directory = directory;
      const activeSchoolId = scope ? scope.schoolId : (schools[0] && schools[0].schoolId) || '';
      this.setData({
        schools: schools.map(school => ({ schoolId: school.schoolId, name: school.name })),
        schoolName: scope ? scope.schoolName || (schools[0] && schools[0].name) || '' : (schools[0] && schools[0].name) || '',
        campusName: scope ? scope.campusName : '',
        activeSchoolId
      });
      this._syncCampusOptions(activeSchoolId);
    } catch (error) { console.warn('[home] tenant directory unavailable', error); }
  },
  _syncCampusOptions(schoolId) {
    const rows = (this._directory && this._directory.campuses || [])
      .filter(campus => campus.schoolId === schoolId && campus.enabled !== false);
    this.setData({ campusOptions: rows.map(campus => ({ campusId: campus.campusId, name: campus.name })) });
  },
  bindCampusTap() { this.setData({ campusSheet: true }); },
  bindCloseCampusSheet() { this.setData({ campusSheet: false }); },
  bindPickSchool(e) {
    const schoolId = e.currentTarget.dataset.id;
    if (!schoolId || schoolId === this.data.activeSchoolId) return;
    this.setData({ activeSchoolId: schoolId });
    this._syncCampusOptions(schoolId);
  },
  bindPickCampus(e) {
    const campusId = e.currentTarget.dataset.id;
    const schoolId = this.data.activeSchoolId;
    if (!campusId || !schoolId) return;
    const current = Tenant.snapshot();
    if (current && current.campusId === campusId && current.schoolId === schoolId) return this.bindCloseCampusSheet();
    try {
      this.bindCloseCampusSheet();
      // 切换会重新加载首页，丢弃旧校区的列表、公告与草稿。
      Tenant.select({ schoolId, campusId });
    } catch (error) { wx.showToast({ title: error.message || '切换失败，请重试', icon: 'none' }); }
  },
  bindStopTouch() {},
  bindExpressTap() { this.setData({ activeService: 'take' }); },
  bindEmbeddedPublished(e) {
    const service = e && e.detail && e.detail.service || this.data.activeService;
    const form = this.selectComponent('#home-' + service + '-form');
    if (form && typeof form.resetAfterPublish === 'function') form.resetAfterPublish();
    wx.showToast({ title: '发布成功', icon: 'success' });
    this._loadList();
  },
  handleFeatureTap(e) { if (e.currentTarget.dataset.url) this.url(e); },
  url(e) { pageHelper.url(e, this); },
  async onPullDownRefresh() {
    try {
      const form = this.selectComponent('#home-' + this.data.activeService + '-form');
      await Promise.all([this._loadList(), Notifications.refresh(true), form && form.onPullDownRefresh ? form.onPullDownRefresh() : Promise.resolve()]);
    } finally { wx.stopPullDownRefresh(); }
  },
  onShareAppMessage() {}
});
