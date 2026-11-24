const ProjectBiz = require('../../../biz/project_biz.js');

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
   '填写内容仅在当前页面内保留，离开页面后清空；云速取不将完整证件号、银行卡号或证照写入本地缓存、平台数据库及日志。',
   '开户通道可用时，实名及银行卡信息须通过经确认的数据直传通道提交给第三方支付机构。云速取仅保存办理结算所需的第三方账户标识、脱敏信息、处理状态及带服务端密钥的对应摘要。',
  ]
 }
};

Page({
 data: { form: emptyForm(), rulesAccepted: false, authorizationAccepted: false, error: '', document: null, submitting: false },
 onLoad() { ProjectBiz.initPage(this); },
 onHide() { this.clearForm(); },
 onUnload() { this._unloaded = true; this.clearForm(); },
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
 bindSubmit() {
  if (this.data.submitting) return;
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
  wx.showModal({
   title: '暂时无法开通',
   content: '结算开户服务暂不可用，本次申请未提交。请稍后重试，或通过云速取在线客服了解办理进度。',
   showCancel: false,
   confirmText: '我知道了',
   complete: () => { if (!this._unloaded) this.setData({ submitting: false }); }
  });
 }
});
