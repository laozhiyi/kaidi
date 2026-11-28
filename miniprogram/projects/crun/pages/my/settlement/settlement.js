const Guide = require('../../../biz/form_guide_biz.js');
const ProjectBiz = require('../../../biz/project_biz.js');
const Agreements = require('../../../public/agreements.js');
const Ops = require('../../../biz/operations_biz.js');

const emptyForm = () => ({ realName: '', identity: '', bankCard: '', phone: '' });
// 填写内容只保存在当前页面内存中，不写缓存、不上传保存。切到后台或打开协议后回来仍在；
// 关闭页面立即清空，离开超过 10 分钟也清空。
const FORM_KEEP_MS = 10 * 60 * 1000;
const pad = value => String(value).padStart(2, '0');
// 当前银行卡的绑定时间，换卡成功后更新。
function dateText(ms) {
 if (!(Number(ms) > 0)) return '';
 const d = new Date(Number(ms));
 return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}
const documents={rules:()=>Agreements.get('rider'),privacy:()=>Agreements.get('identity')};

Page({
 data: { account: null, boundAtText: '', statusLoading: true, statusError: '', mode: 'open', form: emptyForm(), rulesAccepted: false, authorizationAccepted: false, error: '', document: null, submitting: false },
 onLoad(options = {}) { ProjectBiz.initPage(this); this._focusAgreement = options.focus === 'agreement'; },
 onShow() {
  this._unloaded = false; this._active = true;
  this._generation = (this._generation || 0) + 1;
  // 开通、换卡或确认协议的请求还没返回：保持提交中，等结果回来再更新页面，不清表单、不刷新状态。
  if (this._submitInFlight) { this._hiddenAt = 0; return; }
  // 切到后台期间返回的办理结果，回到页面时再告知。
  if (this._pendingNotice) { const notice = this._pendingNotice; this._pendingNotice = null; wx.showModal(notice); }
  const expired = this._hiddenAt && Date.now() - this._hiddenAt > FORM_KEEP_MS;
  this._hiddenAt = 0;
  if (expired) this.clearForm();
  // 已经加载过结算信息时静默刷新，表单保持显示；首次进入或加载失败时显示加载状态。
  if (this.data.account && !expired) return this._refreshStatus();
  return this._loadStatus();
 },
 async _loadStatus() {
  if (this._unloaded || !this._active) return;
  const generation = this._generation;
  if (this.data.statusLoading && this._statusLoadingGeneration === generation) return;
  this._statusLoadingGeneration = generation;
  const isCurrent = () => !this._unloaded && this._active && generation === this._generation;
  this.setData({statusLoading:true,statusError:'',account:null,error:'',document:null});
  try {
   const account = await Ops.get('settlement/status');
   if (!isCurrent()) return;
   if (!account || typeof account.opened !== 'boolean') throw new Error('INVALID_SETTLEMENT_STATUS');
   this._applyAccount(account);
  } catch (_) {
   if (isCurrent()) this.setData({account:null,statusLoading:false,statusError:'暂时无法获取结算信息，请稍后重试'});
  }
 },
 // 静默刷新：失败时保留当前显示，不打断填写。
 async _refreshStatus(keepForm = false) {
  if (this._unloaded || !this._active || this.data.submitting || this._refreshing) return;
  const generation = this._generation;
  this._refreshing = true;
  try {
   const account = await Ops.get('settlement/status');
   if (this._unloaded || !this._active || generation !== this._generation || this.data.submitting) return;
   if (account && typeof account.opened === 'boolean') this._applyAccount(account, keepForm);
  } catch (_) { /* 保留当前状态 */ } finally { this._refreshing = false; }
 },
 _applyAccount(account, keepForm = false) {
  const previous = this.data.account;
  // 开通状态变化（例如待核对的申请已完成）后，原来填的内容不再适用；
  // 换卡失败导致原卡已解除时保留填写内容，用户改正后直接按开通流程重新提交。
  if (previous && previous.opened !== account.opened && !keepForm) this.clearForm();
  this.setData({account,boundAtText:dateText(account.boundAt),statusLoading:false,statusError:'',mode:account.opened && this.data.mode === 'change' && !account.changeBlocked ? 'change' : 'open'});
  if (this._focusAgreement) { this._focusAgreement = false; if (!account.consentCurrent || !account.opened) Guide.show(this, 'rules', '请阅读骑手协议并自主勾选确认'); }
 },
 bindRetryStatus() { return this._loadStatus(); },
 onHide() {
  this._generation = (this._generation || 0) + 1; this._active = false;
  this._hiddenAt = Date.now();
  // 不重置 submitting：请求仍在进行时按钮保持不可用，避免回到页面后重复提交。
  this.setData({document:null});
 },
 // 页面在前台直接弹窗；在后台时先记下，回到页面再弹。
 _notify(modal) {
  if (this._active !== false) wx.showModal(modal); else this._pendingNotice = modal;
 },
 onUnload() {
  this._unloaded = true; this._generation = (this._generation || 0) + 1; this._active = false;
  this.clearForm(); this.setData({account:null,statusLoading:true,statusError:''});
 },
 clearForm() {
  Guide.clear(this);
  this.setData({ form: emptyForm(), rulesAccepted: false, authorizationAccepted: false, error: '', document: null, submitting: false, mode: 'open' });
 },
 bindInput(event) {
  const field = event.currentTarget.dataset.field;
  Guide.clear(this, field);
  if (!Object.prototype.hasOwnProperty.call(this.data.form, field)) return;
  this.setData({ ['form.' + field]: field === 'identity' ? String(event.detail.value || '').trim().toUpperCase() : String(event.detail.value || ''), error: '' });
 },
 bindAgreement(event) {
  const values = event.detail.value || [];
  if (values.includes(this.data.guideField)) Guide.clear(this, this.data.guideField);
  this.setData({
   rulesAccepted: values.includes('rules'),
   authorizationAccepted: values.includes('authorization'),
   error: ''
  });
 },
 bindDocument(event) {
  const kind = event.currentTarget.dataset.kind;
  if (!Object.prototype.hasOwnProperty.call(documents, kind)) return;
  const document = documents[kind]();
  if (document) wx.navigateTo({url:'/projects/crun/pages/about/agreement/about_agreement?key='+document.key});
 },
 bindCloseDocument() { this.setData({ document: null }); },
 bindStop() {},
 bindStartChange() {
  const account = this.data.account;
  if (this.data.submitting || !account || !account.opened) return;
  if (account.changeBlocked) { wx.showModal({ title: '暂时不能更换', content: account.changeBlocked, showCancel: false, confirmText: '我知道了' }); return; }
  this.setData({ mode: 'change', form: emptyForm(), rulesAccepted: false, authorizationAccepted: false, error: '' });
 },
 bindCancelChange() {
  if (this.data.submitting) return;
  this.clearForm();
 },
 async bindSubmit() {
  const account = this.data.account;
  const changing = this.data.mode === 'change';
  const updating = account && account.opened && !changing && !account.consentCurrent;
  if (this.data.submitting || this.data.statusLoading || this.data.statusError || !account || account.opened !== changing && !updating) return;
  // 提交结果以云端返回为准：切到后台期间返回也照常更新页面，只有关闭页面才丢弃。
  const alive = () => !this._unloaded;
  if (updating) {
   if (!this.data.rulesAccepted || !this.data.authorizationAccepted) { const message='请分别阅读并勾选新版骑手协议与实名信息授权'; this.setData({error:message}); Guide.show(this, this.data.rulesAccepted ? 'authorization' : 'rules', message); return; }
   this._submitInFlight = true;
   this.setData({submitting:true,error:''});
   try {
    const result=await Ops.get('settlement/accept',{rulesAccepted:true,authorizationAccepted:true,rulesVersion:Agreements.VERSION,authorizationVersion:Agreements.VERSION});
    if (alive()) this.setData({account:{...account,...result},rulesAccepted:false,authorizationAccepted:false});
   } catch(error) {if (alive()) this.setData({error:error.msg || error.message || '确认失败，请重试'});}
   finally {this._submitInFlight = false; if (alive()) this.setData({submitting:false});}
   return;
  }
  const form = this.data.form;
  let error = '', field = '';
  if (!form.realName.trim()) field = 'realName', error = changing ? '请填写开通时的本人真实姓名' : '请填写本人真实姓名';
  else if (!/^\d{17}[\dXx]$/.test(form.identity.trim())) field = 'identity', error = '请填写18位身份证号';
  else if (!/^\d{16,19}$/.test(form.bankCard.replace(/\s/g, ''))) field = 'bankCard', error = '请填写16至19位本人银行卡号';
  else if (!/^1\d{10}$/.test(form.phone.trim())) field = 'phone', error = '请填写11位银行预留手机号';
  else if (!this.data.rulesAccepted || !this.data.authorizationAccepted) field = this.data.rulesAccepted ? 'authorization' : 'rules', error = '请阅读并勾选服务协议与实名信息授权';
  this.setData({ error });
  if (error) { Guide.show(this, field, error); return; }
  Guide.clear(this);
  this._submitInFlight = true;
  this.setData({ submitting: true });
  try {
   const result=await Ops.get(changing ? 'settlement/change' : 'settlement/open', {...form,rulesAccepted:this.data.rulesAccepted,authorizationAccepted:this.data.authorizationAccepted,rulesVersion:Agreements.VERSION,authorizationVersion:Agreements.VERSION});
   if(!alive())return;
   this.clearForm(); this.setData({account:result,boundAtText:dateText(result.boundAt)});
   const title = result.opened ? (changing ? '更换成功' : '开通成功') : '申请处理中';
   const content = result.opened
    ? (changing ? '结算银行卡已更换为尾号 ' + result.cardTail + ' 的银行卡，之后的收益将结算至新卡。' : '跑腿结算账户已开通，收益将按支付机构规则结算至本人银行卡。')
    : '支付机构正在处理，请稍后刷新本页核对办理结果。';
   this._notify({title,content,showCancel:false});
  } catch(e) {
   this._submitInFlight = false;
   if(!alive())return;
   this.setData({submitting:false});
   // 云端返回的是具体原因（如预留手机号不一致），用弹窗明确告知；填写内容保留，方便修改后重新提交。
   this._notify({title:changing ? '更换未完成' : '开通未成功',content:e.msg || e.message || '办理结果待确认，请稍后刷新或通过意见反馈提交问题',showCancel:false,confirmText:'我知道了'});
   // 失败后状态可能已变化（例如原卡已解除、进入待核对），静默刷新页面上的状态；在后台时由回到页面的刷新处理。
   this._refreshStatus(true);
  } finally {this._submitInFlight = false; if(alive())this.setData({submitting:false});}
 }
});
