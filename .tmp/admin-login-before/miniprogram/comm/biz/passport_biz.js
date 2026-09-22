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
  if (/no permission|permission denied|not authorized|not support|not available|access denied/i.test(text)) return { reason: 'unavailable', message: '微信手机号授权暂不可用，请联系管理员' };
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
		let token = cacheHelper.get(constants.CACHE_TOKEN);
		return token || null;
	}

	// 设置token
	static setToken(token) {
		if (!token) return;
		sessionVersion++;
		cacheHelper.set(constants.CACHE_TOKEN, token, constants.CACHE_TOKEN_EXPIRE);
	}

	//  获取user id 
	static getUserId() {
		let token = cacheHelper.get(constants.CACHE_TOKEN);
		if (!token) return '';
		return token.id || '';
	}

	// 获取user name 
	static getUserName() {
		let token = cacheHelper.get(constants.CACHE_TOKEN);
		if (!token) return '';
		return token.name || '';
	}

	static getStatus() {
		let token = cacheHelper.get(constants.CACHE_TOKEN);
		if (!token) return -1;
		return typeof token.status === 'number' ? token.status : -1;
	}

	// 是否登录 
	static isLogin() {
		const token = PassportBiz.getToken();
  return !!(token && token.id && token.status === 1 && token.phoneVerified === true && token.profileComplete === true);
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
  const token = PassportBiz.getToken();
  if (token && method !== 'must' && typeof token.phoneVerified === 'boolean' && typeof token.profileComplete === 'boolean') {
   return PassportBiz._loginDecision(token, mustLogin, method, that);
  }
  const version = sessionVersion;
  try {
   const result = await cloudHelper.callCloudSumbit('passport/login', {}, { title: title || '登录中' });
   // A stale background refresh must not undo a newer authorization or save.
   if (version !== sessionVersion) return PassportBiz._loginDecision(PassportBiz.getToken(), mustLogin, method, that);
   const current = result && result.data && result.data.token || null;
   if (current) PassportBiz.setToken(current); else PassportBiz.clearToken();
   return PassportBiz._loginDecision(current, mustLogin, method, that);
  } catch (err) {
   if (version === sessionVersion && err && err.code && err.code !== 500 && !err.staleScope) PassportBiz.clearToken();
   if (that && !that._unloaded) that.setData({ isLogin: PassportBiz.isLogin() });
   return false;
  }
	}

 static _loginDecision(token, mustLogin, method, that) {
  const allowed = !!(token && token.id && token.status === 1 && token.phoneVerified === true && token.profileComplete === true);
  if (that && !that._unloaded) that.setData({ isLogin: allowed });
  if (allowed || !mustLogin) return allowed;
  if (token && (token.status === 9 || token.phoneVerified && token.profileComplete && [0, 8].includes(token.status))) {
   return PassportBiz.loginStatusHandler(method, token.status);
  }
  const completing = !!(token && token.phoneVerified);
  wx.showModal({
   title: completing ? '完善个人资料' : '微信登录',
   content: completing ? '请先补全个人资料，再使用此功能。' : '请先授权微信手机号并完善个人资料，再使用此功能。',
   confirmText: completing ? '完善资料' : '微信登录', cancelText: method === 'back' ? '返回' : '取消',
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
   throw new Error(failure.message);
  }
  tracePhoneLogin('native_callback', 'ok');
  // Cloud development already supplies trusted OPENID. This is a phone code,
  // not wx.login's session code; do not persist it or retry it automatically.
  let response;
  tracePhoneLogin('cloud_request');
  try {
   response = await cloudHelper.callCloudSumbit('passport/wechat_login', { code: detail.code }, { title: '微信登录中', hint: false });
  } catch (error) {
   const failure = phoneFailure(error, false);
   tracePhoneLogin('cloud_failure', failure.reason, error);
   throw new Error(failure.message);
  }
  const data = response && response.data;
  if (!data || !data.token || !data.token.id || data.token.phoneVerified !== true) {
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


module.exports = PassportBiz;
