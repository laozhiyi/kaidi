const MailUI = require('../../../biz/mail_ui_biz.js');
const Ops = require('../../../biz/operations_biz.js');
const ProjectBiz = require('../../../biz/project_biz.js');
const PassportBiz = require('../../../../../comm/biz/passport_biz.js');
// Historical records can contain numeric strings or invalid legacy timestamps.
function historyTime(value) {
 const numeric = typeof value === 'number' || typeof value === 'string' && /^\d+$/.test(value);
 const at = numeric ? Number(value) : typeof value === 'string' ? Date.parse(value) : NaN;
 const date = new Date(at + 8 * 3600000);
 return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 19).replace('T', ' ') : '时间未知';
}
Page({
 data:{id:'',mail:null,detailUI:null,loading:true,error:false,errorMessage:'',notFound:false,configError:false,offlineNotice:'费用由双方线下协商结算，平台不代收、不担保；请勿提前向陌生人转账。',busy:false,panel:'',note:'',images:[],reasons:['取件失败','取件码错误','联系不上','物品损坏','送错地址','申请取消','其他'],reasonIndex:0,config:null},
 onLoad(options = {}) {
  ProjectBiz.initPage(this);
  this.setData({ id: typeof options.id === 'string' ? options.id.trim() : '' });
 },
 onShow() { this._visible = true; return this.load(); },
 onHide() { this._visible = false; this._seq = (this._seq || 0) + 1; },
 onUnload() { this.onHide(); },
 async onPullDownRefresh() { try { await this.load(); } finally { wx.stopPullDownRefresh(); } },
 async _loadConfig(seq) {
  try {
   const config = await Ops.get('operations/config');
   if (!config || typeof config !== 'object' || !config.paymentMode) throw new Error('配置未返回');
   if (!this._visible || seq !== this._seq) return;
   this.setData({ config, configError: false,
    offlineNotice: config.offlineNotice || this.data.offlineNotice });
  } catch (e) {
   if (this._visible && seq === this._seq) this.setData({ configError: true });
  }
 },
 async load() {
  if (!this.data.id) {
   this.setData({ mail: null, loading: false, error: true, notFound: true, errorMessage: '缺少订单编号，请返回订单列表重新进入' });
   return;
  }
  const seq = this._seq = (this._seq || 0) + 1;
  this.setData({ loading: true, error: false, errorMessage: '', notFound: false });
  // Subscription/config is optional: a failed or slow request must not block the order.
  this._loadConfig(seq);
  try {
   const mail = await Ops.get('mail/view', { id: this.data.id });
   if (!this._visible || seq !== this._seq) return;
   if (!mail || !mail._id) {
    this.setData({ mail: null, loading: false, error: true, notFound: true, errorMessage: '订单不存在或已删除' });
    return;
   }
   mail.history = (Array.isArray(mail.MAIL_HISTORY) ? mail.MAIL_HISTORY : [])
    .filter(x => x && typeof x === 'object').map(x => ({ ...x, time: historyTime(x.at) }));
   this.setData({ mail, detailUI: MailUI.detail(mail), loading: false });
  } catch (e) {
   console.error('[mail_my_detail] load', e);
   if (this._visible && seq === this._seq) this.setData({ error: true, loading: false,
    errorMessage: e && (e.msg || e.message) || '订单加载失败，请检查网络后重试' });
  }
 },
 bindReload() { return this.load(); },
 bindBackOrders() { wx.switchTab({ url: '/projects/crun/pages/order/index/order_index' }); },
 bindServiceHelpTap() { wx.navigateTo({ url: '/projects/crun/pages/campus_service/list/campus_service_list' }); },
 bindCopyOrderTap() { const mail = this.data.mail; if (mail) wx.setClipboardData({ data: String(mail.MAIL_ID || mail._id) }); },
 bindNoticeTap() { wx.showModal({ title: this.data.detailUI && this.data.detailUI.legacyPayment ? '结算核对说明' : '线下结算说明', content: this.data.detailUI && this.data.detailUI.legacyPayment ? '本单未标记为线下结算订单，请联系校区客服核对支付与退款记录，勿重复向对方转账。' : this.data.offlineNotice, showCancel: false, confirmText: '我知道了' }); },
 bindEditTap() { if (this.data.detailUI && this.data.detailUI.primary === 'edit') wx.navigateTo({ url: '../add/mail_add?id=' + this.data.id }); },
 bindCallTap() { const ui = this.data.detailUI; if (ui && ui.participant && ui.phone) wx.makePhoneCall({ phoneNumber: String(ui.phone) }); },
 bindCopyCodeTap() { const mail = this.data.mail; const code = mail && mail.MAIL_OBJ && mail.MAIL_OBJ.code; if (mail && (mail.mypost || mail.myaccept) && code) wx.setClipboardData({ data: String(code) }); },
 bindPreviewImageTap(e) { const mail = this.data.mail; if (!mail || !(mail.mypost || mail.myaccept)) return; const { url, group } = e.currentTarget.dataset; const urls = mail.MAIL_MEDIA && mail.MAIL_MEDIA[group] || []; if (url && urls.includes(url)) wx.previewImage({ urls, current: url }); },
 bindFeedbackTap() { wx.navigateTo({ url: '../../feedback/index/feedback_index?orderId=' + this.data.id }); },
 bindSubscription() { Ops.subscribe(this.data.config || {}); },
 bindPrimaryAction() {
  if (this.data.busy || this.data.loading || this.data.error || !this.data.detailUI) return;
  const action = this.data.detailUI.primary;
  if (action === 'edit') return this.bindEditTap();
  if (action === 'deliver') return this.bindPanel({ currentTarget: { dataset: { action } } });
  if (action === 'confirm') return this.bindConfirm({ currentTarget: { dataset: { action } } });
  if (action === 'contact') return this.bindCallTap();
  this.bindBackOrders();
 },
 bindMoreTap() {
  const ui = this.data.detailUI;
  if (!ui || !ui.participant || this.data.busy || this.data.loading || this.data.error) return;
  const choices = [];
  if (ui.canException) choices.push({ label: '配送异常 / 申请取消', action: 'exception' });
  if (ui.canCancel) choices.push({ label: '取消订单', action: 'cancel' });
  choices.push({ label: '反馈与投诉', action: 'feedback' });
  if (this.data.config && this.data.config.templateId) choices.push({ label: '订阅订单提醒', action: 'subscribe' });
  wx.showActionSheet({ itemList: choices.map(x => x.label), success: result => {
   if (this.data.busy || this.data.loading || this.data.error) return;
   const item = choices[result.tapIndex]; if (!item) return;
   if (item.action === 'exception') this.bindPanel({ currentTarget: { dataset: { action: 'exception' } } });
   else if (item.action === 'cancel') this.bindConfirm({ currentTarget: { dataset: { action: 'cancel' } } });
   else if (item.action === 'subscribe') this.bindSubscription();
   else this.bindFeedbackTap();
  } });
 },
 bindPanel(e) { const action = e.currentTarget.dataset.action, ui = this.data.detailUI; if (!ui || this.data.busy || this.data.loading || this.data.error || !(action === 'deliver' && ui.primary === 'deliver' || action === 'exception' && ui.canException)) return; this.setData({ panel: action, note: '', images: [], reasonIndex: 0 }); },
 bindStopProp() {},
 bindClosePanel() { if (!this.data.busy) this.setData({ panel: '' }); },
 bindNote(e) { if (!this.data.busy) this.setData({ note: e.detail.value }); },
 bindReason(e) { if (!this.data.busy) this.setData({ reasonIndex: Number(e.detail.value) }); },
 bindImages() { if (this.data.busy || this.data.images.length >= 6) return; wx.chooseImage({ count: 6 - this.data.images.length, sizeType: ['compressed'], success: r => { if (!this.data.busy && this.data.panel) this.setData({ images: this.data.images.concat(r.tempFilePaths).slice(0, 6) }); } }); },
 bindRemoveImage(e) { if (!this.data.busy) this.setData({ images: this.data.images.filter((_, i) => i !== Number(e.currentTarget.dataset.index)) }); },
 async bindConfirm(e) {
  const action = e.currentTarget.dataset.action, ui = this.data.detailUI;
  if (!ui || this.data.busy || this.data.loading || this.data.error || this._confirming || !(action === 'confirm' && ui.primary === 'confirm' || action === 'cancel' && ui.canCancel)) return;
  this._confirming = true;
  try {
   const result = await new Promise(resolve => wx.showModal({ title: action === 'confirm' ? '确认收到物品？' : '取消待接单订单？', content: action === 'confirm' ? '请核对物品已完整收到。线下费用请与骑手协商确认。' : '已被接取的订单不能直接取消，可申请异常处理。', success: resolve, fail: () => resolve({ confirm: false }) }));
   if (result.confirm) await this.perform(action);
  } finally { this._confirming = false; }
 },
 async bindSubmitPanel() {
  if (!this.data.panel || this.data.busy) return;
  if (!this.data.note.trim()) { Ops.error(new Error('请填写说明')); return; }
  if (this.data.panel === 'deliver' && !this.data.images.length) { Ops.error(new Error('请至少上传1张送达照片')); return; }
  await this.perform(this.data.panel);
 },
 async perform(action) {
  const ui = this.data.detailUI;
  if (this.data.busy || this.data.loading || this.data.error || !this.data.mail || !ui || this._performing) return;
  const allowed = action === 'deliver' && ui.primary === 'deliver' || action === 'exception' && ui.canException || action === 'confirm' && ui.primary === 'confirm' || action === 'cancel' && ui.canCancel;
  if (!allowed) return;
  // Acquire the lock before awaiting login; repeated taps must not create parallel uploads.
  this._performing = true;
  this.setData({ busy: true });
  try {
   if (!await PassportBiz.loginMustCancelWin(this)) return;
   const params = { id: this.data.id };
   if (action === 'deliver' || action === 'exception') {
    params.note = this.data.note.trim();
    params.images = await Ops.upload(this.data.images);
    if (action === 'exception') params.reason = this.data.reasons[this.data.reasonIndex];
   }
   const route = { deliver: 'mail/deliver', exception: 'mail/exception', confirm: 'mail/finish', cancel: 'mail/cancel' }[action];
   await Ops.command(route, params);
   if (this._visible) { this.setData({ panel: '' }); await this.load(); wx.showToast({ title: '操作成功' }); }
  } catch (e) { if (this._visible) Ops.error(e); }
  finally { this._performing = false; if (this._visible) this.setData({ busy: false }); else this.data.busy = false; }
 }
});
