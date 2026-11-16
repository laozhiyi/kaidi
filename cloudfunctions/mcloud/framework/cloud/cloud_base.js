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
		env: process.env.CLOUD_ENV_ID || config.CLOUD_ID || cloud.DYNAMIC_CURRENT_ENV
	});
	const wrap = require('../tenancy/tenant_database.js').wrap;
	instance = new Proxy(cloud, { get(target, property) {
		if (property === 'database') return options => wrap(target.database(options));
		// openapi 与 cloudPay 是可调用的命名空间代理：成员由它们自己的 get 拦截器解析。
		// 若在此处 bind 到根实例，会丢掉这层代理，cloudPay.queryOrder 就变成 undefined。
		if (property === 'openapi' || property === 'cloudPay') return target[property];
		const value = target[property];
		return typeof value === 'function' ? value.bind(target) : value;
	}});
	return instance;
}

module.exports = {
	getCloud
}
