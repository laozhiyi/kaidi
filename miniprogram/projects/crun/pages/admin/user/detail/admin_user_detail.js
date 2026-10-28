const UI = require('../../../../biz/admin_console_biz.js');
const Ops = require('../../../../biz/operations_biz.js');
const ROLE_LABELS = { super: '超级管理员', admin: '管理员', service: '客服' };
Page({
  data: { id: '', user: null, profile: null, loading: false, error: '', notFound: false, busy: false, reason: '',
    // 权限管理按钮按「操作人 vs 目标账号」逐项判定：同级与上级一律不给入口。
    canManageTarget: false, staffTarget: false, isSelfTarget: false, canLeaveRole: false,
    grantSuper: false, grantAdmin: false, grantService: false, canRevokeRole: false, roleNotice: '' },
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
      if (this._visible && seq === this._seq) {
        const profile = user ? UI.userProfile(data) : null;
        this.setData({ user, profile, notFound: !user, ...this.roleFlags(profile && profile.role, user && user.userId) });
      }
    } catch (error) { if (this._visible && seq === this._seq) this.setData({ error: UI.message(error) }); }
    finally { if (this._visible && seq === this._seq) this.setData({ loading: false }); }
  },
  bindBack() { UI.back('users'); },
  bindReason(e) { if (!this.data.busy) this.setData({ reason: e.detail.value }); },
  bindPhone() { if (this.data.user && this.data.user.USER_MOBILE) wx.makePhoneCall({ phoneNumber: this.data.user.USER_MOBILE }); },
  bindCall(e) { const phone = e.currentTarget.dataset.phone; if (phone && phone !== '无') wx.makePhoneCall({ phoneNumber: String(phone) }); },
  url(e) { const { url, type } = e.currentTarget.dataset; if (url && type === 'image') wx.previewImage({ urls: [url], current: url }); else if (url !== undefined && type === 'copy') wx.setClipboardData({ data: String(url) }); },
  /** 目标账号的角色决定显示哪些授权按钮；同级与上级只给说明，不给按钮 */
  roleFlags(role, userId) {
    const target = String(role || '');
    const me = UI.adminRole();
    const admin = this.data.admin || {};
    const isSelf = !!(admin.userId && userId && String(admin.userId) === String(userId));
    const canManage = UI.canManageRole(target) && !isSelf;
    let roleNotice = '';
    if (isSelf) roleNotice = '这是当前登录账号，不能修改自己的后台角色。如需退出后台，使用下方「退出后台权限」。';
    else if (!canManage) {
      if (target === 'super') roleNotice = '超级管理员账号只有初始管理员能调整，超管之间不能互相改权限；交接或退出请联系初始管理员。';
      else if (target === 'admin') roleNotice = '不能调整同级管理员的权限，请由初始管理员或超级管理员处理。';
      else roleNotice = '没有调整该账号的权限。';
    }
    return {
      canManageTarget: canManage,
      staffTarget: !!target,
      isSelfTarget: isSelf,
      canLeaveRole: isSelf && !!target,
      grantSuper: canManage && target !== 'super' && UI.canGrantRole('super'),
      grantAdmin: canManage && target !== 'admin' && UI.canGrantRole('admin'),
      grantService: canManage && target !== 'service' && UI.canGrantRole('service'),
      canRevokeRole: canManage && !!target && UI.canGrantRole(''),
      roleNotice,
      roleHint: me === 'root'
        ? '初始管理员可以调整包括超管在内的所有账号，也是唯一能授予超管的角色；不能修改自己，且至少保留一位超管。'
        : me === 'super'
          ? '超级管理员可以授予或取消管理员、客服权限；超管之间不能互相调整，交接或退出请联系初始管理员。'
          : '管理员只能授予或取消客服权限，不能调整管理员与超级管理员的账号。'
    };
  },
  /** 授权 / 取消授权后台角色：客服不可操作，管理员只能操作客服权限 */
  async bindRole(e) {
    if (!UI.authorize(this) || this.data.busy || this.data.loading || this.data.error || !this.data.user) return;
    if (this.data.isServiceAdmin) { Ops.error(new Error('客服账号没有授权权限')); return; }
    const role = String(e.currentTarget.dataset.role || '');
    if (!['', 'super', 'admin', 'service'].includes(role)) return;
    // 前端只做提前拦截，真正的边界由后端 Roles.grantError 兜底。
    if (!this.data.canManageTarget) { Ops.error(new Error(this.data.roleNotice || '没有调整该账号的权限')); return; }
    if (!UI.canGrantRole(role)) {
      Ops.error(new Error(role === 'super' ? '只有初始管理员可以授予超级管理员' : '只有初始管理员或超级管理员可以授予管理员权限'));
      return;
    }
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
  /** 本人主动退出后台：只能退自己，最后一位超管会被后端拦下 */
  async bindLeave() {
    if (!UI.authorize(this) || this.data.busy || !this.data.user) return;
    if (!this.data.isSelfTarget) { Ops.error(new Error('只能退出自己的后台权限')); return; }
    if (!await UI.confirm('退出后台权限', '退出后需要重新获得授权才能进入管理后台。超管交接请先由初始管理员授权继任者，再退出。')) return;
    this.setData({ busy: true });
    try {
      await Ops.command('admin/user_leave', { id: this.data.user.userId });
      UI.clearAdminToken();
      wx.reLaunch({ url: '/projects/crun/pages/my/index/my_index' });
    } catch (error) { if (this._visible) Ops.error(error); this.setData({ busy: false }); }
  },
  async bindStatus(e) {
    if (!UI.authorize(this) || this.data.busy || this.data.loading || this.data.error || !this.data.user) return;
    const status = Number(e.currentTarget.dataset.status);
    if (![1, 8, 9].includes(status)) return;
    // 客服只做注册审核（通过/不通过）；停用与恢复账号仍归管理员。
    if (this.data.isServiceAdmin && status === 9) { Ops.error(new Error('客服账号没有停用用户的权限')); return; }
    // 同级与上级的后台账号不能停用或恢复，停掉超管等于变相夺权。
    if (this.data.staffTarget && !this.data.canManageTarget) { Ops.error(new Error(this.data.roleNotice || '没有管理该账号的权限')); return; }
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
