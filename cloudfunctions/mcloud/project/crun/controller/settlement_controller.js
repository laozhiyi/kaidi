'use strict';
const Base = require('./base_project_controller.js');
const Service = require('../service/adapay_account_service.js');
class SettlementController extends Base {
 async accept() {return new Service().acceptAgreements(this._userId,this.validateData({rulesAccepted:'must|bool',authorizationAccepted:'must|bool',rulesVersion:'must|string|max:30',authorizationVersion:'must|string|max:30'}));}
 async status() {return new Service().status(this._userId);}
 async open() {return new Service().open(this._userId,this._form());}
 async change() {return new Service().change(this._userId,this._form());}
 _form() {
  return this.validateData({realName:'must|string|max:64',identity:'must|string|max:18',bankCard:'must|string|max:25',phone:'must|string|max:11',rulesAccepted:'must|bool',authorizationAccepted:'must|bool',rulesVersion:'must|string|max:30',authorizationVersion:'must|string|max:30'});
 }
}
module.exports = SettlementController;
