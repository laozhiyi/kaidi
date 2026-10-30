/**
 * Notes: 业务基类 
 * Date: 2021-03-15 04:00:00 
 */

const dbUtil = require('../../../framework/database/db_util.js');
const util = require('../../../framework/utils/util.js');
const AdminModel = require('../../../framework/platform/model/admin_model.js');
const AppError = require('../../../framework/core/app_error.js');
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
  let created = false, failure = null;
  try { created = await dbUtil.createCollection(name); }
  catch (e) { failure = e; console.error('[initSetup] create failed', { collection: name, code: e.code || e.errCode, message: e.message }); }
  // The legacy database helper returns false instead of throwing. Also tolerate
  // another cold-start instance creating the same collection concurrently.
  if (!created && !await dbUtil.isExistCollection(name)) {
   const reason = failure ? (failure.message || failure.errMsg || failure.code || '') : '';
   console.error('[initSetup] collection unavailable', { collection: name, reason });
   this.AppError('数据服务初始化未完成：集合 ' + name + ' 创建失败' + (reason ? '（' + reason + '）' : '') + '，请检查云数据库权限与配额');
  }
 }
 // 首次安装步骤多、耗时长：逐步记录位置与总耗时，云日志能直接看出卡在哪一步；
 // 非 AppError 也转成可读业务错误，避免整次调用只剩一个 -504002。
 async _initSetup() {
  const startedAt = Date.now();
  let step = 'marker';
  try {
   const result = await this._initSetupSteps(next => { step = next; });
   console.log('[initSetup] done', { elapsed: Date.now() - startedAt });
   return result;
  } catch (e) {
   const reason = e && (e.message || e.errMsg || e.code) || String(e);
   console.error('[initSetup] failed', { step, elapsed: Date.now() - startedAt, code: e && (e.code || e.errCode), reason });
   if (e instanceof AppError) throw e;
   throw new AppError('数据服务初始化失败（' + step + '）：' + reason);
  }
 }
 async _initSetupSteps(setStep) {
		let F = (c) => 'bx_' + c;
		const INSTALL_CL = 'setup_crun';
		const SCHEMA_CL = 'setup_crun_20261027_customer_service';
		setStep('marker');
		// A versioned marker is created only after every required collection is
		// available. Warm-up of a new instance then needs one lookup, not 28.
		if (await dbUtil.isExistCollection(F(SCHEMA_CL))) return;
		const COLLECTIONS = ['account_session', 'account_media', 'account_cleanup_file', 'school', 'campus', 'tenant_migration', 'request_scope', 'admin_limit', 'news_manifest', 'news_unread', 'worker_state', 'identity_unique', 'operation_config', 'operation_audit', 'operation_limit', 'order_quota', 'order_event', 'order_request', 'order_feed', 'notification', 'news_read', 'subscription', 'feedback_request','setup', 'admin', 'log', 'news', 'mail', 'fav', 'user', 'campus_service', 'campus_service_message', 'staff_invite', 'feedback', 'invite', 'order_review', 'review_request'];








		if (await dbUtil.isExistCollection(F(INSTALL_CL))) {
			// 已初始化过，仅补齐可能新增的集合（用于版本升级场景）
			setStep('upgrade');
			for (const name of COLLECTIONS) { setStep('collection:' + name); await this._ensureCollection(F(name)); }
			setStep('seed');
			await new (require('./tenant_service.js'))().seed();
			setStep('install-marker');
			await this._ensureCollection(F(SCHEMA_CL));
			return;
		}

		console.log('### initSetup...');

		for (const name of COLLECTIONS) { setStep('collection:' + name); await this._ensureCollection(F(name)); }
  setStep('seed');
  await new (require('./tenant_service.js'))().seed();

		setStep('root-admin');
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
    // 初始管理员：整套后台权限的根，唯一能调整/授予超管的人。
    // 它只是账号密码账号，不对应任何用户记录，因此不在 USER_ROLE 里。
    data.ADMIN_ROOT = true;
    data.ADMIN_SCOPES = [];
				await AdminModel.insert(data);
			}
		}



		setStep('install-marker');
		await this._ensureCollection(F(INSTALL_CL));
		await this._ensureCollection(F(SCHEMA_CL));
	}

}

module.exports = BaseProjectService;
