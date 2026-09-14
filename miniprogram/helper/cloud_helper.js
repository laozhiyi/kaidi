/**
 * Notes: 云操作类库
 * Ver : CCMiniCloud Framework 2.3.1 ALL RIGHTS RESERVED BY cclinux0730 (wechat)
 * Date: 2020-11-14 07:48:00 
 */

const helper = require('./helper.js');
const dataHelper = require('./data_helper.js');
const cacheHelper = require('./cache_helper.js');
const constants = require('../comm/constants.js');
const contentCheckHelper = require('../helper/content_check_helper.js');
const pageHelper = require('../helper/page_helper.js');
const timeHelper = require('../helper/time_helper.js');
const setting = require('../setting/setting.js');

const CODE = {
	SUCC: 200,
	SVR: 500, //服务器错误  
	LOGIC: 1600, //逻辑错误 
	DATA: 1301, // 数据校验错误 
	HEADER: 1302, // header 校验错误  

	ADMIN_ERROR: 2401, //管理员错误
	WORK_ERROR: 2501 //陪练员错误
};

const readRequests = new Map();
let readEpoch = 0;
let loadingCount = 0, barLoadingCount = 0;
function isReadRoute(route) {
	return /(?:\/|_)(list|detail|view|summary|stats|stat|records|context|featured|get|is_fav|my_code|chat)$/.test(route)
		|| ['passport/login', 'operations/config', 'operations/notifications', 'admin/home', 'admin/operations_config', 'admin/operations_order', 'admin/operations_orders', 'admin/operations_overview'].includes(route);
}
function stableKey(value) {
	if (Array.isArray(value)) return '[' + value.map(stableKey).join(',') + ']';
	if (value && typeof value === 'object') return '{' + Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => JSON.stringify(key) + ':' + stableKey(value[key])).join(',') + '}';
	return JSON.stringify(value);
}
function invalidateReadRequests() { readEpoch++; readRequests.clear(); }

function callCloudSumbitAsync(route, params = {}, options) {
	if (!helper.isDefined(options)) options = {
		hint: false
	}
	if (!helper.isDefined(options.hint)) options.hint = false;
	return callCloud(route, params, options)
}

async function callCloudSumbit(route, params = {}, options = { title: '提交中...' }) {
	if (!helper.isDefined(options)) options = {
		title: '提交中..'
	}
	if (!helper.isDefined(options.title)) options.title = '提交中..';
	return await callCloud(route, params, options);
}

async function callCloudData(route, params = {}, options) {
	if (!helper.isDefined(options)) options = {
		title: '加载中..'
	}

	if (!helper.isDefined(options.title)) options.title = '加载中..';
	let result = await callCloud(route, params, options).catch(err => {
		return null;
	});

	if (result && helper.isDefined(result.data)) {
		result = result.data;
		if (Array.isArray(result)) {
			// 数组处理
		} else if (result && typeof result === 'object' && Object.keys(result).length == 0) {
			result = null; //对象处理
		}

	}
	return result;
}

function callCloud(route, params = {}, options = {}) {
	options = options || {};
	if (typeof route !== 'string' || !route) return Promise.reject(new Error('请求地址无效'));
	let token = '';
	const cache = cacheHelper.get(route.startsWith('admin/') ? constants.CACHE_ADMIN : route.startsWith('work/') ? constants.CACHE_WORK : constants.CACHE_TOKEN);
	if (cache) token = route.startsWith('admin/') || route.startsWith('work/') ? cache.token || '' : cache.id || '';
	const data = { route, token, PID: pageHelper.getPID(), params };
	const key = isReadRoute(route) && options.dedupe !== false ? readEpoch + ':' + stableKey(data) : '';
	let request = key && readRequests.get(key);
	if (!request) {
		request = callCloudOnce(data, options);
		if (key) {
			readRequests.set(key, request);
			const clear = () => { if (readRequests.get(key) === request) readRequests.delete(key); };
			request.then(clear, clear);
		}
	}
	// Callers decorate their DTOs. Sharing a mutable result would corrupt a
	// concurrent page's data even when sharing the network request is safe.
	return request.then(result => JSON.parse(JSON.stringify(result)));
}

function callCloudOnce(data, options) {

	let title = '加载中';
	let hint = true;

	// 标题
	if (helper.isDefined(options) && helper.isDefined(options.title))
		title = options.title;

	if (helper.isDefined(options) && helper.isDefined(options.hint))
		hint = options.hint;

	if (hint) {
		if (title == 'bar') { if (barLoadingCount++ === 0) wx.showNavigationBarLoading(); }
		else { loadingCount++; wx.showLoading({ title, mask: !isReadRoute(data.route) }); }
	}

	return new Promise(function (resolve, reject) {
		let settled = false, timer = null;
		const finish = (error, result) => {
			if (settled) return;
			settled = true;
			if (timer !== null) clearTimeout(timer);
			if (hint) {
				if (title === 'bar') { if (--barLoadingCount === 0) wx.hideNavigationBarLoading(); }
				else if (--loadingCount === 0) wx.hideLoading();
			}
			if (error) reject(error); else resolve(result);
		};
		const timeout = Math.min(60000, Math.max(1000, Number(options.timeoutMs) || 20000));
		if (typeof setTimeout === 'function') timer = setTimeout(() => finish({ msg: '网络响应超时，请检查操作结果后重试', retryable: true, errMsg: 'request timeout' }), timeout);
		const callbacks = {
			name: 'mcloud',
			data,
			success: function (res) {
				if (settled) return;
				if (!res || !res.result || typeof res.result.code !== 'number') {
					finish({ msg: '服务响应不完整，请重试', retryable: true }); return;
				}
				if (res.result.code == CODE.LOGIC || res.result.code == CODE.DATA) {
					console.log(res)
					// 逻辑错误&数据校验错误 
					if (hint) {
						wx.showModal({
							title: '温馨提示',
							content: res.result.msg,
							showCancel: false
						});
					}

					finish(res.result);
					return;
				} else if (res.result.code == CODE.ADMIN_ERROR) {
					// 后台登录错误
					wx.reLaunch({
						url: pageHelper.fmtURLByPID('/pages/admin/index/login/admin_login'),
					});
					// A login redirect must also release the caller's loading/submission state.
					finish(res.result);
					return;

				} else if (res.result.code == CODE.WORK_ERROR) {
					// 服务者登录错误
					wx.reLaunch({
						url: pageHelper.fmtURLByPID('/pages/work/index/login/work_login'),
					});
					finish(res.result);
					return;
				}
				else if (res.result.code != CODE.SUCC) {
					if (hint) {
						wx.showModal({
							title: '温馨提示',
							content: '系统开小差了，请稍后重试',
							showCancel: false
						});
					}
					finish(res.result);
					return;
				}

				if (!isReadRoute(data.route)) invalidateReadRequests();
				finish(null, res.result);
			},
			fail: function (err) {
				if (settled) return;
				if (hint) {
					console.log(err)
					if (err && err.errMsg && err.errMsg.includes('-501000') && err.errMsg.includes('Environment not found')) {
						wx.showModal({
							title: '',
							content: '未找到云环境ID，请按手册检查前端配置文件setting.js的配置项【CLOUD_ID】或咨询作者微信cclinux0730',
							showCancel: false
						});

					} else if (err && err.errMsg && err.errMsg.includes('-501000') && err.errMsg.includes('FunctionName')) {
						wx.showModal({
							title: '',
							content: '云函数未创建或者未上传，请参考手册或咨询作者微信cclinux0730',
							showCancel: false
						});

					} else if (err && err.errMsg && err.errMsg.includes('-501000') && err.errMsg.includes('performed in the current function state')) {
						wx.showModal({
							title: '',
							content: '云函数正在上传中或者上传有误，请稍候',
							showCancel: false
						});
					} else
						wx.showModal({
							title: '',
							content: '网络故障，请稍后重试',
							showCancel: false
						});
				}
				const failure = err && err.result || {
					msg: '网络连接异常，请稍后重试',
					errCode: err && err.errCode,
					errMsg: err && err.errMsg
				};
				if (!failure.code && /timeout|timed out|network|socket|econn|time.limit|temporarily|service.unavailable|超时|网络/i.test(String(err && (err.errMsg || err.message) || ''))) failure.retryable = true;
				finish(failure);
				return;
			},
			complete: function () {}
		};
		try { wx.cloud.callFunction(callbacks); }
		catch (error) { callbacks.fail(error); }
	});
}

async function dataList(that, listName, route, params, options, isReverse = false) {
	options = options || {};
	params = { ...params };
	const old = that.data[listName], page = Number(params.page) || 1;
	if (page > 1 && (!old || old.hasMore === false || old.hasMore === undefined && page > old.count)) return { applied: false };
	const states = that._cloudListStates || (that._cloudListStates = {});
	const state = states[listName] || (states[listName] = { version: 0 });
	const version = ++state.version;
	const current = () => version === state.version && !that._detached && that._pageVisible !== false && (!options.isCurrent || options.isCurrent());
	if (!helper.isDefined(params.isTotal)) params.isTotal = true;
	params.oldTotal = old && old.total || 0;
	if (page > 1 && old.nextCursor) params.cursor = old.nextCursor;
	try {
		const res = await callCloud(route, params, options);
		if (!current()) return { applied: false };
		const next = res && res.data;
		if (!next || !Array.isArray(next.list) || Number(next.page) !== page) throw new Error('列表响应不完整，请重试');
		const previous = that.data[listName];
		if (page > 1 && (!previous || page !== previous.page + 1)) return { applied: false };
		const rows = page === 1 ? next.list : isReverse ? next.list.concat(previous.list) : previous.list.concat(next.list);
		const ids = new Set();
		next.list = rows.filter(row => { if (!row._id) return true; if (ids.has(row._id)) return false; ids.add(row._id); return true; });
		next.error = false;
		that.setData({ [listName]: next });
		return { applied: true, ok: true };
	} catch (error) {
		if (!current()) return { applied: false };
		const previous = that.data[listName];
		that.setData({ [listName]: { ...(previous || { page: 1, size: params.size || 20, list: [], total: 0, count: 0 }),
			error: true, errorMessage: error.msg || error.message || '加载失败，请重试' } });
		return { applied: true, ok: false, error };
	}
}

async function getTempFileURLOne(fileID) {
	if (!fileID) return '';

	let result = await wx.cloud.getTempFileURL({
		fileList: [fileID],
	})
	if (result && result.fileList && result.fileList[0] && result.fileList[0].tempFileURL)
		return result.fileList[0].tempFileURL;
	return '';
}

async function transTempPics(imgList, dir, id, prefix = '') {
	if (setting.IS_DEMO) return imgList;

	if (prefix && !prefix.endsWith('_')) prefix += '_';
	if (!id) id = timeHelper.time('YMD');

	const failedIdx = []; // 记录上传失败的索引
	for (let i = 0; i < imgList.length; i++) {

		let filePath = imgList[i];
		if (!filePath) {
			failedIdx.push(i);
			continue;
		}
		if (typeof filePath === 'string' && filePath.startsWith('cloud://')) continue;

		let ext = (filePath.match(/\.[^.]+?$/) || ['.jpg'])[0];

		// 是否为临时文件
		if (filePath.includes('tmp') || filePath.includes('temp') || filePath.includes('wxfile')) {

			let rd = prefix + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
			let cloudPath = id ? dir + id + '/' + rd + ext : dir + rd + ext;

			if (pageHelper.getPID())
				cloudPath = pageHelper.getPID() + '/' + cloudPath;


			try {
				let res = await wx.cloud.uploadFile({
					cloudPath,
					filePath: filePath, // 文件路径
				});
				imgList[i] = res.fileID;
			} catch (error) {
				// Keep the original path so a retry cannot silently lose this image.
				console.error('[transTempPics] 图片上传失败:', error, 'path=', filePath);
				failedIdx.push(i);
			}
		}
	}

	if (failedIdx.length > 0) {
		// 抛出错误让调用方感知并提示用户
		throw new Error(`有 ${failedIdx.length} 张图片上传失败，请检查网络后重试`);
	}

	return imgList;
}

async function transRichEditorTempPics(content, dir, id, route) {

	let imgList = [];
	for (let k = 0; k < content.length; k++) {
		if (content[k].type == 'img') {
			imgList.push(content[k].val);
		}
	}

	// 图片上传到云空间
	imgList = await transTempPics(imgList, dir, id, 'rich');

	// 更新图片地址
	let imgIdx = 0;
	for (let k = 0; k < content.length; k++) {
		if (content[k].type == 'img') {
			content[k].val = imgList[imgIdx];
			imgIdx++;
		}
	}

	// 更新本记录的图片信息
	let params = {
		id,
		content
	}

	try {
		await callCloudSumbit(route, params);
		return content;
	} catch (e) {
		console.error(e);
		throw e;
	}
}

async function transCoverTempPics(imgList, dir, id, route) {
	// 图片上传到云空间
	imgList = await transTempPics(imgList, dir, id, 'cover');

	// 更新本记录的图片信息
	let params = {
		id,
		imgList: imgList
	}

	try {
		let res = await callCloudSumbit(route, params);
		return res.data.urls;
	} catch (err) {
		console.error(err);
		throw err;
	}
}

async function transFormsTempPics(forms, dir, id, route) {
	wx.showLoading({
		title: '提交中...',
		mask: true
	});

	let hasImageForms = [];
	try {
		for (let k = 0; k < forms.length; k++) {
			if (forms[k].type == 'image') {
				forms[k].val = await transTempPics(forms[k].val, dir, id, 'image');
				hasImageForms.push(forms[k]);
			}
			else if (forms[k].type == 'content') {
				let contentVal = forms[k].val;
				for (let j in contentVal) {
					if (contentVal[j].type == 'img') {
						let ret = await transTempPics([contentVal[j].val], dir, id, 'content');
						if (ret && ret.length > 0) {
							contentVal[j].val = ret[0];
						} else {
							// 上传失败：剔除该图
							contentVal[j].val = '';
						}
					}
				}
				// 过滤掉 val 为空的项
				contentVal = contentVal.filter(item => item.val);
				forms[k].val = contentVal;
				hasImageForms.push(forms[k]);
			}
		}

		if (hasImageForms.length == 0) return;

		let params = {
			id,
			hasImageForms
		}

		if (route) await callCloudSumbit(route, params);
	} catch (err) {
		console.error('[transFormsTempPics] 图片处理失败:', err);
		// 重新抛出，让调用方感知
		throw err;
	} finally {
		wx.hideLoading();
	}
}

async function transTempPicOne(img, dir, id, isCheck = true) {

	if (isCheck) {
		wx.showLoading({
			title: '图片校验中',
			mask: true
		});
		let check = await contentCheckHelper.imgCheck(img);
		if (!check) {
			wx.hideLoading();
			return pageHelper.showModal('不合适的图片, 请重新上传', '温馨提示');
		}
		wx.hideLoading();
	}

	let imgList = [img];
	imgList = await transTempPics(imgList, dir, id);

	if (imgList.length == 0)
		return '';
	else {
		return imgList[0];
	}


}

module.exports = {
	CODE,
	invalidateReadRequests,
	dataList,
	callCloud,
	callCloudSumbit,
	callCloudData,
	callCloudSumbitAsync,
	transTempPics,
	transRichEditorTempPics,
	transCoverTempPics,
	transFormsTempPics,
	getTempFileURLOne,
	transTempPicOne
}
