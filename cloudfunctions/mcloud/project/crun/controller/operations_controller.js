'use strict';
const Base = require('./base_project_controller.js');
const Service = require('../service/operations_service.js');
class OperationsController extends Base {
 async getConfig(){return new Service().config(this._userId);}
 async riderApply(){const p=this.validateData({campus:'must|string|max:30'});return new Service().riderApply(this._userId,p.campus);}
 async notifications(){const p=this.validateData({page:'int|default=1|min:1|max:500'});return new Service().notifications(this._userId,p.page);}
 async markRead(){const p=this.validateData({id:'must|id'});return new Service().markRead(this._userId,p.id);}
 async subscribe(){const p=this.validateData({enabled:'must|bool'});return new Service().subscribe(this._userId,p.enabled);}
}
module.exports=OperationsController;
