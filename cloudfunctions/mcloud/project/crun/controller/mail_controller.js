'use strict';
const Base = require('./base_project_controller.js');
const MailService = require('../service/mail_service.js');
const check = require('../../../framework/validate/content_check.js');
const time = require('../../../framework/utils/time_util.js');
class MailController extends Base {
 async _limitAudit(){await require('../service/operation_store.js').limit('crun',this._userId,'order_audit',20,60000);}
 _input(extra = {}) { return this.validateData({id:'must|id',requestId:'must|string|min:16|max:100',...extra}); }
 async _action(method, extra = {}, audit = false) { const input=this._input(extra); if(audit) {await this._limitAudit();await check.checkTextMultiClient(input); input.images=await this._checkImages(input.images || []);} return new MailService()[method](this._userId,input.id,input); }
 async _checkImages(images,allowed=[]) { const result=[];for (const id of require('../service/order_rules.js').images(images)) result.push(await check.checkCloudImage(id,allowed));return result; }
 async acceptMail() {return this._action('acceptMail');}
 async cancelMail() {return this._action('cancelMail',{note:'string|max:300'},true);}
 async finishMail() {return this._action('finishMail');}
 async deliverMail() {return this._action('deliverMail',{note:'must|string|max:300',images:'must|array'},true);}
 async exceptionMail() {return this._action('exceptionMail',{reason:'must|string|max:30',note:'must|string|max:500',images:'array'},true);}
 async statusMail() {return new MailService().statusMail();}
 async delMail() {return this._action('delMail');}
 async updateMailForms() {return new MailService().updateMailForms();}
 async _form(edit) { const input=this.validateData({...(edit?{id:'must|id'}:{}),requestId:'must|string|min:16|max:100',forms:'must|array',cateId:'string|max:30'}); await this._limitAudit();await check.checkTextMultiClient(input); const svc=new MailService();const old=edit?await svc.getMailDetail(this._userId,input.id):null;const allowed=old && old.MAIL_OBJ.imgUrls || [];for(const f of input.forms) if(f.mark==='img') f.val=await this._checkImages(f.val,allowed); return edit?svc.editMail(this._userId,input):svc.insertMail(this._userId,input); }
 async insertMail() {return this._form(false);}
 async editMail() {return this._form(true);}
 async getMailDetail() {const p=this.validateData({id:'must|id'});return new MailService().getMailDetail(this._userId,p.id);}
 _format(mail) {
  if(!mail)return mail;
  mail.end=time.timestamp2Time(mail.MAIL_END_TIME,'Y/M/D h:m:s'); mail.end2=time.timestamp2Time(mail.MAIL_END_TIME,'Y-M-D h:m');
  for(const key of ['MAIL_ADD_TIME','MAIL_ACCEPT_TIME','MAIL_OVER_TIME']) mail[key]=mail[key]?time.timestamp2Time(mail[key],'Y-M-D h:m'):'';
  return mail;
 }
 async viewMail() {const p=this.validateData({id:'must|id'});return this._format(await new MailService().viewMail(this._userId,p.id));}
 async getMailList() {const p=this.validateData({search:'string|max:30',sortType:'string|max:30',sortVal:'string|max:30',orderBy:'object',whereEx:'object',page:'int|default=1|min:1|max:500',size:'int|default=20|min:1|max:50'});const result=await new MailService().getMailList(this._userId,p);result.list=result.list.map(m=>{const left=m.MAIL_END_TIME-Date.now();m.MAIL_OBJ.leftTimeLabel=left<=0?'已截止':Math.ceil(left/60000)+'分钟';return this._format(m);});return result;}
}
module.exports=MailController;
