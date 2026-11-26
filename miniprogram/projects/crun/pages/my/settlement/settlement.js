const ProjectBiz = require('../../../biz/project_biz.js');
const Agreements = require('../../../public/agreements.js');
const Ops = require('../../../biz/operations_biz.js');

const emptyForm = () => ({ realName: '', identity: '', bankCard: '', phone: '' });
// 填写内容只保存在当前页面内存中，不写缓存、不上传保存。切到后台或打开协议后回来仍在；
// 关闭页面立即清空，离开超过 10 分钟也清空。
const FORM_KEEP_MS = 10 * 60 * 1000;
const plain = text => ({ type: 'p', segments: [{ t: text, b: false }] });
const documents = {
 rules: () => Agreements.get('rider'),
 privacy: () => ({
  title: '实名信息处理说明',
  meta: [],
  blocks: [
   '真实姓名、身份证号、本人银行卡号及银行预留手机号用于开户与结算验证。请确保信息属于本人，并在提交前阅读支付机构的服务协议与隐私政策。',
   '填写内容只保存在当前页面，关闭页面或离开超过10分钟后清空；申请时由服务端临时处理，云速取不将完整证件号、银行卡号或证照写入本地缓存、平台数据库及日志。',
   '实名及银行卡信息经加密传输，通过云速取云函数临时转交给汇付天下（AdaPay），用于开户和结算验证。云速取仅保存办理结算所需的第三方账户标识、脱敏信息、处理状态及带服务端密钥的对应摘要。'
  ].map(plain)
 })
};

Page({
 data: { account: null, statusLoading: true, statusError: '', mode: 'open', form: emptyForm(), rulesAccepted: false, authorizationAccepted: false, error: '', document: null, submitting: false },
 onLoad() { ProjectBiz.initPage(this); },
 onShow() {
  this._unloaded = false; this._active = true;
  this._generation = (this._generation || 0) + 1;
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
  this.setData({account,statusLoading:false,statusError:'',mode:account.opened && this.data.mode === 'change' ? 'change' : 'open'});
 },
 bindRetryStatus() { return this._loadStatus(); },
 onHide() {
  this._generation = (this._generation || 0) + 1; this._active = false;
  this._hiddenAt = Date.now();
  this.setData({document:null});
 },
 onUnload() {
  this._unloaded = true; this._generation = (this._generation || 0) + 1; this._active = false;
  this.clearForm(); this.setData({account:null,statusLoading:true,statusError:''});
 },
 clearForm() {
  this.setData({ form: emptyForm(), rulesAccepted: false, authorizationAccepted: false, error: '', document: null, submitting: false, mode: 'open' });
 },
 bindInput(event) {
  const field = event.currentTarget.dataset.field;
  if (!Object.prototype.hasOwnProperty.call(this.data.form, field)) return;
  this.setData({ ['form.' + field]: field === 'identity' ? String(event.detail.value || '').trim().toUpperCase() : String(event.detail.value || ''), error: '' });
 },
 bindAgreement(event) {
  const values = event.detail.value || [];
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
  if (document) this.setData({ document });
 },
 bindCloseDocument() { this.setData({ document: null }); },
 bindStop() {},
 bindStartChange() {
  if (this.data.submitting || !this.data.account || !this.data.account.opened) return;
  this.setData({ mode: 'change', form: emptyForm(), rulesAccepted: false, authorizationAccepted: false, error: '' });
 },
 bindCancelChange() {
  if (this.data.submitting) return;
  this.clearForm();
 },
 async bindSubmit() {
  const account = this.data.account;
  const changing = this.data.mode === 'change';
  if (this.data.submitting || this.data.statusLoading || this.data.statusError || !account || account.opened !== changing) return;
  const generation=this._generation;
  const form = this.data.form;
  let error = '';
  if (!form.realName.trim()) error = changing ? '请填写开通时的本人真实姓名' : '请填写本人真实姓名';
  else if (!/^\d{17}[\dXx]$/.test(form.identity.trim())) error = '请填写18位身份证号';
  else if (!/^\d{16,19}$/.test(form.bankCard.replace(/\s/g, ''))) error = '请填写16至19位本人银行卡号';
  else if (!/^1\d{10}$/.test(form.phone.trim())) error = '请填写11位银行预留手机号';
  else if (!this.data.rulesAccepted || !this.data.authorizationAccepted) error = '请阅读并勾选服务协议与实名信息授权';
  this.setData({ error });
  if (error) return;
  this.setData({ submitting: true });
  const isCurrent = () => !this._unloaded && this._active !== false && generation === this._generation;
  try {
   const result=await Ops.get(changing ? 'settlement/change' : 'settlement/open', {...form,rulesAccepted:this.data.rulesAccepted,authorizationAccepted:this.data.authorizationAccepted});
   if(!isCurrent())return;
   this.clearForm(); this.setData({account:result});
   const title = result.opened ? (changing ? '更换成功' : '开通成功') : '申请处理中';
   const content = result.opened
    ? (changing ? '结算银行卡已更换为尾号 ' + result.cardTail + ' 的银行卡，之后的收益将结算至新卡。' : '跑腿结算账户已开通，收益将按支付机构规则结算至本人银行卡。')
    : '支付机构正在处理，请稍后刷新本页核对办理结果。';
   wx.showModal({title,content,showCancel:false});
  } catch(e) {
   if(!isCurrent())return;
   this.setData({submitting:false});
   // 云端返回的是具体原因（如预留手机号不一致），用弹窗明确告知；填写内容保留，方便修改后重新提交。
   wx.showModal({title:changing ? '更换未完成' : '开通未成功',content:e.msg || e.message || '办理结果待确认，请稍后刷新或联系在线客服',showCancel:false,confirmText:'我知道了'});
   // 失败后状态可能已变化（例如原卡已解除、进入待核对），静默刷新页面上的状态。
   this._refreshStatus(true);
  } finally {if(isCurrent())this.setData({submitting:false});}
 }
});
