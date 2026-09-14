'use strict';
const Base = require('./base_project_controller.js');
const Service = require('../service/operations_service.js');
class OperationsController extends Base {
 async getConfig(){return new Service().config(this._userId);}
 async notifications(){const p=this.validateData({page:'int|default=1|min:1|max:500',unreadOnly:'bool|default=false',cursor:'object'});return new Service().notifications(this._userId,p.page,{unreadOnly:p.unreadOnly,cursor:p.cursor});}
 async notificationSummary(){return new Service().notificationSummary(this._userId);}
 async markRead(){const p=this.validateData({id:'must|id',kind:'string|default=notification'});return new Service().markRead(this._userId,p.id,p.kind);}
 async markAllRead(){return new Service().markAllRead(this._userId);}
 async subscribe(){const p=this.validateData({enabled:'must|bool'});return new Service().subscribe(this._userId,p.enabled);}
 async recover(){const p=this.validateData({route:'must|string|max:60',requestId:'must|string|min:16|max:100',id:'string|max:100'});return new (require('../service/request_recovery_service.js'))().recover(this._userId,p);}
}
module.exports=OperationsController;
