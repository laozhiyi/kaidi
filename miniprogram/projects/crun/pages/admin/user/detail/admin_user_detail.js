const UI = require('../../../../biz/admin_console_biz.js');
const Ops = require('../../../../biz/operations_biz.js');
const ROLE_LABELS = { super: '超级管理员', admin: '管理员', service: '客服' };
Page({
  data: { id: '', user: null, profile: null, loading: false, error: '', notFound: false, busy: false, reason: '' },
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
      if (this._visible && seq === this._seq) this.setData({ user, profile: user ? UI.userProfile(data) : null, notFound: !user });
    } catch (error) { if (this._visible && seq === this._seq) this.setData({ error: UI.message(error) }); }
    finally { if (this._visible && seq === this._seq) this.setData({ loading: false }); }
  },
  bindBack() { UI.back('users'); },
  bindReason(e) { if (!this.data.busy) this.setData({ reason: e.detail.value }); },
  bindPhone() { if (this.data.user && this.data.user.USER_MOBILE) wx.makePhoneCall({ phoneNumber: this.data.user.USER_MOBILE }); },
  bindCall(e) { const phone = e.currentTarget.dataset.phone; if (phone && phone !== '无') wx.makePhoneCall({ phoneNumber: String(phone) }); },
  url(e) { const { url, type } = e.currentTarget.dataset; if (url && type === 'image') wx.previewImage({ urls: [url], current: url }); else if (url !== undefined && type === 'copy') wx.setClipboardData({ data: String(url) }); },
  /** 授权 / 取消授权后台角色：客服不可操作，管理员只能操作客服权限 */
  async bindRole(e) {
    if (!UI.authorize(this) || this.data.busy || this.data.loading || this.data.error || !this.data.user) return;
    if (this.data.isServiceAdmin) { Ops.error(new Error('客服账号没有授权权限')); return; }
    const role = String(e.currentTarget.dataset.role || '');
    if (!['', 'super', 'admin', 'service'].includes(role)) return;
    const label = ROLE_LABELS[role] || '普通用户';
    if (!await UI.confirm(role ? '授权' + label : '取消后台权限', role
      ? '授权后该用户可以用微信登录管理后台，并按' + label + '的权限操作。'
      : '取消后该用户将无法登录管理后台，已登录的后台会话会立即失效。')) return;
    if (!this._visible) return;
    this.setData({ busy: true });
    try {
      await Ops.command('admin/user_role', { id: this.data.user.userId, role });
      UI.changed(this);
      if (this._visible) { wx.showToast({ title: role ? '已授权' : '已取消授权' }); await this.load(); }
    } catch (error) { if (this._visible) Ops.error(error); }
    finally { if (!this._unloaded) this.setData({ busy: false }); }
  },
  async bindStatus(e) {
    if (!UI.authorize(this) || this.data.busy || this.data.loading || this.data.error || !this.data.user) return;
    const status = Number(e.currentTarget.dataset.status);
    if (![1, 8, 9].includes(status)) return;
    // 客服只做注册审核（通过/不通过）；停用与恢复账号仍归管理员。
    if (this.data.isServiceAdmin && status === 9) { Ops.error(new Error('客服账号没有停用用户的权限')); return; }
    const reason = this.data.reason.trim();
    if (status === 8 && !reason) { Ops.error(new Error('请填写审核未通过的原因')); return; }
    this.setData({ busy: true });
    try {
      const title = status === 1 ? '审核通过' : status === 8 ? '审核不通过' : '停用用户';
      const content = status === 1 ? '审核通过后该账号完成注册，可以接单和发单。'
        : status === 9 ? '停用后用户无法发布或接取新订单，历史订单与履约凭证保留。'
        : '审核不通过后，用户需要修改资料重新提交审核。';
      if (!await UI.confirm(title, content)) return;
      if (!this._visible) return;
      await Ops.get('admin/user_status', { id: this.data.user.userId, status, reason });
      UI.changed(this);
      if (this._visible) { this.setData({ reason: '' }); wx.showToast({ title: '状态已更新' }); await this.load(); }
    } catch (error) { if (this._visible) Ops.error(error); }
    finally { if (!this._unloaded) this.setData({ busy: false }); }
  }
});
