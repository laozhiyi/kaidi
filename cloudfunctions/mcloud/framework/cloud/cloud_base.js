/**
 * Notes: 云初始化实例
 * Ver : CCMiniCloud Framework 2.2.1 ALL RIGHTS RESERVED BY cclinux0730 (wechat)
 * Date: 2020-09-05 04:00:00 
 */

const config = require('../../config/config.js');
let instance;

/**
 * 获得云实例
 */
function getCloud() {
	if (instance) return instance;
	const cloud = require('wx-server-sdk');
	cloud.init({
		env: config.CLOUD_ID || cloud.DYNAMIC_CURRENT_ENV
	});
	instance = cloud;
	return cloud;
}

module.exports = {
	getCloud
}
