'use strict';
const Base = require('./base_project_controller.js');
const MailService = require('../service/mail_service.js');
const check = require('../../../framework/validate/content_check.js');
const time = require('../../../framework/utils/time_util.js');
const store = require('../service/operation_store.js');
class MailController extends Base {
 async _limitAudit(){await store.limit('crun',this._userId,'order_audit',20,60000);}
 _input(extra = {}) { return this.validateData({id:'must|id',requestId:'must|string|min:16|max:100',...extra}); }
 async _action(method, extra = {}, audit = false) {
  const input=this._input(extra), svc=new MailService();
  if(audit) {
   const action={cancelMail:'cancel',deliverMail:'deliver',updateDeliveryProof:'update_proof',exceptionMail:'exception'}[method];
   const replay=await svc.replayRequest(this._userId,action,input); if(replay)return replay;
   input._sourceFingerprint=store.key(input);
   const oldProof=method === 'updateDeliveryProof' ? await svc.getDeliveryProofForUpdate(this._userId,input.id) : null;
   await this._limitAudit();await check.checkTextMultiClient(input); input.images=await this._checkImages(input.images || [],oldProof && oldProof.images || []);
  }
  return svc[method](this._userId,input.id,input);
 }
 async _checkImages(images,allowed=[]) { const result=[];for (const id of require('../service/order_rules.js').images(images)) result.push(await check.checkCloudImage(id,allowed));return result; }
 async acceptMail() {return this._action('acceptMail');}
 async pickupMail() {return this._action('pickupMail');}
 async cancelMail() {return this._action('cancelMail',{note:'string|max:300'},true);}
 async finishMail() {return this._action('finishMail');}
 async deliverMail() {return this._action('deliverMail',{note:'string|max:300',images:'array'},true);}
 async updateDeliveryProof() {return this._action('updateDeliveryProof',{note:'must|string|max:300',images:'must|array'},true);}
 async exceptionMail() {return this._action('exceptionMail',{reason:'must|string|max:30',note:'must|string|max:500',images:'array'},true);}
 async statusMail() {return new MailService().statusMail();}
 async delMail() {return this._action('delMail');}
 async updateMailForms() {return new MailService().updateMailForms();}
 async _form(edit) {
  const input=this.validateData({...(edit?{id:'must|id'}:{}),requestId:'must|string|min:16|max:100',forms:'must|array',cateId:'string|max:30'}), svc=new MailService();
  // A committed request is acknowledged before audit quotas, media downloads
  // or current deadline validation. A lost response must stay recoverable.
  const replay=await svc.replayRequest(this._userId,edit?'edit':'publish',input); if(replay)return replay;
  input._sourceFingerprint=store.key(input);
  await this._limitAudit();await check.checkTextMultiClient(input);
  const old=edit?await svc.getMailDetail(this._userId,input.id):null;
  const obj=old && old.MAIL_OBJ || {};
  const allowed=[...(Array.isArray(obj.imgUrls) ? obj.imgUrls : []),...(Array.isArray(obj.packages) ? obj.packages : []).flatMap(row=>row && Array.isArray(row.images) ? row.images : [])];
  for(const f of input.forms) {
   if(!f || typeof f!=='object')this.AppError('订单表单格式错误');
   if(f.mark==='img') f.val=await this._checkImages(f.val,allowed);
   if(f.mark==='packages') {
    if(typeof f.val==='string'){try{f.val=JSON.parse(f.val);}catch(_){this.AppError('包裹信息格式错误');}}
    if(!Array.isArray(f.val))this.AppError('包裹信息格式错误');
    for(const item of f.val) {if(!item || typeof item!=='object')this.AppError('包裹信息格式错误');item.images=await this._checkImages(item.images || [],allowed);}
   }
  }
  return edit?svc.editMail(this._userId,input):svc.insertMail(this._userId,input);
 }
 async insertMail() {return this._form(false);}
 async editMail() {return this._form(true);}
 async getMailDetail() {const p=this.validateData({id:'must|id'});return new MailService().getMailDetail(this._userId,p.id);}
 _format(mail) {
  if(!mail)return mail;
  const format = (value, pattern) => {
   const at = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
   return Number.isFinite(at) && at > 0 && Number.isFinite(new Date(at).getTime()) ? time.timestamp2Time(at, pattern) : '';
  };
  mail.end=format(mail.MAIL_END_TIME,'Y/M/D h:m:s'); mail.end2=format(mail.MAIL_END_TIME,'Y-M-D h:m');
  for(const key of ['MAIL_ADD_TIME','MAIL_ACCEPT_TIME','MAIL_OVER_TIME']) mail[key]=format(mail[key],'Y-M-D h:m');
  return mail;
 }
 async viewMail() {const p=this.validateData({id:'must|id'});return this._format(await new MailService().viewMail(this._userId,p.id));}
 async getMailList() {const p=this.validateData({search:'string|max:30',sortType:'string|max:30',sortVal:'string|max:30',orderBy:'object',whereEx:'object',cursor:'object',isTotal:'bool',oldTotal:'int|min:0',page:'int|default=1|min:1|max:500',size:'int|default=20|min:1|max:50'});const result=await new MailService().getMailList(this._userId,p);result.list=result.list.map(m=>{const left=m.MAIL_END_TIME-Date.now(),minutes=left<=0?0:Math.ceil(left/60000),hours=Math.floor(minutes/60),rest=minutes%60;m.MAIL_OBJ=m.MAIL_OBJ||{};m.MAIL_OBJ.leftTimeLabel=left<=0?'已截止':hours>0?hours+'小时'+(rest?rest+'分钟':''):minutes+'分钟';return this._format(m);});return result;}
}
module.exports=MailController;
