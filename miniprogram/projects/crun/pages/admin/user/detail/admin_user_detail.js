const UI = require('../../../../biz/admin_console_biz.js');
const Ops = require('../../../../biz/operations_biz.js');
Page({
  data: { id: '', user: null, loading: false, error: '', notFound: false, busy: false, reason: '' },
  onLoad(options = {}) {
    if (!UI.start(this)) return;
    if (!options.id) { this.setData({ notFound: true }); return; }
    try { this.setData({ id: decodeURIComponent(options.id) }); }
    catch (_) { this.setData({ notFound: true }); return; }
    return this.load();
  },
  onShow() { const reload = this._visible === false; this._visible = true; if (reload && this.data.id) return this.load(); },
  onHide() { UI.hide(this); },
  onUnload() { this._unloaded = true; UI.hide(this); },
  async onPullDownRefresh() { try { if (!this.data.busy) await this.load(); } finally { wx.stopPullDownRefresh(); } },
  async load() {
    if (!this.data.id || !UI.authorize(this)) return;
    const seq = this._seq = (this._seq || 0) + 1;
    this.setData({ loading: true, error: '', notFound: false });
    try {
      const data = await Ops.get('admin/user_detail', { id: this.data.id });
      const user = data && (data._id || data.USER_MINI_OPENID || data.USER_ID) ? UI.user(data) : null;
      if (this._visible && seq === this._seq) this.setData({ user, notFound: !user });
    } catch (error) { if (this._visible && seq === this._seq) this.setData({ error: UI.message(error) }); }
    finally { if (this._visible && seq === this._seq) this.setData({ loading: false }); }
  },
  bindBack() { UI.back('users'); },
  bindReason(e) { if (!this.data.busy) this.setData({ reason: e.detail.value }); },
  bindPhone() { if (this.data.user && this.data.user.USER_MOBILE) wx.makePhoneCall({ phoneNumber: this.data.user.USER_MOBILE }); },
  url(e) { const { url, type } = e.currentTarget.dataset; if (url && type === 'image') wx.previewImage({ urls: [url], current: url }); else if (url !== undefined && type === 'copy') wx.setClipboardData({ data: String(url) }); },
  async bindStatus(e) {
    if (!UI.authorize(this) || this.data.busy || this.data.loading || this.data.error || !this.data.user) return;
    const status = Number(e.currentTarget.dataset.status), reason = this.data.reason.trim();
    if (![1, 8, 9].includes(status)) return;
    if (status === 8 && !reason) { Ops.error(new Error('请填写审核未通过的原因')); return; }
    this.setData({ busy: true });
    try {
      const title = status === 1 ? '设为正常用户' : status === 8 ? '审核不通过' : '停用用户';
      if (!await UI.confirm(title, status === 9 ? '停用后用户无法发布或接取新订单，历史订单与履约凭证保留。' : '请确认已核实用户资料，操作将更新用户的账号状态。')) return;
      if (!this._visible) return;
      await Ops.get('admin/user_status', { id: this.data.user.userId, status, reason });
      UI.changed(this);
      if (this._visible) { this.setData({ reason: '' }); wx.showToast({ title: '状态已更新' }); await this.load(); }
    } catch (error) { if (this._visible) Ops.error(error); }
    finally { if (!this._unloaded) this.setData({ busy: false }); }
  }
});
