const Ops = require('../../../biz/operations_biz.js');
const ProjectBiz = require('../../../biz/project_biz.js');
const PassportBiz = require('../../../../../comm/biz/passport_biz.js');

module.exports = function createReviewPage(direction) {
  return {
    data: { list: [], direction, page: 0, hasMore: false, loading: false, isLoad: false, error: false },
    onLoad() { ProjectBiz.initPage(this); },
    async onShow() {
      this._visible = true;
      if (await PassportBiz.loginMustBackWin(this) && this._visible) return this.load(true);
    },
    onHide() { this._visible = false; this._seq = (this._seq || 0) + 1; this.setData({ loading: false }); },
    onUnload() { this.onHide(); },
    async load(reset = true) {
      if (typeof reset !== 'boolean') reset = true;
      if (!this._visible || (!reset && (this.data.loading || !this.data.hasMore))) return;
      const seq = this._seq = (this._seq || 0) + 1;
      const page = reset ? 1 : this.data.page + 1;
      this.setData({ loading: true, error: false });
      try {
        const res = await Ops.get('review/my_list', { page, size: 20, direction });
        if (!res || !Array.isArray(res.list)) throw new Error('评价加载失败');
        const list = res.list.map(item => {
          const score = Math.round(Math.max(0, Math.min(5, Number(item.REVIEW_SCORE) || 0)));
          return {
            _id: item._id,
            name: item.REVIEW_NAME || (direction === 'received' ? item.REVIEW_FROM_NAME : item.REVIEW_TO_NAME) || '用户',
            avatar: item.REVIEW_PIC || '',
            score,
            content: item.REVIEW_CONTENT || '',
            stars: '★'.repeat(score) + '☆'.repeat(5 - score)
          };
        });
        if (this._visible && seq === this._seq) this.setData({ list: reset ? list : this.data.list.concat(list), page, hasMore: !!res.hasMore, isLoad: true });
      } catch (error) {
        if (this._visible && seq === this._seq) this.setData({ error: true, isLoad: true });
      } finally {
        if (this._visible && seq === this._seq) this.setData({ loading: false });
      }
    },
    async onPullDownRefresh() { try { await this.load(true); } finally { wx.stopPullDownRefresh(); } },
    bindDirection(e) {
      const target = e.currentTarget.dataset.direction;
      if (!['sent', 'received'].includes(target) || target === direction || this._navigating) return;
      this._navigating = true;
      wx.redirectTo({
        url: target === 'received' ? '/projects/crun/pages/my/review_received/my_review_received' : '/projects/crun/pages/my/review/my_review',
        complete: () => { this._navigating = false; }
      });
    },
    onReachBottom() { if (this.data.hasMore && !this.data.loading) return this.load(false); },
    bindAvatarError(e) {
      const { id, src } = e.currentTarget.dataset;
      if (!src || !this.data.list.some(item => item._id === id && item.avatar === src)) return;
      this.setData({ list: this.data.list.map(item => item._id === id && item.avatar === src ? { ...item, avatar: '' } : item) });
    }
  };
};
