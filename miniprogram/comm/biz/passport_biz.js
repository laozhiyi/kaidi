/**
 * Notes: 注册登录模块业务逻辑
 * Ver : CCMiniCloud Framework 2.0.1 ALL RIGHTS RESERVED BY cclinux0730 (wechat)
 * Date: 2020-11-14 07:48:00 
 */

const BaseBiz = require('./base_biz.js');
const cacheHelper = require('../../helper/cache_helper.js');
const cloudHelper = require('../../helper/cloud_helper.js');
const pageHelper = require('../../helper/page_helper.js');
const constants = require('../constants.js');
let sessionVersion = 0;
let logoutVersion = 0;
const pendingLogoutKey = constants.CACHE_PENDING_LOGOUT || 'CACHE_PENDING_LOGOUT';
const cancellationKey = constants.CACHE_CANCELLATION || 'CACHE_CANCELLATION';
let revoking = null;
function clearPrivateCaches() {
 if (typeof wx.getStorageInfoSync !== 'function') return;
 for (const key of wx.getStorageInfoSync().keys || []) {
  if (key.startsWith('crun-profile-user-v1:') || /_LIST(?:_deadtime)?$/.test(key) || /^crun-.*draft/.test(key)) wx.removeStorageSync(key);
 }
}

function phoneErrorCode(error) {
 for (const value of [error && error.errCode, error && error.errcode, error && error.errno]) {
  if (/^-?\d{1,8}$/.test(String(value))) return Number(value);
 }
 return null;
}

function tracePhoneLogin(stage, reason = '', error = null) {
 // Never log the event, one-time code, SDK message, phone number or token.
 console.info('[wechat-phone-login]', { stage, reason, errCode: phoneErrorCode(error) });
}

function phoneFailure(error, native) {
 const text = String(error && (error.errMsg || error.message || error.msg) || '');
 if (native) {
  if (/privacy|隐私/i.test(text)) return { reason: 'privacy', message: '手机号授权被微信隐私设置拦截，请联系管理员' };
  if (/user\s*(deny|denied|cancel)|cancel/i.test(text)) return { reason: 'cancelled', message: '已取消手机号授权，可再次点击登录' };
  if (phoneErrorCode(error) === 102 || /no permission|permission denied|not authorized|access denied/i.test(text)) return { reason: 'permission_denied', message: '当前小程序暂无手机号获取权限，请联系管理员检查服务开通状态' };
  if (/not support/i.test(text)) return { reason: 'unsupported', message: '当前微信不支持手机号授权，请更新微信后重试' };
  if (/not available/i.test(text)) return { reason: 'unavailable', message: '微信手机号服务暂不可用，请联系管理员检查服务状态' };
  if (!text || text === 'getPhoneNumber:ok') return { reason: 'missing_code', message: '微信未返回手机号授权结果，请重新授权' };
  return { reason: 'native_error', message: '微信手机号授权未完成，请稍后重试' };
 }
 if (/environment.*not found/i.test(text)) return { reason: 'environment_missing', message: '登录服务配置异常，请联系管理员' };
 if (/FunctionName|FUNCTION_NOT_FOUND/i.test(text)) return { reason: 'function_missing', message: '登录服务暂不可用，请联系管理员' };
 if (/timeout|timed out|time.limit|超时/i.test(text)) return { reason: 'timeout', message: '微信登录响应超时，请检查网络后重新授权' };
 return { reason: 'cloud_error', message: error && (error.msg || error.message) || '微信登录失败，请稍后重新授权' };
}

class PassportBiz extends BaseBiz {

	// 静默登录(有登录状态则不登录)  
	static async loginSilence(that) {
		return await PassportBiz.loginCheck(false, 'slience', 'bar', that);
	}

	// 强制静默登录(有不论是否有登录状态)  
	static async loginSilenceMust(that) {
		return await PassportBiz.loginCheck(false, 'must', 'bar', that);
	}

 // 仅由用户点击“微信登录”触发，打开页面不能恢复会话。
 static async loginByUser(that) {
  const version = logoutVersion;
  const response = await cloudHelper.callCloudSumbit('passport/wechat_identity_login', {}, { title: '微信登录中', hint: false });
  if (version !== logoutVersion) throw new Error('登录状态已更新，请重新登录');
  const data = response && response.data;
  const token = data && data.token, user = data && data.user;
  if (!token || typeof token.id !== 'string' || !token.id || !token.sessionToken || !user || Array.isArray(user)
    || ![0, 1, 8].includes(token.status) || user.USER_STATUS !== token.status
    || typeof token.profileComplete !== 'boolean' || typeof token.phoneVerified !== 'boolean') {
   throw new Error('微信登录未完成，请重新点击登录');
  }
  PassportBiz.setToken(token);
  wx.removeStorageSync(pendingLogoutKey);
  wx.removeStorageSync(cancellationKey);
  if (that && !that._unloaded) that.setData({ isLogin: PassportBiz.isLogin() });
  return data;
 }

 static isLoggedOut() {
  return wx.getStorageSync(constants.CACHE_LOGGED_OUT) === true;
 }

	// 必须登陆 可以取消(窗口形式) 
	static async loginMustCancelWin(that) {
		return await PassportBiz.loginCheck(true, 'cancel', '', that);
	}

	// 必须登陆 只能强制注册或者回上页(窗口形式)  
	static async loginMustBackWin(that) {
		return await PassportBiz.loginCheck(true, 'back', '', that);
	}

	// 获取token  
	static getToken() {
		if (PassportBiz.isLoggedOut()) return null;
		let token = cacheHelper.get(constants.CACHE_TOKEN);
		return token && token.sessionToken ? token : null;
	}

	// 设置token
	static setToken(token) {
		if (!token) return;
		const previous = cacheHelper.get(constants.CACHE_TOKEN);
  if (!token.sessionToken && previous && previous.id === token.id) token = { ...token, sessionToken: previous.sessionToken };
		if (!token.sessionToken) return;
		sessionVersion++;
		cacheHelper.set(constants.CACHE_TOKEN, token, constants.CACHE_TOKEN_EXPIRE);
		wx.removeStorageSync(constants.CACHE_LOGGED_OUT);
  if ((!previous || previous.sessionToken !== token.sessionToken) && cloudHelper.invalidateSessionRequests) cloudHelper.invalidateSessionRequests();
	}

	//  获取user id 
	static getUserId() {
		let token = PassportBiz.getToken();
		if (!token) return '';
		return token.id || '';
	}

	// 获取user name 
	static getUserName() {
		let token = PassportBiz.getToken();
		if (!token) return '';
		return token.name || '';
	}

	static getStatus() {
		let token = PassportBiz.getToken();
		if (!token) return -1;
		return typeof token.status === 'number' ? token.status : -1;
	}

	// 是否登录 
	static isLogin() {
		const token = PassportBiz.getToken();
  return !!(token && token.id && token.status === 1 && PassportBiz.isProfileReady(token));
	}

 static isProfileReady(token) {
  return !!(token && token.profileComplete === true && (token.phoneVerified === true || token.allowManualRegistration === true));
 }

	static loginStatusHandler(method, status) {
		let content = '';
		if (status == 0) content = '您的注册正在审核中，暂时无法使用此功能！';
		else if (status == 8) content = '您的注册审核未通过，暂时无法使用此功能；请在个人中心修改资料，再次提交审核！';
		else if (status == 9) content = '您的账号已经禁用, 无法使用此功能！';
		if (method == 'cancel') {
			wx.showModal({
				title: '温馨提示',
				content,
				confirmText: '取消',
				showCancel: false
			});
		}
		else if (method == 'back') {
			wx.showModal({
				title: '温馨提示',
				content,
				confirmText: '返回',
				showCancel: false,
				success(result) {
					wx.navigateBack();
				}
			});
		}
		return false;
	}

	// 登录判断及处理
	static async loginCheck(mustLogin = false, method = 'back', title = '', that = null) {
  if (PassportBiz.isLoggedOut()) return PassportBiz._loginDecision(null, mustLogin, method, that);
  const token = PassportBiz.getToken();
  if (!token) return PassportBiz._loginDecision(null, mustLogin, method, that);
  // Manual sessions recheck the temporary server policy on guarded entry.
  if (token && method !== 'must' && !(token.allowManualRegistration === true && token.phoneVerified !== true)
    && typeof token.phoneVerified === 'boolean' && typeof token.profileComplete === 'boolean') {
   return PassportBiz._loginDecision(token, mustLogin, method, that);
  }
  const version = sessionVersion;
  try {
   const result = await cloudHelper.callCloudSumbit('passport/login', {}, { title: title || '登录中' });
   // A stale background refresh must not undo a newer authorization or save.
   if (version !== sessionVersion) return PassportBiz._loginDecision(PassportBiz.getToken(), mustLogin, method, that);
   const current = result && result.data && result.data.token || null;
   if (current) PassportBiz.setToken(current);
   else PassportBiz.clearToken();
   return PassportBiz._loginDecision(current, mustLogin, method, that);
  } catch (err) {
   if (version === sessionVersion && err && err.code && err.code !== 500 && !err.staleScope) PassportBiz.clearToken();
   if (that && !that._unloaded) that.setData({ isLogin: PassportBiz.isLogin() });
   return false;
  }
	}

 static _loginDecision(token, mustLogin, method, that) {
  const allowed = !!(token && token.id && token.status === 1 && PassportBiz.isProfileReady(token));
  if (that && !that._unloaded) that.setData({ isLogin: allowed });
  if (allowed || !mustLogin) return allowed;
  if (token && (token.status === 9 || PassportBiz.isProfileReady(token) && [0, 8].includes(token.status))) {
   return PassportBiz.loginStatusHandler(method, token.status);
  }
  const completing = !!(token && (token.phoneVerified || token.allowManualRegistration));
  wx.showModal({
   title: completing ? '完善联系资料' : '微信登录',
   content: completing ? '发布或接单前，请先完善联系资料。' : '请先使用微信登录。',
   confirmText: completing ? '完善资料' : '去登录', cancelText: method === 'back' ? '返回' : '取消',
   success(result) {
    if (result.confirm) {
     const retUrl = method === 'back' ? encodeURIComponent(pageHelper.getCurrentPageUrlWithArgs()) : 'back';
     const url = pageHelper.fmtURLByPID('/pages/my/reg/my_reg') + '?retUrl=' + retUrl;
     if (method === 'back') wx.redirectTo({ url }); else wx.navigateTo({ url });
    } else if (result.cancel && method === 'back') {
     if (getCurrentPages().length > 1) wx.navigateBack();
     else wx.reLaunch({ url: pageHelper.fmtURLByPID('/pages/default/index/default_index') });
    }
   }
  });
  return false;
 }

 static traceWechatPhoneTap() {
  tracePhoneLogin('native_tap');
 }

 static async loginByWechatPhone(event) {
  const detail = event && event.detail || {};
  if (typeof detail.code !== 'string' || !detail.code.trim() || detail.errMsg && detail.errMsg !== 'getPhoneNumber:ok') {
   const failure = phoneFailure(detail, true);
   tracePhoneLogin('native_callback', failure.reason, detail);
   throw Object.assign(new Error(failure.message), { reason: failure.reason });
  }
  tracePhoneLogin('native_callback', 'ok');
  // Cloud development already supplies trusted OPENID. This is a phone code,
  // not wx.login's session code; do not persist it or retry it automatically.
  let response;
  const version = logoutVersion;
  tracePhoneLogin('cloud_request');
  try {
   response = await cloudHelper.callCloudSumbit('passport/wechat_login', { code: detail.code }, { title: '微信登录中', hint: false });
  } catch (error) {
   const failure = phoneFailure(error, false);
   tracePhoneLogin('cloud_failure', failure.reason, error);
   throw Object.assign(new Error(failure.message), { reason: failure.reason });
  }
  const data = response && response.data;
  if (version !== logoutVersion) throw new Error('登录状态已更新，请重新登录');
  if (!data || !data.token || !data.token.id || !data.token.sessionToken || data.token.phoneVerified !== true) {
   tracePhoneLogin('invalid_response');
   throw new Error('微信登录未完成，请重新授权');
  }
  PassportBiz.setToken(data.token);
  tracePhoneLogin('cloud_success');
  return data;
 }

	// 清除登录缓存
	static clearToken() {
  sessionVersion++;
		cacheHelper.remove(constants.CACHE_TOKEN);
	}

 static logout() {
  wx.setStorageSync(constants.CACHE_LOGGED_OUT, true);
  logoutVersion++;
  PassportBiz.clearToken();
  clearPrivateCaches();
  if (cloudHelper.invalidateSessionRequests) cloudHelper.invalidateSessionRequests();
 }

 static logoutEpoch() { return logoutVersion; }
 static onSessionChange(listener) { return cloudHelper.onSessionChange ? cloudHelper.onSessionChange(listener) : () => {}; }

 static logoutByUser() {
  const token = PassportBiz.getToken();
  if (token && token.sessionToken) wx.setStorageSync(pendingLogoutKey, { token: token.sessionToken, createdAt: Date.now() });
  PassportBiz.logout();
  return PassportBiz.flushLogout();
 }

 static flushLogout() {
  if (revoking) return revoking;
  const pending = wx.getStorageSync(pendingLogoutKey);
  if (!pending || !pending.token) return Promise.resolve(true);
  const request = cloudHelper.callCloudSumbit('passport/logout', {}, { hint: false, authToken: pending.token,
   ignoreSessionChange: true }).then(() => {
    const current = wx.getStorageSync(pendingLogoutKey);
    if (current && current.token === pending.token) wx.removeStorageSync(pendingLogoutKey);
    return true;
   }).catch(() => false).finally(() => { if (revoking === request) revoking = null; });
  revoking = request; return request;
 }

 static async cancelAccount() {
  const token = PassportBiz.getToken(), version = logoutVersion;
  if (!token) throw new Error('请先登录');
  const response = await cloudHelper.callCloudSumbit('passport/cancel', {}, { title: '申请注销', hint: false });
  const data = response && response.data;
  if (!data || !Number.isFinite(data.cancelAt) || data.cancelAt - data.requestedAt !== 7200000) throw new Error('注销申请未确认，请重试');
  if (version !== logoutVersion) return data;
  wx.setStorageSync(cancellationKey, { requestedAt: data.requestedAt, cancelAt: data.cancelAt });
  PassportBiz.logout();
  return data;
 }

	// 手机号码
	static async getPhone(e, that) {
  const result = await PassportBiz.loginByWechatPhone(e);
  if (that && !that._unloaded) that.setData({ formMobile: result.user.USER_MOBILE, phoneVerified: true });
  return result;
	}
}



/** 表单校验    */
PassportBiz.CHECK_FORM = {
	name: 'formName|must|string|min:1|max:30|name=昵称',
	mobile: 'formMobile|must|len:11|name=手机',
	forms: 'formForms|array'
};


if (cloudHelper.onSessionChange) cloudHelper.onSessionChange(reason => {
 if (reason !== 'expired') return;
 logoutVersion++; sessionVersion++;
 clearPrivateCaches();
 wx.reLaunch({ url: '/projects/crun/pages/my/index/my_index' });
});
module.exports = PassportBiz;
