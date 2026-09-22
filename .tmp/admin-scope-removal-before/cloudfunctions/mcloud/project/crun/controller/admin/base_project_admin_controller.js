/**
 * Notes: 后台管理控制模块
 * Ver : CCMiniCloud Framework 2.0.1 ALL RIGHTS RESERVED BY cclinux0730 (wechat)
 * Date: 2021-03-15 19:20:00 
 */

const BaseAdminController = require('../../../../framework/platform/controller/base_admin_controller.js');
const BaseProjectService = require('../../service/base_project_service.js');

class BaseProjectAdminController extends BaseAdminController {
 async isAdmin() {
  await super.isAdmin();
  if (/^admin\/user_/.test(this._route)) require('../../../../framework/tenancy/tenant_context.js').assertSchoolAdmin(this._admin);
  if (/^admin\/mgr_(?!pwd)/.test(this._route) && this._admin.ADMIN_PLATFORM !== true) this.AppError('仅平台管理员可管理管理员账号');
 }
 async isSuperAdmin() {
  await super.isSuperAdmin();
  if (/^admin\/user_/.test(this._route)) require('../../../../framework/tenancy/tenant_context.js').assertSchoolAdmin(this._admin);
  if (/^admin\/mgr_(?!pwd)/.test(this._route) && this._admin.ADMIN_PLATFORM !== true) this.AppError('仅平台管理员可管理管理员账号');
 }
	// TODO
	async initSetup() {
		let service = new BaseProjectService();
		await service.initSetup();
	}

}

module.exports = BaseProjectAdminController;
