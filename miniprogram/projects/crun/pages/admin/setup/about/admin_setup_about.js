const UI = require('../../../../biz/admin_console_biz.js');
const Ops = require('../../../../biz/operations_biz.js');
const cloud = require('../../../../../../helper/cloud_helper.js');
const projectSetting = require('../../../../public/project_setting.js');
Page({
  data: { key: '', title: '编辑内容', isLoad: false, loading: false, error: '', busy: false, formContent: [] },
  onLoad(options = {}) {
    if (!UI.start(this)) return;
    const item = projectSetting.SETUP_CONTENT_ITEMS.find(item => item.key === options.key);
    if (!item) { this.setData({ error: '内容页面不存在，请返回重新选择' }); return; }
    this.setData({ key: item.key, title: item.title });
    wx.setNavigationBarTitle({ title: '编辑' + item.title });
    return this.load();
  },
  onShow() { const reload = this._visible === false && !this.data.isLoad; this._visible = true; if (reload && this.data.key) return this.load(); },
  onHide() { UI.hide(this); },
  onUnload() { this._unloaded = true; UI.hide(this); },
  bindBack() { UI.back('about'); },
  async load() {
    if (!UI.authorize(this) || !this.data.key || this.data.busy) return;
    const seq = this._seq = (this._seq || 0) + 1;
    this.setData({ loading: true, error: '' });
    try {
      const content = await Ops.get('home/setup_get', { key: this.data.key });
      if (this._visible && seq === this._seq) this.setData({ isLoad: true, formContent: Array.isArray(content) && content.length ? content : [{ type: 'text', val: '' }] });
    } catch (error) { if (this._visible && seq === this._seq) this.setData({ error: UI.message(error) }); }
    finally { if (this._visible && seq === this._seq) this.setData({ loading: false }); }
  },
  async bindFormSubmit() {
    if (!UI.authorize(this) || !this.data.isLoad || this.data.busy) return;
    const editor = this.selectComponent('#contentEditor');
    if (!editor) return;
    const content = editor.getNodeList();
    this.setData({ busy: true });
    try {
      await cloud.transRichEditorTempPics(content, 'setup/', this.data.key, 'admin/setup_set_content');
      if (this._unloaded) return;
      wx.showToast({ title: '内容已保存' });
      UI.back('about');
    } catch (error) { if (!this._unloaded) Ops.error(error); }
    finally { if (!this._unloaded) this.setData({ busy: false }); }
  }
});
