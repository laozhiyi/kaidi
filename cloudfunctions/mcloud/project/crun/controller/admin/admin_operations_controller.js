'use strict';
const Base = require('./base_project_admin_controller.js');
const Service = require('../../service/operations_service.js');
const Config = require('../../service/operation_config_service.js');
const Mail = require('../../service/mail_service.js');
const check = require('../../../../framework/validate/content_check.js');
class AdminOperationsController extends Base {
 async getConfig(){await this.isAdmin();return new Config().getConfig();}
 async saveConfig(){await this.isSuperAdmin();const p=this.validateData({value:'must|object',section:'string|max:20'});await check.checkTextMultiAdmin(p);return new Config().saveConfig(p.value,this._adminId,p.section);}
 async orders(){await this.isAdmin();const p=this.validateData({page:'int|default=1|min:1|max:500',status:'int',search:'string|max:50',campus:'string|max:30',sort:'string|max:20',overdue:'bool'});return new Service().orders(p.page,p.status,p);}
 async orderDetail(){await this.isAdmin();const p=this.validateData({id:'must|id'});return new Service().orderDetail(p.id);}
 async hold(){await this.isAdmin();const p=this.validateData({id:'must|id',requestId:'must|string|min:16|max:100',note:'must|string|max:500'});await check.checkTextMultiAdmin(p);return new Mail().holdMail(this._adminId,p.id,p);}
 async resolve(){await this.isAdmin();const p=this.validateData({id:'must|id',requestId:'must|string|min:16|max:100',resolution:'must|string|max:20',note:'must|string|max:500'});await check.checkTextMultiAdmin(p);return new Mail().resolveMail(this._adminId,p.id,p);}
 async overview(){await this.isAdmin();return new Service().overview();}
 async maintain(){await this.isSuperAdmin();return new (require('../../service/maintenance_service.js'))().run();}
 async recover(){await this.isAdmin();const p=this.validateData({route:'must|string|max:60',requestId:'must|string|min:16|max:100',id:'string|max:100'});return new (require('../../service/request_recovery_service.js'))().recover('',p,this._adminId);}
}
module.exports=AdminOperationsController;
