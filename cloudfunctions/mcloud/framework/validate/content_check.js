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
async function checkTextMultiAdmin(input, options = {}) {
	if (!config.ADMIN_CHECK_CONTENT) return;
	return checkTextMulti(input, options);
}

/**
 * 前台把输入数据里的文本数据提交内容审核
 * @param {*} input 
 */
async function checkTextMultiClient(input, options = {}) {
	if (!config.CLIENT_CHECK_CONTENT) return;
	return checkTextMulti(input, options);
}

/**
 * 把输入数据里的文本数据提交内容审核
 * @param {*} input 
 */
async function checkTextMulti(input, options = {}) {
	// Use byField with { '昵称': name, '学院': college } for editable fields.
	// Existing callers retain batched auditing and object support.
	const fields = Object.entries(input || {}).map(([field, value]) => [field,
		typeof value === 'string' ? value : value && typeof value === 'object' ? JSON.stringify(value) : ''
	]).filter(([, text]) => text && text.trim());
	if (fields.reduce((size, [, text]) => size + text.length, 0) > 24000) throw new AppError('提交内容过长');
	const batches = options.byField || fields.length < 2 ? fields : [['', fields.map(([, text]) => text).join('\n')]];
	for (const [field, text] of batches) {
		for (let offset = 0; offset < text.length;) {
			let end = Math.min(offset + 1800, text.length);
			if (/[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end] || '')) end--;
			await checkText(text.slice(offset, end), { ...options, field });
			offset = end;
		}
	}
}
/**
 * 后台校验文字信息
 * @param {*}  
 */
async function checkTextAdmin(txt, options = {}) {
	if (!config.ADMIN_CHECK_CONTENT) return;
	return checkText(txt, options);
}

/**
 * 前台校验文字信息
 * @param {*}  
 */
async function checkTextClient(txt, options = {}) {
	if (!config.CLIENT_CHECK_CONTENT) return;
	return checkText(txt, options);
}

/**
 * 校验文字信息
 * @param {*}  
 */
async function checkText(txt, options = {}) {
	if (!txt || !txt.trim()) return;
	const cloud = cloudBase.getCloud(), openid = cloud.getWXContext().OPENID;
	if (!openid) throw textServiceError(null, 'identity');
	let response;
	try {
		response = await cloud.openapi.security.msgSecCheck({
			content: txt, version: 2, scene: options.scene || 2, openid
		});
	} catch (error) {
		const code = textErrorCode(error);
		if (code === 87014) throw textRejection(options.field);
		const timeout = error && (/TIMEOUT|TIMEDOUT/i.test(String(error.code || ''))
			|| /\btimeout\b|timed out/i.test(String(error.errMsg || error.message || '')));
		throw textServiceError(code, timeout ? 'timeout' : 'provider');
	}
	const code = textErrorCode(response);
	if (code === 87014) throw textRejection(options.field);
	if (code !== 0) throw textServiceError(code, code === null ? 'invalid_response' : 'provider');
	const suggest = response.result && response.result.suggest;
	if (suggest === 'pass') return;
	if (suggest === 'risky' || suggest === 'review') throw textRejection(options.field, suggest);
	throw textServiceError(null, 'invalid_response');
}

function textErrorCode(value) {
	const code = value && (value.errCode !== undefined ? value.errCode : value.errcode);
	return /^-?\d{1,8}$/.test(String(code)) ? Number(code) : null;
}

function textRejection(field, suggest = 'risky') {
	const label = field ? '「' + field + '」' : '提交的文字';
	return new AppError(suggest === 'review'
		? label + '被微信标记为需复核，请调整该字段后重试'
		: label + '未通过微信文字审核，请修改该字段后重试');
}

function textServiceError(code, reason) {
	let message = '微信文字审核服务暂不可用，请稍后重试；持续失败请联系管理员';
	if ([48001, 48002].includes(code)) {
		reason = 'permission'; message = '微信文字审核服务暂无调用权限，请联系管理员检查服务配置';
	} else if (code === 40003 || reason === 'identity') {
		reason = 'identity'; message = '微信文字审核身份校验失败，请重新进入小程序后重试';
	} else if ([45009, 45011].includes(code)) {
		reason = 'rate_limit'; message = '微信文字审核服务繁忙，请稍后重试';
	} else if (reason === 'timeout') message = '微信文字审核超时，请稍后重试';
	else if (reason === 'invalid_response') message = '微信文字审核服务返回异常，请稍后重试；持续失败请联系管理员';
	// Provider messages may contain submitted text or personal information.
	console.warn('[text-audit]', { reason, errCode: code });
	return new AppError(message + (code === null ? '' : '（错误码：' + code + '）'));
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
