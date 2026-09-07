'use strict';
const Base = require('./base_project_admin_controller.js');
const Service = require('../../service/operations_service.js');
const Config = require('../../service/operation_config_service.js');
const Mail = require('../../service/mail_service.js');
const check = require('../../../../framework/validate/content_check.js');
class AdminOperationsController extends Base {
 async getConfig(){await this.isAdmin();return new Config().getConfig();}
 async saveConfig(){await this.isSuperAdmin();const p=this.validateData({value:'must|object'});await check.checkTextMultiAdmin(p);return new Config().saveConfig(p.value,this._adminId);}
 async riders(){await this.isAdmin();const p=this.validateData({page:'int|default=1|min:1|max:500'});return new Service().riders(p.page);}
 async riderReview(){await this.isAdmin();const p=this.validateData({id:'must|id',status:'must|int',reason:'must|string|max:300'});await check.checkTextMultiAdmin(p);return new Service().riderReview(this._adminId,p.id,p.status,p.reason);}
 async orders(){await this.isAdmin();const p=this.validateData({page:'int|default=1|min:1|max:500',status:'int'});return new Service().orders(p.page,p.status);}
 async orderDetail(){await this.isAdmin();const p=this.validateData({id:'must|id'});return new Mail().getMailDetail(null,p.id);}
 async hold(){await this.isAdmin();const p=this.validateData({id:'must|id',requestId:'must|string|min:16|max:100',note:'must|string|max:500'});await check.checkTextMultiAdmin(p);return new Mail().holdMail(this._adminId,p.id,p);}
 async resolve(){await this.isAdmin();const p=this.validateData({id:'must|id',requestId:'must|string|min:16|max:100',resolution:'must|string|max:20',note:'must|string|max:500'});await check.checkTextMultiAdmin(p);return new Mail().resolveMail(this._adminId,p.id,p);}
 async overview(){await this.isAdmin();return new Service().overview();}
 async maintain(){await this.isSuperAdmin();return new (require('../../service/maintenance_service.js'))().run();}
}
module.exports=AdminOperationsController;
