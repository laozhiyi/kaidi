 /**
 * Notes: UGC内容校验
 * Ver : CCMiniCloud Framework 2.4.1 ALL RIGHTS RESERVED BY cclinux0730 (wechat)
 * Date: 2023-11-14 07:48:00 
 */

const cloudHelper = require('../helper/cloud_helper.js');
const pageHelper = require('../helper/page_helper.js');
const setting = require('../setting/setting.js');

/**
 * 图片类型校验
 * @param {*} fileName 
 * @param {*} type 
 */
function imgTypeCheck(path, type = ['jpg', 'jpeg', 'png','JPG','JPEG','PNG']) {
	let fmt = path.split(".")[(path.split(".")).length - 1];
	if (type.indexOf(fmt) > -1)
		return true;
	else
		return false;
}

/**
 * 图片大小校验
 * @param {*} size 
 * @param {*} maxSize 
 */
function imgSizeCheck(size, maxSize) {
	return size < maxSize;
}

async function imgCheckCloud(path, opt) {
 
	
	/*
	let result = await cloudHelper.callCloudSumbit('check/img', params, opt).then(res => {
		return true;
	}).catch(err => {
		return false;
	}); 
		*/

	let result = await wx.cloud.callFunction({
		name: 'cloud',
		data: {
			route: 'check/img',
			token : '',
			params:{img: wx.cloud.CDN( {
				type: 'filePath',
				filePath: path,
			})
		}
		},
		success: function (res) { 
			console.log(res)
			console.log('succ')
			return true;
		},
		fail: function (res) {
			console.log(res)
			return false;
		},
		complete: function (res) {
			 
		}
	});
	return result;
}

/**
 * 图像校验（服务市场「图片内容安全」）
 * @param {*} imgData
 * @returns {boolean|null} true 通过；false 判定为风险内容；null 校验不可用
 *
 * 这个接口依赖小程序在服务市场订阅的内容安全服务，未订阅 / 余额不足 / 网络异常时
 * invokeService 会直接 reject。旧版把 reject 也当作「不合适的图片」，管理员上传
 * 一张正常的群二维码只会看到一句莫名其妙的拦截提示（二维码上传失败的真正原因）。
 * 这里把「不可用」和「命中风险」分开：只有明确的 BLOCK 才返回 false，其余不可判定
 * 的情况返回 null，由上层决定放行并留日志。
 */
async function imgCheck(imgData) {

	if (typeof wx === 'undefined' || !wx.serviceMarket || typeof wx.serviceMarket.invokeService !== 'function') {
		console.warn('[imgCheck] 当前环境未提供 wx.serviceMarket，跳过图片内容校验');
		return null;
	}

	let res = null;
	try {
		res = await wx.serviceMarket.invokeService({
			service: 'wxee446d7507c68b11',
			api: 'imgSecCheck',
			data: {
				"Action": "ImageModeration",
				"Scenes": ["PORN", "POLITICS", "TERRORISM"],
				"ImageUrl": new wx.serviceMarket.CDN({
					type: 'filePath',
					filePath: imgData,
				}),
				"ImageBase64": '',
				"Config": "",
				"Extra": ""
			},
		});
	} catch (err) {
		console.warn('[imgCheck] 内容安全服务不可用，本次跳过校验：', err);
		return null;
	}

	const response = res && res.data && res.data.Response;
	if (!response) {
		console.warn('[imgCheck] 内容安全服务未返回结果，本次跳过校验：', res);
		return null;
	}

	const keys = ['PornResult', 'PoliticsResult', 'TerrorismResult'];
	if (keys.some(key => response[key] && response[key].Suggestion === 'BLOCK')) return false;
	if (keys.every(key => response[key] && response[key].Suggestion === 'PASS')) return true;

	// REVIEW（疑似，建议人工复审）不阻塞上传，但要留下记录方便回溯。
	console.warn('[imgCheck] 内容安全结果为待复审，本次放行：', keys.map(key => (response[key] || {}).Suggestion));
	return null;
}


module.exports = {
	imgCheck,
	imgCheckCloud,
	imgTypeCheck,
	imgSizeCheck
}
