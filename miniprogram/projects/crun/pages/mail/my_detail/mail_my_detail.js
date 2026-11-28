const MailUI = require('../../../biz/mail_ui_biz.js');
const Ops = require('../../../biz/operations_biz.js');
const ProjectBiz = require('../../../biz/project_biz.js');
const PassportBiz = require('../../../../../comm/biz/passport_biz.js');
const Notifications = require('../../../biz/notification_biz.js');
const OrderSync = require('../../../biz/order_sync_biz.js');
const Tenant = require('../../../biz/tenant_biz.js');
function invalidateOrderLists() {
 if (!wx.removeStorageSync) return;
 for (const key of ['order-mail-take', 'order-mail-mine', 'order-mail-posted', 'order-mail-done']) wx.removeStorageSync(key.toUpperCase() + '_LIST');
}
// Historical records can contain numeric strings or invalid legacy timestamps.
function historyTime(value) {
 const numeric = typeof value === 'number' || typeof value === 'string' && /^\d+$/.test(value);
 const at = numeric ? Number(value) : typeof value === 'string' ? Date.parse(value) : NaN;
 const date = new Date(at + 8 * 3600000);
 return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 19).replace('T', ' ') : '时间未知';
}
Page({
 data:{id:'',serviceOpen:require('../../../biz/customer_service_biz.js').OPEN,mail:null,detailUI:null,loading:true,error:false,errorMessage:'',notFound:false,configError:false,confirmGate:false,confirmCountdown:0,busy:false,panel:'',note:'',images:[],imagePreviews:{},video:'',videoPreview:'',deliveryMode:'place',reasons:['取件失败','取件码错误','联系不上','物品损坏','送错地址','申请取消','其他'],reasonIndex:0,config:null,pickupGate:false,pickupCountdown:2,priceSheet:false,priceValue:'',priceReason:'',priceReasons:['实际是中件','实际是大件','包裹超重','体积过大']},
 onLoad(options = {}) {
  ProjectBiz.initPage(this);
  this._openPanelAfterLoad = ['pickup', 'deliver', 'update_proof'].includes(options.panel) ? options.panel : '';
  this._confirmAfterLoad = options.action === 'confirm';
  this._notificationId = options.notificationId || '';
  this._linkScope = options.schoolId || options.campusId ? {schoolId:options.schoolId,campusId:options.campusId} : null;
  this.setData({ id: typeof options.id === 'string' ? options.id.trim() : '' });
 },
 onShow() {
  this._visible = true;
  if (!this._linkScope) this._startOrderSync();
  return this.load();
 },
 _startOrderSync() {
  if (this._stopOrderSync) this._stopOrderSync();
  this._stopOrderSync = OrderSync.subscribe(() => this.load({ silent: true }));
 },
 onHide() {
  this._visible = false; this._seq = (this._seq || 0) + 1; this._clearConfirmTimer(); this._clearPickupGate();
  this._confirming = false; this.setData({ confirmGate: false, confirmCountdown: 0, pickupGate: false, pickupCountdown: 2 });
  if (this._stopOrderSync) this._stopOrderSync(); this._stopOrderSync = null;
 },
 onUnload() { this.onHide(); },
 async onPullDownRefresh() { try { await this.load(); } finally { wx.stopPullDownRefresh(); } },
 async _loadConfig(seq) {
  try {
   const config = await Ops.get('operations/config');
   if (!config || typeof config !== 'object' || !config.paymentMode) throw new Error('配置未返回');
   if (!this._visible || seq !== this._seq) return;
   this.setData({ config, configError: false });
  } catch (e) {
   if (this._visible && seq === this._seq) this.setData({ configError: true });
  }
 },
 async load(options = {}) {
  if (options.silent && (this.data.busy || this._confirming)) return;
  if (!this.data.id) {
   this.setData({ mail: null, loading: false, error: true, notFound: true, errorMessage: '缺少订单编号，请返回订单列表重新进入' });
   return;
  }
  const seq = this._seq = (this._seq || 0) + 1;
  this.setData({ loading: !this.data.mail, error: false, errorMessage: '', notFound: false });
  try {
   if (this._linkScope) {
    // A subscription may be opened while another campus is saved locally.
    // Validate the link against the directory before any order/config reads.
    await Tenant.directory(() => Ops.get('tenant/catalog'), true);
    if (!this._visible || seq !== this._seq) return;
    Tenant.select(this._linkScope, {reload:false});
    this._linkScope = null;
    this._startOrderSync();
   }
   // Subscription/config is optional: a failed or slow request must not block the order.
   if (!options.silent || !this.data.config) this._loadConfig(seq);
   const mail = await Ops.get('mail/view', { id: this.data.id });
   if (!this._visible || seq !== this._seq) return;
   if (!mail || !mail._id) {
    this.setData({ mail: null, loading: false, error: true, notFound: true, errorMessage: '订单不存在或已删除' });
    return;
   }
   mail.history = (Array.isArray(mail.MAIL_HISTORY) ? mail.MAIL_HISTORY : [])
    .filter(x => x && typeof x === 'object').map(x => ({ ...x, time: historyTime(x.at) }));
   const detailUI = MailUI.detail(mail);
   this.setData({ mail, detailUI, loading: false, ...(this.data.panel === 'update_proof' && !detailUI.canUpdateProof ? { panel: '' } : {}) }, () => {
    if (!this._visible || seq !== this._seq) return;
    if (this._notificationId) Notifications.markRead(this._notificationId).catch(() => {});
    if (this._confirmAfterLoad) {
     this._confirmAfterLoad = false;
     this.bindReceiptTap();
    } else if (this._openPanelAfterLoad) {
     const action = this._openPanelAfterLoad;
     this._openPanelAfterLoad = '';
     if (action === 'update_proof') {
      if (detailUI.canUpdateProof) this.bindUpdateProofTap();
      else wx.showModal({ title: '暂不能更新凭证', content: '仅接单骑手可在发布者确认收货前更新送达凭证，请查看当前订单进度。', showCancel: false, confirmText: '我知道了' });
     } else if (this.data.detailUI.primary === action) this.bindPanel({ currentTarget: { dataset: { action } } });
     else wx.showModal({ title: '请查看当前订单进度', content: '订单状态已变化，当前无需提交凭证。', showCancel: false, confirmText: '我知道了' });
    }
   });
  } catch (e) {
   console.error('[mail_my_detail] load', e);
   if (this._visible && seq === this._seq) this.setData({ error: true, loading: false,
    errorMessage: e && (e.msg || e.message) || '订单加载失败，请检查网络后重试' });
   return { ok: false };
  }
 },
 async bindPayTap() {
  if(this.data.busy)return;
  this.setData({busy:true});
  try {await require('../../../biz/payment_biz.js').pay(this.data.id);wx.showToast({title:'支付成功，已发布',icon:'none'});}
  catch(error){Ops.error(error);}
  finally{this.setData({busy:false});await this.load();}
 },
 bindReload() { return this.load(); },
 bindBackOrders() { wx.switchTab({ url: '/projects/crun/pages/order/index/order_index' }); },
 bindServiceHelpTap() { require('../../../biz/customer_service_biz.js').openCustomerService(this.data.id); },
 bindCopyOrderTap() { const mail = this.data.mail; if (mail) wx.setClipboardData({ data: String(mail.MAIL_ID || mail._id) }); },
 bindNoticeTap() { if(this.data.mail && (this.data.mail.MAIL_PAYMENT_MODE === 'wechat' || this.data.mail.MAIL_PAYMENT_MODE === 'adapay')) return wx.showModal({title:'微信支付说明',content:require('../../../biz/payment_biz.js').PAY_NOTICE,showCancel:false}); wx.showModal({ title: '结算核对说明', content: '本单结算方式待核对，请通过「我的 · 意见反馈」核对支付与退款记录，勿重复向对方转账。', showCancel: false, confirmText: '我知道了' }); },
 bindEditTap() { if (this.data.detailUI && this.data.detailUI.primary === 'edit') wx.navigateTo({ url: '../add/mail_add?id=' + this.data.id }); },
 bindCallTap() { const ui = this.data.detailUI; if (ui && ui.participant && ui.phone) wx.makePhoneCall({ phoneNumber: String(ui.phone) }); },
 bindCopyCodeTap(e) { const mail = this.data.mail; if (!mail || !(mail.mypost || mail.myaccept)) return; const index = e && e.currentTarget.dataset.index; const item = index != null && this.data.detailUI && this.data.detailUI.pickupItems[index]; const code = index != null ? item && item.code : mail.MAIL_OBJ && mail.MAIL_OBJ.code; if (code) wx.setClipboardData({ data: String(code) }); },
 bindPreviewImageTap(e) { const mail = this.data.mail; if (!mail || !(mail.mypost || mail.myaccept)) return; const { url, group } = e.currentTarget.dataset; const urls = mail.MAIL_MEDIA && mail.MAIL_MEDIA[group] || []; if (url && urls.includes(url)) wx.previewImage({ urls, current: url }); },
 bindFeedbackTap() { wx.navigateTo({ url: '../../feedback/index/feedback_index?orderId=' + this.data.id }); },
 bindSubscription() { Ops.subscribe(this.data.config || {}); },
 bindReceiptTap() {
  const ui = this.data.detailUI;
  if (!this._visible || !ui || this.data.busy || this.data.loading || this.data.error || this._confirming) return;
  if (!ui.receipt.canConfirm) {
   wx.showModal({ title: '暂不能确认收货', content: ui.receipt.hint, showCancel: false, confirmText: '我知道了' });
   return;
  }
  return this.bindConfirm({ currentTarget: { dataset: { action: 'confirm' } } });
 },
 bindPrimaryAction() {
  if (this.data.busy || this.data.loading || this.data.error || !this.data.detailUI) return;
  const action = this.data.detailUI.primary;
  if (action === 'pay') return this.bindPayTap();
  if (action === 'edit') return this.bindEditTap();
  // 已完成只是状态展示，按钮已置灰，不再提供评价入口。
  if (action === 'done') return;
  if (action === 'remind') return this.bindRemindTap();
  if (action === 'resolve_exception') return this.bindResolveExceptionTap();
  if (['pickup', 'deliver', 'confirm'].includes(action)) return this.bindConfirm({ currentTarget: { dataset: { action } } });
  if (action === 'contact') return this.bindCallTap();
  this.bindBackOrders();
 },
 // 已送达待确认：只提醒发布人，不暴露发布人联系方式。
 async bindRemindTap() {
  const ui = this.data.detailUI;
  if (!this._visible || !ui || this.data.busy || this.data.loading || this.data.error || this._reminding) return;
  this._reminding = true; this.setData({ busy: true });
  try {
   if (!await PassportBiz.loginMustCancelWin(this)) return;
   await Ops.command('mail/remind', { id: this.data.id });
   wx.showToast({ title: '已提醒发布人确认收货', icon: 'none' });
  } catch (e) { if (this._visible) Ops.error(e); }
  finally { this._reminding = false; if (this._visible) this.setData({ busy: false }); }
 },
 bindMoreTap() {
  const ui = this.data.detailUI;
  if (!ui || !ui.participant || this.data.busy || this.data.loading || this.data.error) return;
  const choices = [];
  if (ui.canResolveException) choices.push({ label: '处理异常订单', action: 'resolve_exception' });
  if (ui.canException) choices.push({ label: '配送异常 / 申请取消', action: 'exception' });
  if (ui.canCancel) choices.push({ label: '取消订单', action: 'cancel' });
  choices.push({ label: '意见反馈', action: 'feedback' });
  if (this.data.config && this.data.config.templateId) choices.push({ label: '订阅订单提醒', action: 'subscribe' });
  wx.showActionSheet({ itemList: choices.map(x => x.label), success: result => {
   if (this.data.busy || this.data.loading || this.data.error) return;
   const item = choices[result.tapIndex]; if (!item) return;
   if (item.action === 'resolve_exception') this.bindResolveExceptionTap();
   else if (item.action === 'exception') this.bindPanel({ currentTarget: { dataset: { action: 'exception' } } });
   else if (item.action === 'cancel') this.bindConfirm({ currentTarget: { dataset: { action: 'cancel' } } });
   else if (item.action === 'subscribe') this.bindSubscription();
   else this.bindFeedbackTap();
  } });
 },
 bindUpdateProofTap() { if (this._visible) return this.bindPanel({ currentTarget: { dataset: { action: 'update_proof' } } }); },
 bindResolveExceptionTap() {
  const ui = this.data.detailUI;
  if (!this._visible || !ui || !ui.canResolveException || this.data.busy || this.data.loading || this.data.error || this._performing) return;
  wx.showActionSheet({ itemList: ['恢复订单流程', '取消订单'], success: result => {
   const resolution = result && result.tapIndex === 0 ? 'resume' : result && result.tapIndex === 1 ? 'cancel' : '';
   if (!resolution || !this._visible) return;
   const resume = resolution === 'resume';
   wx.showModal({
    title: resume ? '恢复订单流程' : '取消异常订单',
    content: resume ? '恢复后订单将回到异常前的状态，双方继续按原流程履约。确定恢复吗？' : '取消后订单将结束，已付款订单按支付规则进入退款处理。确定取消吗？',
    confirmText: resume ? '确定恢复' : '确定取消',
    success: modal => { if (modal.confirm && this._visible) this._resolveException(resolution); }
   });
  } });
 },
 async _resolveException(resolution) {
  const ui = this.data.detailUI;
  if (!this._visible || !ui || !ui.canResolveException || !['resume', 'cancel'].includes(resolution) || this.data.busy || this.data.loading || this.data.error || this._performing) return;
  this._performing = true; this.setData({ busy: true });
  try {
   if (!await PassportBiz.loginMustCancelWin(this) || !this._visible) return;
   await Ops.command('mail/resolve_exception', { id: this.data.id, resolution });
   invalidateOrderLists();
   if (this._visible) { await this.load(); wx.showToast({ title: resolution === 'resume' ? '订单流程已恢复' : '订单已取消' }); }
  } catch (e) { if (this._visible) { Ops.error(e); await this.load(); } }
  finally { this._performing = false; if (this._visible) this.setData({ busy: false }); else this.data.busy = false; }
 },
 bindPanel(e) {
  const action = e.currentTarget.dataset.action, ui = this.data.detailUI;
  const allowed = action === 'pickup' && ui && ui.primary === 'pickup'
   || action === 'deliver' && ui && ui.primary === 'deliver'
   || action === 'update_proof' && ui && ui.canUpdateProof
   || action === 'exception' && ui && ui.canException;
  if (!ui || this.data.busy || this.data.loading || this.data.error || !allowed) return;
  const proof = action === 'update_proof' && this.data.mail && this.data.mail.MAIL_DELIVERY_PROOF;
  const images = proof && Array.isArray(proof.images) ? proof.images.slice() : [];
  const previews = proof && this.data.mail.MAIL_MEDIA && this.data.mail.MAIL_MEDIA.proof || [];
  const proofVideo = proof && this.data.mail.MAIL_MEDIA && this.data.mail.MAIL_MEDIA.proofVideo && this.data.mail.MAIL_MEDIA.proofVideo[0] || '';
  this.setData({ panel: action, note: proof && proof.note || '', images, imagePreviews: Object.fromEntries(images.map((id, index) => [id, previews[index] || ''])),
   video: proof && proof.video || '', videoPreview: proofVideo, deliveryMode: proof && proof.mode === 'face' ? 'face' : 'place', reasonIndex: 0 });
 },
 bindStopProp() {},
 bindClosePanel() { if (!this.data.busy) this.setData({ panel: '', video: '', videoPreview: '' }); },
 bindNote(e) { if (!this.data.busy) this.setData({ note: e.detail.value }); },
 bindReason(e) { if (!this.data.busy) this.setData({ reasonIndex: Number(e.detail.value) }); },
 // 两种送达方式：放置指定位置需要凭证照片，当面交付由发布人确认收货。
 bindDeliveryMode(e) { if (this.data.busy) return; const mode = e.currentTarget.dataset.mode === 'face' ? 'face' : 'place'; this.setData({ deliveryMode: mode }); },
 // 凭证：照片与视频二选一，共用同一个「添加凭证」入口，避免两个重复的相机图标打架。
 bindAddProof() {
  if (this.data.busy || !this.data.panel) return;
  if (this.data.video) {
   wx.showModal({ title: '已添加视频凭证', content: '照片和视频只能选一种。如需改传照片，请先删除视频。', confirmText: '删除视频', cancelText: '保留视频', success: r => {
    if (!r.confirm || this.data.busy || !this.data.panel) return;
    this.setData({ video: '', videoPreview: '' }, () => this._openProofSourceSheet());
   } });
   return;
  }
  this._openProofSourceSheet();
 },
 _openProofSourceSheet() {
  if (this.data.busy || !this.data.panel) return;
  const choices = this.data.panel === 'exception'
   ? [{ label: '拍照', source: 'camera', media: 'image' }, { label: '从相册选择照片', source: 'album', media: 'image' }]
   : [{ label: '拍照', source: 'camera', media: 'image' }, { label: '从相册选择照片', source: 'album', media: 'image' },
    { label: '录制 15 秒视频', source: 'camera', media: 'video' }, { label: '从相册选择视频', source: 'album', media: 'video' }];
  wx.showActionSheet({ itemList: choices.map(x => x.label), success: r => {
   const item = choices[r.tapIndex];
   if (!item || this.data.busy || !this.data.panel) return;
   if (item.media === 'image') return this._pickPhotos(item.source);
   if (this.data.images.length) {
    wx.showModal({ title: '改用视频凭证', content: '照片和视频只能选一种，添加视频会清空已选的 ' + this.data.images.length + ' 张照片。', confirmText: '改用视频', cancelText: '取消', success: m => {
     if (!m.confirm || this.data.busy || !this.data.panel) return;
     this.setData({ images: [], imagePreviews: {} }, () => this._pickVideo(item.source));
    } });
    return;
   }
   this._pickVideo(item.source);
  } });
 },
 _pickPhotos(source) {
  if (this.data.busy || !this.data.panel) return;
  const remain = 10 - this.data.images.length;
  if (remain <= 0) return;
  wx.chooseMedia({ count: remain, mediaType: ['image'], sizeType: ['compressed'], sourceType: [source || 'album'], success: r => {
   if (this.data.busy || !this.data.panel) return;
   this.setData({ images: this.data.images.concat((r.tempFiles || []).map(file => file.tempFilePath)).slice(0, 10) });
  } });
 },
 _pickVideo(source) {
  if (this.data.busy || !this.data.panel) return;
  wx.chooseMedia({ count: 1, mediaType: ['video'], maxDuration: 15, camera: 'back', sourceType: [source || 'album'], success: r => {
   const file = (r.tempFiles || [])[0];
   if (!file || this.data.busy || !this.data.panel) return;
   if (Number(file.duration || 0) > 16) return wx.showToast({ title: '视频不能超过15秒', icon: 'none' });
   if (Number(file.size || 0) > 20 * 1024 * 1024) return wx.showToast({ title: '视频不能超过20MB', icon: 'none' });
   this.setData({ video: file.tempFilePath, videoPreview: file.tempFilePath });
  } });
 },
 bindImages(source) { return this._pickPhotos(typeof source === 'string' ? source : ''); },
 bindRemoveImage(e) { if (this.data.busy) return; this.setData({ images: this.data.images.filter((_, i) => i !== Number(e.currentTarget.dataset.index)) }); },
 // 每条凭证最多1段视频，时长不超过15秒。
 bindVideo(source) { return this._pickVideo(typeof source === 'string' ? source : ''); },
 bindRemoveVideo() { if (!this.data.busy) this.setData({ video: '', videoPreview: '' }); },
 bindPreviewVideo() { const src = this.data.videoPreview || this.data.video; if (src) wx.previewMedia({ sources: [{ url: src, type: 'video' }] }); },
 async bindConfirm(e) {
  const action = e.currentTarget.dataset.action, ui = this.data.detailUI;
  if (!ui || this.data.busy || this.data.loading || this.data.error || this._confirming || !(['pickup', 'deliver', 'confirm'].includes(action) && ui.primary === action || action === 'cancel' && ui.canCancel)) return;
  this._confirming = true;
  try {
   const prompts = {
    pickup: { title: '确认已取件', content: '确认已经取齐或购齐本单所有物品吗？接下来请上传凭证（照片或视频），提交后进入配送中。', confirmText: '上传凭证' },
    deliver: { title: '确认已送达', content: '确认已将本单所有包裹送到收件地址吗？接下来选择送达方式并提交凭证，提交后通知发布者确认收货。', confirmText: '提交凭证' },
    confirm: { title: '确认收货', content: '请先核对包裹、数量和外观是否无误。确认后将触发报酬分账；银行卡不会立即到账，可结算款项按账户安排在次日或下一个工作日分批打款，实际到账以支付机构和银行处理为准。' },
    cancel: { title: '取消订单', content: '取件前双方均可取消，不收违约金。取消后订单关闭、不重新上架，已支付金额将申请原路退回，到账以支付机构和银行处理为准。确定取消吗？' }
   };
   const result = await new Promise(resolve => wx.showModal({ ...prompts[action], success: resolve, fail: () => resolve({ confirm: false }) }));
   if (!result.confirm || !this._visible) return;
   if (action === 'confirm') return this._startConfirmGate();
   if (action === 'deliver' || action === 'pickup') return this.bindPanel({ currentTarget: { dataset: { action } } });
   await this.perform(action);
  } finally { if (!this.data.confirmGate) this._confirming = false; }
 },
 _clearConfirmTimer() { if (this._confirmTimer) { clearInterval(this._confirmTimer); this._confirmTimer = null; } },
 _startConfirmGate() {
  this._clearConfirmTimer();
  this.setData({ confirmGate: true, confirmCountdown: 5 });
  this._confirmTimer = setInterval(() => {
   const left = Math.max(0, Number(this.data.confirmCountdown || 0) - 1);
   this.setData({ confirmCountdown: left });
   if (!left) this._clearConfirmTimer();
  }, 1000);
 },
 bindGateCancel() { this._clearConfirmTimer(); this._confirming = false; this.setData({ confirmGate: false, confirmCountdown: 0 }); },
 async bindGateConfirm() {
  if (!this._visible || !this.data.confirmGate || this.data.confirmCountdown > 0 || this.data.busy) return;
  this._clearConfirmTimer(); this.setData({ confirmGate: false });
  try { await this.perform('confirm'); } finally { this._confirming = false; }
 },
 async bindSubmitPanel() {
  if (!this.data.panel || this.data.busy || this.data.pickupGate) return;
 const placeProof = this.data.deliveryMode !== 'face';
 const deliveryPanel = ['deliver', 'update_proof'].includes(this.data.panel);
 // 放置指定位置必须有说明与凭证；当面交付由发布人确认收货，凭证与说明都可以留空。
 // 凭证为照片与视频二选一，二者有其一即可提交。
 const needsProof = this.data.panel === 'pickup' || deliveryPanel && placeProof;
 const needsNote = this.data.panel === 'exception' || deliveryPanel && placeProof;
 const hasProof = this.data.images.length > 0 || !!this.data.video;
 if (needsNote && !this.data.note.trim()) { Ops.error(new Error('请填写送达位置与物品情况')); return; }
 if (needsProof && !hasProof) { Ops.error(new Error(this.data.panel === 'pickup' ? '取件请上传至少1张凭证照片或1段视频' : '请至少上传1张凭证照片或1段视频，或改为当面交付')); return; }
  // 快递代取：提交取件凭证即锁定包裹大小与价格，先弹出 2 秒提醒（可跳过）。
  if (this.data.panel === 'pickup' && this.data.detailUI && this.data.detailUI.serviceType === 'take') return this._startPickupGate();
  await this.perform(this.data.panel);
 },
 _clearPickupGate() { if (this._pickupTimer) { clearInterval(this._pickupTimer); this._pickupTimer = null; } },
 _startPickupGate() {
  this._clearPickupGate();
  this.setData({ pickupGate: true, pickupCountdown: 2 });
  this._pickupTimer = setInterval(() => {
   const left = Math.max(0, Number(this.data.pickupCountdown || 0) - 1);
   this.setData({ pickupCountdown: left });
   if (!left) this.bindPickupGateSkip();
  }, 1000);
 },
 async bindPickupGateSkip() {
  if (!this.data.pickupGate) return;
  this._clearPickupGate(); this.setData({ pickupGate: false, pickupCountdown: 2 });
  if (this._visible && this.data.panel === 'pickup') await this.perform('pickup');
 },
 // 公共详情页的「前往处理」入口；本页已就地展示调价操作，无需跳转。
 bindManageTap() {},
 bindOpenPriceSheet() {
  const ui = this.data.detailUI;
  if (!ui || !ui.priceAdjust || !ui.priceAdjust.canPropose || this.data.busy) return;
  this.setData({ priceSheet: true, priceValue: '', priceReason: '' });
 },
 bindClosePriceSheet() { if (!this.data.busy) this.setData({ priceSheet: false }); },
 bindPriceInput(e) { this.setData({ priceValue: String(e.detail.value || '').trim() }); },
 bindPriceReasonInput(e) { this.setData({ priceReason: e.detail.value }); },
 bindPriceReasonChip(e) { if (!this.data.busy) this.setData({ priceReason: e.currentTarget.dataset.reason }); },
 async bindSubmitPrice() {
  const ui = this.data.detailUI;
  if (this.data.busy || this._performing || !ui || !ui.priceAdjust || !ui.priceAdjust.canPropose) return;
  const price = this.data.priceValue, reason = String(this.data.priceReason || '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(price)) return Ops.error(new Error('请填写有效的新费用（最多两位小数）'));
  if (Number(price) <= Number(ui.fee)) return Ops.error(new Error('新费用须高于当前费用 ¥' + ui.fee));
  if (!reason) return Ops.error(new Error('请填写调价理由'));
  await this._priceCommand('mail/price_propose', { id: this.data.id, price, reason }, '已发送给发布人', () => this.setData({ priceSheet: false }));
 },
 async bindPriceRespond(e) {
  const decision = e.currentTarget.dataset.decision, ui = this.data.detailUI;
  if (!['agree', 'reject'].includes(decision) || !ui || !ui.priceAdjust || !ui.priceAdjust.canRespond || this.data.busy) return;
  const content = decision === 'agree' ? '同意后本单费用将由 ¥' + ui.priceAdjust.from + ' 调整为 ¥' + ui.priceAdjust.to + '，确定同意吗？' : '拒绝后本单仍按 ¥' + ui.priceAdjust.from + ' 计费，确定拒绝吗？';
  const result = await new Promise(resolve => wx.showModal({ title: decision === 'agree' ? '同意调价' : '拒绝调价', content, success: resolve, fail: () => resolve({ confirm: false }) }));
  if (!result.confirm || !this._visible) return;
  await this._priceCommand('mail/price_respond', { id: this.data.id, decision }, decision === 'agree' ? '已同意调价' : '已拒绝调价');
 },
 async bindReleaseOrder() {
  const ui = this.data.detailUI;
  if (!ui || !ui.priceAdjust || !ui.priceAdjust.canRelease || this.data.busy) return;
  const result = await new Promise(resolve => wx.showModal({ title: '放弃接单', content: '放弃后订单将按原价 ¥' + ui.fee + ' 重新发布给其他骑手，你将不能再接这一单。确定放弃吗？', confirmText: '确定放弃', success: resolve, fail: () => resolve({ confirm: false }) }));
  if (!result.confirm || !this._visible) return;
  if (this._performing) return;
  this._performing = true; this.setData({ busy: true });
  try {
   if (!await PassportBiz.loginMustCancelWin(this)) return;
   await Ops.command('mail/release', { id: this.data.id });
   invalidateOrderLists();
   // 放弃后已不是本单骑手，回到订单列表。
   if (this._visible) { wx.showToast({ title: '已放弃接单' }); this.bindBackOrders(); }
  } catch (e) { if (this._visible) { Ops.error(e); await this.load(); } }
  finally { this._performing = false; if (this._visible) this.setData({ busy: false }); else this.data.busy = false; }
 },
 async _priceCommand(route, params, toast, done) {
  if (this._performing) return;
  this._performing = true; this.setData({ busy: true });
  try {
   if (!await PassportBiz.loginMustCancelWin(this)) return;
   await Ops.command(route, params);
   invalidateOrderLists();
   if (this._visible) { if (done) done(); await this.load(); wx.showToast({ title: toast }); }
  } catch (e) { if (this._visible) { Ops.error(e); await this.load(); } }
  finally { this._performing = false; if (this._visible) this.setData({ busy: false }); else this.data.busy = false; }
 },
 async perform(action) {
  const ui = this.data.detailUI;
  if (this.data.busy || this.data.loading || this.data.error || !this.data.mail || !ui || this._performing) return;
  const allowed = ['pickup', 'deliver', 'confirm'].includes(action) && ui.primary === action || action === 'update_proof' && this._visible && ui.canUpdateProof || action === 'exception' && ui.canException || action === 'cancel' && ui.canCancel;
  if (!allowed) return;
  // Acquire the lock before awaiting login; repeated taps must not create parallel uploads.
  this._performing = true;
  this.setData({ busy: true });
  try {
   if (!await PassportBiz.loginMustCancelWin(this)) return;
   const params = { id: this.data.id };
   if (action === 'pickup') {
    params.note = this.data.note.trim();
    params.images = await Ops.upload(this.data.images);
    params.videos = await Ops.uploadVideo(this.data.video ? [this.data.video] : []);
   }
   if (['deliver', 'update_proof', 'exception'].includes(action)) {
    params.note = this.data.note.trim();
    params.images = await Ops.upload(this.data.images);
    if (action === 'exception') params.reason = this.data.reasons[this.data.reasonIndex];
    else {
     params.mode = this.data.deliveryMode === 'face' ? 'face' : 'place';
     params.videos = await Ops.uploadVideo(this.data.video ? [this.data.video] : []);
    }
   }
   const route = { pickup: 'mail/pickup', deliver: 'mail/deliver', update_proof: 'mail/update_proof', exception: 'mail/exception', confirm: 'mail/finish', cancel: 'mail/cancel' }[action];
   await Ops.command(route, params);
   invalidateOrderLists();
   if (this._visible) { this.setData({ panel: '' }); await this.load(); wx.showToast({ title: action === 'update_proof' ? '凭证已更新' : '操作成功' }); }
  } catch (e) { if (this._visible) { Ops.error(e); await this.load(); } }
  finally { this._performing = false; if (this._visible) this.setData({ busy: false }); else this.data.busy = false; }
 }
});
