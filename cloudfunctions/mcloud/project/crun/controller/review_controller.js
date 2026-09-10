'use strict';
const Base = require('./base_project_controller.js');
const ReviewService = require('../service/review_service.js');
class ReviewController extends Base {
 async insert() { const input=this.validateData({orderId:'must|id',requestId:'must|string|min:16|max:100',score:'must|int|min:1|max:5',content:'string|max:300'}); return new ReviewService().insert(this._userId,input); }
 async myList() { const input=this.validateData({page:'int|default=1|min:1|max=500',size:'int|default=20|min=1|max=50'}); return new ReviewService().myList(this._userId,input.page); }
}
module.exports=ReviewController;
