/**
 * Notes: 内容审核
 * Ver : CCMiniCloud Framework 2.39.1 ALL RIGHTS RESERVED BY cclinux0730 (wechat)
 * Date: 2020-09-05 04:00:00 
 */

const AppError = require('../core/app_error.js');
const cloudBase = require('../cloud/cloud_base.js');
const config = require('../../config/config.js');

/**
 * 前台校验
 * @param {*} imgData 
 * @param {*} mine 
 */
async function checkImgClient(imgData, mine) {
	if (!config.CLIENT_CHECK_CONTENT) return;
	return await checkImg(imgData, mine);
}

/**
 * 后台校验
 * @param {*} imgData 
 * @param {*} mine 
 */
async function checkImgAdmin(imgData, mine) {
	if (!config.ADMIN_CHECK_CONTENT) return;
	return await checkImg(imgData, mine);
}
/**
 * 校验图片信息
 * @param {*} 图片流buffer 
 */
async function checkImg(imgData, mine) {


	let cloud = cloudBase.getCloud();
	try {
		const result = await cloud.openapi.security.imgSecCheck({
			media: {
				contentType: 'image/' + mine,
				value: Buffer.from(imgData, 'base64') // 这里必须要将小程序端传过来的进行Buffer转化,否则就会报错,接口异常
			}

		})

		if (!result || result.errCode !== 0) {
			throw new AppError('图片内容不合适，请修改');
		}

	} catch (err) {
		console.warn('image audit failed', err.errCode || 'AUDIT_FAILED');
		throw new AppError('图片内容不合适，请修改');
	}

}

/**
 * 后台把输入数据里的文本数据提交内容审核
 * @param {*} input 
 */
async function checkTextMultiAdmin(input) {
	if (!config.ADMIN_CHECK_CONTENT) return;
	return checkTextMulti(input);
}

/**
 * 前台把输入数据里的文本数据提交内容审核
 * @param {*} input 
 */
async function checkTextMultiClient(input) {
	if (!config.CLIENT_CHECK_CONTENT) return;
	return checkTextMulti(input);
}

/**
 * 把输入数据里的文本数据提交内容审核
 * @param {*} input 
 */
async function checkTextMulti(input) {

	let txt = '';
	for (let key in input) {
		if (typeof (input[key]) === 'string')
			txt += input[key];
		else if (typeof (input[key]) === 'object') //包括数组和对象
			txt += JSON.stringify(input[key]);
	}

	if (txt.length > 24000) throw new AppError('提交内容过长');
 for (let offset=0; offset<txt.length; offset+=1800) await checkText(txt.slice(offset,offset+1800));
}
/**
 * 后台校验文字信息
 * @param {*}  
 */
async function checkTextAdmin(txt) {
	if (!config.ADMIN_CHECK_CONTENT) return;
	return checkText(txt);
}

/**
 * 前台校验文字信息
 * @param {*}  
 */
async function checkTextClient(txt) {
	if (!config.CLIENT_CHECK_CONTENT) return;
	return checkText(txt);
}

/**
 * 校验文字信息
 * @param {*}  
 */
async function checkText(txt) { 
	if (!txt) return; 
	let cloud = cloudBase.getCloud();
	try { 
		const result = await cloud.openapi.security.msgSecCheck({
			content: txt, version: 2, scene: 2, openid: cloud.getWXContext().OPENID

		})
		if (!result || result.errCode !== 0 || !result.result || result.result.suggest !== 'pass') {
			throw new AppError('文字内容不合适，请修改或者重试');
		}

	} catch (err) {
		console.warn('text audit failed', err.errCode || 'AUDIT_FAILED');
		throw new AppError('文字内容不合适，请修改或者重试');
	}

}

async function checkCloudImage(fileID, allowed = []) {
 if (typeof fileID !== 'string' || !fileID.startsWith('cloud://')) throw new AppError('图片须先上传');
 const cloud = cloudBase.getCloud(), openid = cloud.getWXContext().OPENID;
 const match = /^cloud:\/\/[^/]+\/(.+)$/.exec(fileID), filePath = match && match[1] || '';
 if (openid && allowed.includes(fileID) && filePath.startsWith('private-evidence/' + openid + '/')) return fileID;
 if (!openid || !filePath.startsWith('private/' + openid + '/')) throw new AppError('不可引用其他用户的图片，请重新上传');
 const result = await cloud.downloadFile({fileID}); const buffer = result.fileContent;
 if (!buffer || buffer.length > 1024 * 1024) throw new AppError('图片超过1MB，请压缩后重试');
 const isPng=buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 const isJpeg=buffer[0]===255 && buffer[1]===216;
 if(!isPng && !isJpeg)throw new AppError('仅支持JPG、PNG图片');
 if (config.CLIENT_CHECK_CONTENT || config.ADMIN_CHECK_CONTENT) await checkImg(buffer.toString('base64'),isPng?'png':'jpeg');
 // Finalized evidence is server-owned. Storage rules MUST deny client writes to private-evidence/.
 const digest=require('crypto').createHash('sha256').update(buffer).digest('hex');
 const saved=await cloud.uploadFile({cloudPath:'private-evidence/'+openid+'/'+digest+(isPng?'.png':'.jpg'),fileContent:buffer});
 if(!saved || !saved.fileID)throw new AppError('图片归档失败，请重试');
 return saved.fileID;
}
module.exports = {
 checkCloudImage,
	checkImg,
	checkImgClient,
	checkImgAdmin,
	checkTextMulti,
	checkTextMultiClient,
	checkTextMultiAdmin,
	checkText,
	checkTextClient,
	checkTextAdmin
}