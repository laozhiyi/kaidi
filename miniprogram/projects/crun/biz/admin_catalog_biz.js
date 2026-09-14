const UI = require('./admin_console_biz.js');
const Ops = require('./operations_biz.js');
const cloud = require('../../../helper/cloud_helper.js');
const pageHelper = require('../../../helper/page_helper.js');

// The secondary admin lists share the console's search, pagination and
// lifecycle handling instead of the old fixed-height list container.
function createCatalog({ route, menus = [], data = {}, format = row => row, superOnly = false }, methods = {}) {
  return {
    data: { list: [], page: 0, total: 0, hasMore: false, loading: false, refreshing: false, error: '', busy: false,
      searchDraft: '', search: '', menus, menuIndex: 0, campusOptions: [], campusIndex: 0, ...data },
    onLoad() { if (UI.start(this, superOnly)) return this.load(); },
    onShow() { if (this.data.isAdmin) return UI.showList(this); },
    onHide() { this._dirty = true; UI.hide(this); },
    onUnload() { this._unloaded = true; UI.hide(this); },
    onPageScroll(e) { this._scrollTop = e.scrollTop; },
    onReachBottom() { return this.bindMore(); },
    async onPullDownRefresh() { try { await this.load(true, true); } finally { wx.stopPullDownRefresh(); } },
    load(reset = true, preserve = false) {
      if (!UI.authorize(this, superOnly)) return;
      const menu = this.data.menus[this.data.menuIndex] || {};
      const params = { size: 20, isTotal: true, oldTotal: 0 };
      if (this.data.search) params.search = this.data.search;
      if (menu.type) { params.sortType = menu.type; params.sortVal = menu.value; }
      return UI.loadList(this, route, params, format, typeof reset === 'boolean' ? reset : true, preserve);
    },
    resetList(patch) {
      this._scrollTop = 0;
      this.setData({ ...patch, list: [], page: 0, total: 0, hasMore: false });
      return this.load();
    },
    bindInput(e) { this.setData({ searchDraft: e.detail.value }); },
    bindSearch() { return this.resetList({ search: this.data.searchDraft.trim(), campusIndex: 0 }); },
    bindMenu(e) {
      const menuIndex = Number(e.currentTarget.dataset.index);
      if (this.data.menus[menuIndex] && menuIndex !== this.data.menuIndex) return this.resetList({ menuIndex });
    },
    bindCampusChange(e) {
      const campusIndex = Number(e.detail.value);
      if (!this.data.campusOptions[campusIndex]) return;
      return this.resetList({ campusIndex, searchDraft: '', search: campusIndex ? this.data.campusOptions[campusIndex].replace(/校区$/, '') : '' });
    },
    bindReset() { return this.resetList({ searchDraft: '', search: '', menuIndex: 0, campusIndex: 0 }); },
    bindMore() { return this.load(false); },
    bindRetry() { return this.load(true, this.data.list.length > 0); },
    bindBack() { UI.back('settings'); },
    bindNavigate(e) { UI.go(e.currentTarget.dataset.key); },
    url(e) { pageHelper.url(e, this); },
    async mutate(endpoint, params = {}, confirmation) {
      if (!UI.authorize(this, superOnly) || this.data.busy || this._unloaded) return;
      this.setData({ busy: true });
      try {
        if (confirmation && !await UI.confirm(confirmation.title, confirmation.content)) return;
        if (!this._visible) return;
        // Legacy write endpoints may return no payload on success.
        await cloud.callCloudSumbit(endpoint, params, { hint: false });
        this._dirty = true;
        if (this._visible) {
          wx.showToast({ title: '操作成功' });
          await this.load(true, true);
          this._dirty = false;
        }
      } catch (error) { if (this._visible) Ops.error(error); }
      finally { if (!this._unloaded) this.setData({ busy: false }); }
    },
    ...methods
  };
}

module.exports = createCatalog;
