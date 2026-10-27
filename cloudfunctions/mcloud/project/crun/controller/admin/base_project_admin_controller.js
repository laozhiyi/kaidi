/**
 * Notes: 后台管理控制模块
 * Ver : CCMiniCloud Framework 2.0.1 ALL RIGHTS RESERVED BY cclinux0730 (wechat)
 * Date: 2021-03-15 19:20:00 
 */

const BaseAdminController = require('../../../../framework/platform/controller/base_admin_controller.js');
const BaseProjectService = require('../../service/base_project_service.js');
const Roles = require('../../service/admin/admin_roles.js');

// 客服角色：接待咨询 + 处理投诉 + 处理订单履约。用户审核／授权、订单删除、
// 报表导出、设置与学校授权仍需管理员及以上，这里做接口层白名单，避免前端隐藏被绕过。
const SERVICE_ROUTES = new Set([
 'admin/customer_service_sessions',
 'admin/customer_service_chat',
 'admin/customer_service_reply',
 'admin/customer_service_badge',
 'admin/feedback_list',
 'admin/feedback_detail',
 'admin/feedback_reply',
 'admin/operations_config',
 'admin/operations_orders',
 'admin/operations_order',
 'admin/operations_hold',
 'admin/operations_resolve',
 // 网络中断后核对上一条写操作的结果，只校验调用人自己的 requestId。
 'admin/operations_recover',
 // 用户注册审核：客服可查看用户资料并做通过/不通过审核（停用/恢复、授权、删除仍归管理员）。
 'admin/user_list',
 'admin/user_detail',
 'admin/user_status'
]);

class BaseProjectAdminController extends BaseAdminController {
 async isAdmin() {
  await super.isAdmin();
  if (Roles.ofAdmin(this._admin) === 'service' && !SERVICE_ROUTES.has(this._route)) this.AppError('客服账号没有该操作权限');
  if (/^admin\/mgr_(?!pwd)/.test(this._route) && this._admin.ADMIN_PLATFORM !== true) this.AppError('仅平台管理员可管理管理员账号');
 }
 async isSuperAdmin() {
  await super.isSuperAdmin();
  if (/^admin\/mgr_(?!pwd)/.test(this._route) && this._admin.ADMIN_PLATFORM !== true) this.AppError('仅平台管理员可管理管理员账号');
 }
 /** 管理员及以上（客服除外）：用户审核、授权、订单删除等客服权限外的操作。 */
 async isManager() {
  await this.isAdmin();
  if (Roles.ofAdmin(this._admin) === 'service') this.AppError('客服账号没有该操作权限');
 }
	// TODO
	async initSetup() {
		let service = new BaseProjectService();
		await service.initSetup();
	}

}

module.exports = BaseProjectAdminController;
