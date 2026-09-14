const createCatalog = require('../../../../biz/admin_catalog_biz.js');
const UI = require('../../../../biz/admin_console_biz.js');
const NewsBiz = require('../../../../biz/news_biz.js');
const categories = NewsBiz.getCateList();
Page(createCatalog({
  route: 'admin/news_list',
  menus: [{ label: '全部公告' }, { label: '已发布', type: 'status', value: 1 }, { label: '已停用', type: 'status', value: 0 }, { label: '最新', type: 'sort', value: 'new' }, { label: '置顶', type: 'top', value: 'top' }].concat(categories.length > 1 ? categories : []),
  data: { searchPlaceholder: '搜索公告标题', countUnit: '篇公告', emptyTitle: '暂无符合条件的公告', emptyHint: '发布通知与资讯，让用户及时了解服务动态' },
  format: row => ({ ...row, NEWS_STATUS: Number(row.NEWS_STATUS), NEWS_ORDER: Number(row.NEWS_ORDER), NEWS_VOUCH: Number(row.NEWS_VOUCH) })
}, {
  bindStatusMoreTap(e) {
    if (this.data.busy) return;
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.showActionSheet({ itemList: ['发布公告', '停用公告', '删除公告'], success: result => {
      if (result.tapIndex < 2) return this.mutate('admin/news_status', { id, status: result.tapIndex === 0 ? 1 : 0 });
      if (result.tapIndex === 2) return this.mutate('admin/news_del', { id }, { title: '删除公告', content: '确认删除此公告？删除后无法恢复。' });
    } });
  },
  bindMoreTap(e) {
    if (this.data.busy) return;
    const row = this.data.list.find(item => item._id === e.currentTarget.dataset.id);
    if (!row) return;
    wx.showActionSheet({ itemList: [row.NEWS_ORDER === 0 ? '取消置顶' : '置顶公告', row.NEWS_VOUCH === 1 ? '取消首页推荐' : '推荐到首页', '查看公告小程序码'], success: result => {
      if (result.tapIndex === 0) return this.mutate('admin/news_sort', { id: row._id, sort: row.NEWS_ORDER === 0 ? 9999 : 0 });
      if (result.tapIndex === 1) return this.mutate('admin/news_vouch', { id: row._id, vouch: row.NEWS_VOUCH === 1 ? 0 : 1 });
      if (result.tapIndex === 2) UI.go('qr', { title: row.NEWS_TITLE, qr: row.NEWS_QR || '', path: '/projects/crun/pages/news/detail/news_detail', sc: row._id });
    } });
  }
}));
