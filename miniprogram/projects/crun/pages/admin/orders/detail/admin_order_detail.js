const UI = require('../../../../biz/admin_console_biz.js');
const Ops = require('../../../../biz/operations_biz.js');
Page({
  data: { id: '', detail: null, loading: false, error: '', notFound: false, busy: false, note: '', resolutionIndex: 0, resolutions: ['恢复原流程', '取消订单', '确认完成'] },
  onLoad(options = {}) {
    if (!UI.start(this)) return;
    if (!options.id) { this.setData({ notFound: true }); return; }
    this.setData({ id: options.id });
    return this.load();
  },
  onShow() { const reload = this._visible === false; this._visible = true; if (reload && this.data.id) return this.load(); },
  onHide() { UI.hide(this); },
  onUnload() { this._unloaded = true; UI.hide(this); },
  async onPullDownRefresh() { try { if (!this.data.busy) await this.load(); } finally { wx.stopPullDownRefresh(); } },
  async load() {
    if (!this.data.id || !UI.authorize(this)) return;
    const seq = this._seq = (this._seq || 0) + 1;
    this.setData({ loading: true, error: '' });
    try {
      const data = await Ops.get('admin/operations_order', { id: this.data.id });
      if (!this._visible || seq !== this._seq) return;
      this.setData({ detail: data && data._id ? UI.order(data) : null, notFound: !data || !data._id });
    } catch (error) { if (this._visible && seq === this._seq) this.setData({ error: UI.message(error) }); }
    finally { if (this._visible && seq === this._seq) this.setData({ loading: false }); }
  },
  bindBack() { UI.back('orders'); },
  bindNote(e) { if (!this.data.busy) this.setData({ note: e.detail.value }); },
  bindResolution(e) { const index = Number(e.detail.value); if (!this.data.busy && [0, 1, 2].includes(index)) this.setData({ resolutionIndex: index }); },
  bindCopy() { if (this.data.detail) wx.setClipboardData({ data: String(this.data.detail.orderNo) }); },
  bindPhone(e) { const phone = e.currentTarget.dataset.phone; if (phone) wx.makePhoneCall({ phoneNumber: String(phone) }); },
  bindUser(e) { const id = e.currentTarget.dataset.id; if (id) UI.go('user', { id }); },
  bindImage(e) { const url = e.currentTarget.dataset.url; if (url) wx.previewImage({ urls: [url], current: url }); },
  async bindProcess() {
    if (this.data.busy || this.data.loading || this.data.error || !UI.authorize(this) || !this.data.detail || !this.data.detail.canProcess) return;
    const detail = this.data.detail, note = this.data.note.trim();
    if (!note) { Ops.error(new Error('请填写核实情况和处理依据')); return; }
    this.setData({ busy: true });
    try {
      const resolving = detail.MAIL_STATUS === 3;
      const title = resolving ? this.data.resolutions[this.data.resolutionIndex] : '转入异常处理';
      if (!await UI.confirm(title, '请确认已核实双方情况。处理结果将记录在订单履约记录中。')) return;
      if (!this._visible) return;
      const params = { id: detail._id, note };
      if (resolving) params.resolution = ['resume', 'cancel', 'complete'][this.data.resolutionIndex];
      await Ops.command(resolving ? 'admin/operations_resolve' : 'admin/operations_hold', params);
      UI.changed(this);
      if (this._visible) {
        this.setData({ note: '', resolutionIndex: 0 });
        wx.showToast({ title: '处理成功' });
        await this.load();
      }
    } catch (error) { if (this._visible) Ops.error(error); }
    finally { if (!this._unloaded) this.setData({ busy: false }); }
  }
});
