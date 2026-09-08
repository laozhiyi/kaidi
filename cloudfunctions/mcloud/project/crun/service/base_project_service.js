/**
 * Notes: 业务基类 
 * Date: 2021-03-15 04:00:00 
 */

const dbUtil = require('../../../framework/database/db_util.js');
const util = require('../../../framework/utils/util.js');
const AdminModel = require('../../../framework/platform/model/admin_model.js');
const NewsModel = require('../model/news_model.js');
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
 if (!setupPromise) setupPromise=this._initSetup().catch(e=>{setupPromise=null;throw e;});
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
		const COLLECTIONS = ['identity_unique', 'operation_config', 'operation_audit', 'operation_limit', 'order_quota', 'order_event', 'order_request', 'notification', 'subscription', 'feedback_request','setup', 'admin', 'log', 'news', 'mail', 'follow', 'thing', 'food', 'fav', 'user', 'campus_service', 'campus_service_message', 'feedback', 'invite'];
		const CONST_PIC = '/images/cover.gif';



		const NEWS_CATE = '1=通知公告';



		if (await dbUtil.isExistCollection(F(INSTALL_CL))) {
			// 已初始化过，仅补齐可能新增的集合（用于版本升级场景）
			for (const name of COLLECTIONS) await this._ensureCollection(F(name));
			return;
		}

		console.log('### initSetup...');

		for (const name of COLLECTIONS) await this._ensureCollection(F(name));

		if (await dbUtil.isExistCollection(F('admin'))) {
			let adminCnt = await AdminModel.count({});
			if (adminCnt == 0) {
				let data = {};
				const initPassword = process.env.INIT_ADMIN_PASSWORD || '123456';
				data.ADMIN_NAME = process.env.INIT_ADMIN_NAME || 'admin';
				data.ADMIN_PASSWORD = require('../../../framework/utils/password_util.js').hash(initPassword);
				data.ADMIN_DESC = '超管';
				data.ADMIN_TYPE = 1;
				await AdminModel.insert(data);
			}
		}


		if (await dbUtil.isExistCollection(F('news'))) {
			let newsCnt = await NewsModel.count({});
			if (newsCnt == 0) {
				let newsArr = NEWS_CATE.split(',');
				for (let j in newsArr) {
					let title = newsArr[j].split('=')[1];
					let cateId = newsArr[j].split('=')[0];

					let data = {};
					data.NEWS_TITLE = title + '标题1';
					data.NEWS_DESC = title + '简介1';
					data.NEWS_CATE_ID = cateId;
					data.NEWS_CATE_NAME = title;
					data.NEWS_CONTENT = [{ type: 'text', val: title + '内容1' }];
					data.NEWS_PIC = [CONST_PIC];

					await NewsModel.insert(data);
				}
			}
		}

		await this._ensureCollection(F(INSTALL_CL));
	}

}

module.exports = BaseProjectService;