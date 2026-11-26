const ProjectBiz = require('../../../biz/project_biz.js');

const Ops = require('../../../biz/operations_biz.js');

const emptyForm = () => ({ realName: '', identity: '', bankCard: '', phone: '' });
const documents = {
 rules: {
  title: '云速取跑腿服务规则',
  paragraphs: [
   '申请人应使用本人真实身份及本人银行卡申请跑腿结算，并阅读开户页面列明的信息处理说明。',
   '开通须通过第三方支付机构的身份与结算账户验证。跑腿服务应基于真实订单，妥善取送物品并按要求提交履约凭证。',
   '订单完成并满足结算条件后，按平台公示的规则申请结算；退款、申诉或其他异常订单需先完成核对。手续费、到账时间及结算条件以实际开户协议和订单说明为准。'
  ]
 },
 privacy: {
  title: '实名信息处理说明',
  paragraphs: [
   '真实姓名、身份证号、本人银行卡号及银行预留手机号用于开户与结算验证。请确保信息属于本人，并在提交前阅读支付机构的服务协议与隐私政策。',
   '填写内容离开页面后清空，申请时由服务端临时处理；云速取不将完整证件号、银行卡号或证照写入本地缓存、平台数据库及日志。',
   '实名及银行卡信息经加密传输，通过云速取云函数临时转交给汇付天下（AdaPay），用于开户和结算验证。云速取仅保存办理结算所需的第三方账户标识、脱敏信息、处理状态及带服务端密钥的对应摘要。',
  ]
 }
};

Page({
 data: { account: null, statusLoading: true, statusError: '', form: emptyForm(), rulesAccepted: false, authorizationAccepted: false, error: '', document: null, submitting: false },
 onLoad() { ProjectBiz.initPage(this); },
 onShow() {
  this._unloaded = false; this._active = true;
  this._generation = (this._generation || 0) + 1;
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
   this.setData({account,statusLoading:false});
  } catch (_) {
   if (isCurrent()) this.setData({account:null,statusLoading:false,statusError:'暂时无法获取结算信息，请稍后重试'});
  }
 },
 bindRetryStatus() { return this._loadStatus(); },
 onHide() {
  this._generation = (this._generation || 0) + 1; this._active = false;
  this.clearForm(); this.setData({account:null,statusLoading:true,statusError:''});
 },
 onUnload() { this._unloaded = true; this.onHide(); },
 clearForm() {
  this.setData({ form: emptyForm(), rulesAccepted: false, authorizationAccepted: false, error: '', document: null, submitting: false });
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
  const document = documents[kind];
  if (document) this.setData({ document });
 },
 bindCloseDocument() { this.setData({ document: null }); },
 bindStop() {},
 async bindSubmit() {
  if (this.data.submitting || this.data.statusLoading || this.data.statusError || !this.data.account || this.data.account.opened) return;
  const generation=this._generation;
  const form = this.data.form;
  let error = '';
  if (!form.realName.trim()) error = '请填写本人真实姓名';
  else if (!/^\d{17}[\dXx]$/.test(form.identity.trim())) error = '请填写18位身份证号';
  else if (!/^\d{16,19}$/.test(form.bankCard.replace(/\s/g, ''))) error = '请填写16至19位本人银行卡号';
  else if (!/^1\d{10}$/.test(form.phone.trim())) error = '请填写11位银行预留手机号';
  else if (!this.data.rulesAccepted || !this.data.authorizationAccepted) error = '请阅读并勾选服务规则与实名信息授权';
  this.setData({ error });
  if (error) return;
  this.setData({ submitting: true });
  try {
   const account=await Ops.get('settlement/open', {...form,rulesAccepted:this.data.rulesAccepted,authorizationAccepted:this.data.authorizationAccepted});
   if(this._unloaded || this._active === false || generation!==this._generation)return;
   this.clearForm(); this.setData({account});
   wx.showModal({title:account.opened?'开通成功':'申请处理中',content:account.opened?'跑腿结算账户已开通，收益将按支付机构规则结算至本人银行卡。':'请稍后刷新核对办理结果。',showCancel:false});
  } catch(e) {
   if(this._unloaded || this._active === false || generation!==this._generation)return;
   this.setData({error:e.msg || e.message || '办理结果待确认，请稍后刷新或联系在线客服'});
  } finally {if(!this._unloaded && this._active !== false && generation===this._generation)this.setData({submitting:false});}
 }
});
