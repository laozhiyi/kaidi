const Ops = require('../../../biz/operations_biz.js');
const ProjectBiz = require('../../../biz/project_biz.js');

Page({
  data: { list: [], page: 1, hasMore: false, loading: false, isLoad: false, error: false },
  onLoad() { ProjectBiz.initPage(this); },
  onShow() { this.load(true); },
  async load(reset = true) {
    if (this.data.loading) return;
    this.setData({ loading: true, error: false });
    try {
      const page = reset ? 1 : this.data.page + 1;
      const res = await Ops.get('review/my_list', { page, size: 20 });
      const list = (res && res.list || []).map(item => {
        const score = Math.max(0, Math.min(5, Number(item.REVIEW_SCORE) || 0));
        return { ...item, stars: '★'.repeat(score) + '☆'.repeat(5 - score) };
      });
      this.setData({ list: reset ? list : this.data.list.concat(list), page, hasMore: !!(res && res.hasMore), isLoad: true });
    } catch (e) {
      this.setData({ error: true, isLoad: true });
      Ops.error(e);
    } finally {
      this.setData({ loading: false });
    }
  },
  onPullDownRefresh() { return this.load(true).finally(() => wx.stopPullDownRefresh()); },
  onReachBottom() { if (this.data.hasMore && !this.data.loading) this.load(false); }
});
