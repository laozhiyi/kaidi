const cloudHelper = require('../../../../../helper/cloud_helper.js');
const pageHelper = require('../../../../../helper/page_helper.js');
const ProjectBiz = require('../../../biz/project_biz.js');
const PassportBiz = require('../../../../../comm/biz/passport_biz.js');
const Notifications = require('../../../biz/notification_biz.js');
const TYPE_DESC = { bug: '功能异常', suggest: '功能建议', complain: '投诉举报', other: '其他' };
function displayTime(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.replace('T', ' ').slice(0, 16);
  const date = new Date(Number(value) + 8 * 3600000);
  return value && Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 16).replace('T', ' ') : '';
}
const STATUS_DESC = {
  0: { label: '待处理', color: '#397bc8', bgColor: 'rgba(57,123,200,.12)' },
  1: { label: '已处理', color: '#2dc87a', bgColor: 'rgba(45,200,122,.12)' },
  2: { label: '不予处理', color: '#94a3b8', bgColor: 'rgba(148,163,184,.14)' }
};
Page({
  data: { id: '', detail: null, isLoad: false, loading: false, error: false },
  onLoad(options = {}) { ProjectBiz.initPage(this); this._notificationId = options.notificationId || ''; this.setData({ id: options.id || '' }); },
  async onShow() {
    this._visible = true;
    if (await PassportBiz.loginMustBackWin(this) && this._visible) await this._loadDetail();
  },
  onHide() { this._visible = false; this._seq = (this._seq || 0) + 1; this.setData({ loading: false }); },
  onUnload() { this.onHide(); },
  async onPullDownRefresh() { try { await this._loadDetail(); } finally { wx.stopPullDownRefresh(); } },
  async _loadDetail() {
    if (!this.data.id) return this.setData({ isLoad: true, detail: null, error: false });
    if (!this._visible || this.data.loading) return;
    const seq = this._seq = (this._seq || 0) + 1;
    this.setData({ loading: true, error: false });
    try {
      let detail = await cloudHelper.callCloudData('feedback/my_detail', { id: this.data.id }, { hint: false });
      if (detail) detail = { ...detail, FB_ADD_TIME: displayTime(detail.FB_ADD_TIME), FB_REPLY_TIME: displayTime(detail.FB_REPLY_TIME), _typeDesc: TYPE_DESC[detail.FB_TYPE] || '其他', _statusDesc: STATUS_DESC[detail.FB_STATUS] || STATUS_DESC[0] };
      if (detail) detail._reviewStars = Number.isInteger(detail.FB_REVIEW_SCORE) && detail.FB_REVIEW_SCORE >= 1 && detail.FB_REVIEW_SCORE <= 5 ? '★'.repeat(detail.FB_REVIEW_SCORE) + '☆'.repeat(5 - detail.FB_REVIEW_SCORE) : '';
      if (this._visible && seq === this._seq) this.setData({ detail: detail || null, isLoad: true }, () => {
        if (detail && this._notificationId && this._visible && seq === this._seq) Notifications.markRead(this._notificationId).catch(() => {});
      });
    } catch (error) {
      if (this._visible && seq === this._seq) {
        if (/反馈不存在/.test(error.msg || error.message || '')) this.setData({ detail: null, isLoad: true });
        else this.setData({ error: true });
      }
    } finally {
      if (this._visible && seq === this._seq) this.setData({ loading: false });
    }
  },
  bindPreviewImage(e) {
    const url = pageHelper.dataset(e, 'url'), urls = this.data.detail && this.data.detail.FB_IMG_PREVIEW || [];
    if (urls.includes(url)) wx.previewImage({ current: url, urls });
  }
});
