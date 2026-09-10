const Ops = require('../../../biz/operations_biz.js');
const ProjectBiz = require('../../../biz/project_biz.js');

Page({
  data: { orderId: '', score: 5, content: '', busy: false },
  onLoad(options = {}) {
    ProjectBiz.initPage(this);
    this.setData({ orderId: options.orderId || '' });
  },
  bindScore(e) {
    this.setData({ score: Number(e.currentTarget.dataset.score) });
  },
  bindContent(e) {
    this.setData({ content: e.detail.value });
  },
  async bindSubmit() {
    if (this.data.busy || !this.data.orderId) return;
    if (!this.data.score) return wx.showToast({ title: '请选择评分', icon: 'none' });
    this.setData({ busy: true });
    try {
      await Ops.command('review/insert', {
        orderId: this.data.orderId,
        score: this.data.score,
        content: this.data.content.trim()
      });
      wx.showModal({
        title: '评价成功',
        content: '感谢你的反馈，评价已记录。',
        showCancel: false,
        success: () => wx.navigateBack()
      });
    } catch (e) {
      Ops.error(e);
    } finally {
      this.setData({ busy: false });
    }
  }
});
