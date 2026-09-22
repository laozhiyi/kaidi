/**
 * Notes: 业务基类 
 * Date: 2021-03-15 04:00:00 
 */

const dbUtil = require('../../../framework/database/db_util.js');
const util = require('../../../framework/utils/util.js');
const AdminModel = require('../../../framework/platform/model/admin_model.js');
let setupPromise;
const BaseService = require('../../../framework/platform/service/base_service.js');

class BaseProjectService extends BaseService {
	getProjectId() {
		return util.getProjectId();
	}

	async genDetailQr(type, id) {
		const BaseProjectAdminService = require('./admin/base_project_admin_service.js');
		let service = new BaseProjectAdminService();
		return service.genDetailQr(type, id);
	}

	async initSetup() {
 if (!setupPromise) setupPromise=require('../../../framework/tenancy/tenant_context.js').system(() => this._initSetup()).catch(e=>{setupPromise=null;throw e;});
 return setupPromise;
 }
 async _ensureCollection(name) {
  if (await dbUtil.isExistCollection(name)) return;
  let created = false;
  try { created = await dbUtil.createCollection(name); }
  catch (e) { console.error('[initSetup] create failed', { collection: name, code: e.code || e.errCode }); }
  // The legacy database helper returns false instead of throwing. Also tolerate
  // another cold-start instance creating the same collection concurrently.
  if (!created && !await dbUtil.isExistCollection(name)) {
   console.error('[initSetup] collection unavailable', { collection: name });
   this.AppError('数据服务初始化未完成，请联系管理员检查云数据库集合与权限');
  }
 }
 async _initSetup() {
		let F = (c) => 'bx_' + c;
		const INSTALL_CL = 'setup_crun';
		const SCHEMA_CL = 'setup_crun_20260921_tenants';
		// A versioned marker is created only after every required collection is
		// available. Warm-up of a new instance then needs one lookup, not 28.
		if (await dbUtil.isExistCollection(F(SCHEMA_CL))) return;
		const COLLECTIONS = ['school', 'campus', 'tenant_migration', 'request_scope', 'admin_limit', 'news_manifest', 'news_unread', 'worker_state', 'identity_unique', 'operation_config', 'operation_audit', 'operation_limit', 'order_quota', 'order_event', 'order_request', 'order_feed', 'notification', 'news_read', 'subscription', 'feedback_request','setup', 'admin', 'log', 'news', 'mail', 'fav', 'user', 'campus_service', 'campus_service_message', 'feedback', 'invite', 'order_review', 'review_request'];








		if (await dbUtil.isExistCollection(F(INSTALL_CL))) {
			// 已初始化过，仅补齐可能新增的集合（用于版本升级场景）
			for (const name of COLLECTIONS) await this._ensureCollection(F(name));
			await new (require('./tenant_service.js'))().seed();
			await this._ensureCollection(F(SCHEMA_CL));
			return;
		}

		console.log('### initSetup...');

		for (const name of COLLECTIONS) await this._ensureCollection(F(name));
  await new (require('./tenant_service.js'))().seed();

		if (await dbUtil.isExistCollection(F('admin'))) {
			let adminCnt = await AdminModel.count({});
			if (adminCnt == 0) {
				let data = {};
				const initPassword = process.env.INIT_ADMIN_PASSWORD;
    if (!initPassword || initPassword.length < 12) this.AppError('首次安装请配置至少12位的 INIT_ADMIN_PASSWORD');
				data.ADMIN_NAME = process.env.INIT_ADMIN_NAME || 'admin';
				data.ADMIN_PASSWORD = require('../../../framework/utils/password_util.js').hash(initPassword);
				data.ADMIN_DESC = '超管';
				data.ADMIN_TYPE = 1;
    data.ADMIN_PLATFORM = true;
    data.ADMIN_SCOPES = [];
				await AdminModel.insert(data);
			}
		}



		await this._ensureCollection(F(INSTALL_CL));
		await this._ensureCollection(F(SCHEMA_CL));
	}

}

module.exports = BaseProjectService;
