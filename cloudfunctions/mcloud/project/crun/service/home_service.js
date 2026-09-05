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

		const mailCnt = await MailModel.count({ MAIL_STATUS: 0, MAIL_PAY_STATUS: 1, MAIL_END_TIME: ['>', t] });
		const cnt = mailCnt;

		let list = [];
		const mailList = await MailModel.getAll(
			{ MAIL_STATUS: 0, MAIL_PAY_STATUS: 1, MAIL_END_TIME: ['>', t] },
			'MAIL_OBJ.poster,MAIL_ADD_TIME',
			{ 'MAIL_ADD_TIME': 'desc' },
			5
		);
		for (let k = 0; k < mailList.length; k++) {
			list.push({
				title: mailList[k].MAIL_OBJ.poster + ' 发布了快递代取',
				time: mailList[k].MAIL_ADD_TIME
			})
		}

		return { cnt, list }

	}
}

module.exports = HomeService;
