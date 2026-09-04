/**
 * Notes: 全局/首页模块业务逻辑
 * Date: 2021-03-15 04:00:00 
 * Ver : CCMiniCloud Framework 2.0.1 ALL RIGHTS RESERVED BY cclinux0730 (wechat)
 */

const BaseProjectService = require('./base_project_service.js');
const setupUtil = require('../../../framework/utils/setup/setup_util.js');
const MailModel = require('../model/mail_model.js');
const FollowModel = require('../model/follow_model.js');
const FoodModel = require('../model/food_model.js');
const ThingModel = require('../model/thing_model.js');

class HomeService extends BaseProjectService {

	async getSetup(key) {
		return await setupUtil.get(key);
	}

	/**首页列表 */
	async getHomeList() {
		let t = this._timestamp;

		let [mailCnt, followCnt, foodCnt, thingCnt] = await Promise.all([
			MailModel.count({ MAIL_STATUS: 0, MAIL_END_TIME: ['>', t] }),
			FollowModel.count({ FOLLOW_STATUS: 0, FOLLOW_END_TIME: ['>', t] }),
			FoodModel.count({ FOOD_STATUS: 0, FOOD_END_TIME: ['>', t] }),
			ThingModel.count({ THING_STATUS: 0, THING_END_TIME: ['>', t] })
		]);
		let cnt = mailCnt + followCnt + foodCnt + thingCnt;

		let list = [];
		let [mailList, foodList, followList, thingList] = await Promise.all([
			MailModel.getAll({ MAIL_STATUS: 0, MAIL_END_TIME: ['>', t] }, 'MAIL_OBJ.poster,MAIL_ADD_TIME', { 'MAIL_ADD_TIME': 'desc' }, 5),
			FoodModel.getAll({ FOOD_STATUS: 0, FOOD_END_TIME: ['>', t] }, 'FOOD_ADD_TIME,FOOD_OBJ.poster', { 'FOOD_ADD_TIME': 'desc' }, 5),
			FollowModel.getAll({ FOLLOW_STATUS: 0, FOLLOW_END_TIME: ['>', t] }, 'FOLLOW_ADD_TIME,FOLLOW_OBJ.poster', { 'FOLLOW_ADD_TIME': 'desc' }, 5),
			ThingModel.getAll({ THING_STATUS: 0, THING_END_TIME: ['>', t] }, 'THING_ADD_TIME,THING_OBJ.poster', { 'THING_ADD_TIME': 'desc' }, 5)
		]);
		for (let k = 0; k < mailList.length; k++) {
			list.push({
				title: mailList[k].MAIL_OBJ.poster + ' 发布了快递代取',
				time: mailList[k].MAIL_ADD_TIME
			})
		}

		for (let k = 0; k < foodList.length; k++) {
			list.push({
				title: foodList[k].FOOD_OBJ.poster + ' 发布了代买需求',
				time: foodList[k].FOOD_ADD_TIME
			})
		}

		for (let k = 0; k < followList.length; k++) {
			list.push({
				title: followList[k].FOLLOW_OBJ.poster + ' 发布了陪替需求',
				time: followList[k].FOLLOW_ADD_TIME
			})
		}

		for (let k = 0; k < thingList.length; k++) {
			list.push({
				title: thingList[k].THING_OBJ.poster + ' 发布了急事代办',
				time: thingList[k].THING_ADD_TIME
			})
		}

		list.sort((a, b) => b.time - a.time);


		return { cnt, list }

	}
}

module.exports = HomeService;