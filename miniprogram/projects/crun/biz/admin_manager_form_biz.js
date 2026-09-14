const UI = require('./admin_console_biz.js');
const Admin = require('../../../comm/biz/admin_biz.js');
const cloud = require('../../../helper/cloud_helper.js');
const validate = require('../../../helper/validate.js');
const Ops = require('./operations_biz.js');

module.exports = function createManagerForm(mode) {
  const isPassword = mode === 'password', isEdit = mode === 'edit';
  return {
    data: { id: '', isLoad: !isEdit, loading: false, error: '', busy: false, notFound: false,
      formName: '', formDesc: '', formPhone: '', formPassword: '', formOldPassword: '', formPassword2: '' },
    onLoad(options = {}) {
      if (!UI.start(this, !isPassword)) return;
      if (!isEdit) return;
      if (!options.id) { this.setData({ notFound: true }); return; }
      this.setData({ id: options.id });
      return this.load();
    },
    onShow() { this._visible = true; },
    onHide() { UI.hide(this); },
    onUnload() { this._unloaded = true; UI.hide(this); },
    bindBack() { UI.back(isPassword ? 'settings' : 'managers'); },
    async load() {
      if (!UI.authorize(this, true) || !this.data.id || this.data.loading) return;
      this.setData({ loading: true, error: '', notFound: false });
      try {
        const result = await cloud.callCloudSumbit('admin/mgr_detail', { id: this.data.id }, { hint: false });
        if (this._unloaded) return;
        const mgr = result && result.data;
        if (!mgr || !mgr._id) { this.setData({ notFound: true }); return; }
        this.setData({ isLoad: true, formName: mgr.ADMIN_NAME || '', formDesc: mgr.ADMIN_DESC || '', formPhone: mgr.ADMIN_PHONE || '', formPassword: '' });
      } catch (error) { if (!this._unloaded) this.setData({ error: UI.message(error) }); }
      finally { if (!this._unloaded) this.setData({ loading: false }); }
    },
    async bindFormSubmit() {
      if (!UI.authorize(this, !isPassword) || this.data.busy || !this.data.isLoad) return;
      const rules = isPassword ? Admin.CHECK_FORM_MGR_PWD : isEdit ? Admin.CHECK_FORM_MGR_EDIT : Admin.CHECK_FORM_MGR_ADD;
      const data = validate.check(this.data, rules, this);
      if (!data) return;
      if (isPassword && data.password !== data.password2) { Ops.error(new Error('两次输入的新密码不一致')); return; }
      if (isEdit) data.id = this.data.id;
      this.setData({ busy: true });
      try {
        await cloud.callCloudSumbit(isPassword ? 'admin/mgr_pwd' : isEdit ? 'admin/mgr_edit' : 'admin/mgr_insert', data, { hint: false });
        if (this._unloaded) return;
        this.setData({ formPassword: '', formOldPassword: '', formPassword2: '' });
        if (isPassword) {
          Admin.clearAdminToken();
          wx.showToast({ title: '密码已修改' });
          wx.reLaunch({ url: '/projects/crun/pages/admin/index/login/admin_login' });
        } else {
          UI.changed(this);
          wx.showToast({ title: isEdit ? '修改成功' : '添加成功' });
          UI.back('managers');
        }
      } catch (error) { if (!this._unloaded) Ops.error(error); }
      finally { if (!this._unloaded) this.setData({ busy: false }); }
    }
  };
};
