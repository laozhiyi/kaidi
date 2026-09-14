/**
 * Notes: 全局/首页模块业务逻辑
 * Date: 2021-03-15 04:00:00 
 * Ver : CCMiniCloud Framework 2.0.1 ALL RIGHTS RESERVED BY cclinux0730 (wechat)
 */

const BaseProjectService = require('./base_project_service.js');
const setupUtil = require('../../../framework/utils/setup/setup_util.js');
const MailModel = require('../model/mail_model.js');

class HomeService extends BaseProjectService {

	async getSetup(key) {
		return await setupUtil.get(key);
	}

	/**首页列表 */
	async getHomeList() {
		let t = this._timestamp;

		const where = { MAIL_STATUS: 0, MAIL_PAYMENT_MODE: 'offline', MAIL_END_TIME: ['>', t] };
		const [cnt, mailList] = await Promise.all([
			MailModel.count({ ...where }),
			MailModel.getAll({ ...where }, 'MAIL_OBJ.title,MAIL_ADD_TIME', { MAIL_ADD_TIME: 'desc', _id: 'desc' }, 5)
		]);
		let list = [];
		for (let k = 0; k < mailList.length; k++) {
			list.push({
				title: '新发布了' + (mailList[k].MAIL_OBJ.title || '快递代取'),
				time: mailList[k].MAIL_ADD_TIME
			})
		}

		return { cnt, list }

	}
}

module.exports = HomeService;
