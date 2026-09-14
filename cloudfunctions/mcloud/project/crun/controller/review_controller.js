'use strict';
const Base = require('./base_project_controller.js');
const ReviewService = require('../service/review_service.js');
const contentCheck = require('../../../framework/validate/content_check.js');
class ReviewController extends Base {
 async insert() {
  const input=this.validateData({orderId:'must|id',requestId:'must|string|min:16|max:100',score:'must|int|min:1|max:5',content:'string|max:300'});
  await require('../service/operation_store.js').limit(new ReviewService().getProjectId(), this._userId, 'review_audit', 20, 60000);
  await contentCheck.checkTextMultiClient({ content: input.content || '' });
  return new ReviewService().insert(this._userId,input);
 }
 async context() { const input = this.validateData({orderId:'must|id'}); return new ReviewService().context(this._userId,input.orderId); }
 async myList() { const input=this.validateData({page:'int|default=1|min:1|max:500',size:'int|default=20|min:1|max:50',direction:'string|default=sent|max:10'}); return new ReviewService().myList(this._userId,input.page,input.direction,input.size); }
}
module.exports=ReviewController;
