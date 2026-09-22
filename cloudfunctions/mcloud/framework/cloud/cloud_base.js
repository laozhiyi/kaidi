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
  // OpenAPI is a callable namespace; its .bind would invoke a remote API.
  if (property === 'openapi') return target.openapi;
  const value = target[property];
  return typeof value === 'function' ? value.bind(target) : value;
 }});
	return instance;
}

module.exports = {
	getCloud
}
