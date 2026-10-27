const Admin = require('../../../../../../comm/biz/admin_biz.js');
const Passport = require('../../../../../../comm/biz/passport_biz.js');
const cloudHelper = require('../../../../../../helper/cloud_helper.js');

Page({
  data: { code: '', name: '', busy: false, error: '' },
  onLoad() { Admin.clearAdminToken(); },
  onUnload() { this._unloaded = true; },
  bindInput(e) {
    const code = String(e.detail.value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    this.setData({ code, error: '' });
  },
  bindNameInput(e) { this.setData({ name: String(e.detail.value || '').slice(0, 20) }); },
  async bindActivate() {
    if (this.data.busy) return;
    const code = String(this.data.code || '').trim();
    if (code.length < 6) return this.setData({ error: '请输入完整的邀请码' });
    this.setData({ busy: true, error: '' });
    try {
      const token = Passport.getToken();
      if (!token || !token.id) await Passport.loginByUser(this);
      const res = await cloudHelper.callCloudSumbit('passport/staff_invite_redeem', { code, name: String(this.data.name || '').trim() }, { hint: false });
      const data = res && res.data;
      if (!data || !data.ok) throw new Error('邀请码激活失败，请重试');
      if (data.token) Passport.setToken(data.token);
      wx.showToast({ title: '已开通' + (data.roleLabel || '客服') + '权限', icon: 'none' });
      await Admin.wechatLogin(this);
    } catch (err) {
      if (!this._unloaded) this.setData({ error: (err && (err.msg || err.message)) || '激活失败，请检查邀请码或网络' });
    } finally {
      if (!this._unloaded) this.setData({ busy: false });
    }
  },
  bindBack() { wx.navigateBack(); }
});
