const cloudHelper = require('../../../helper/cloud_helper.js');
const Passport = require('../../../comm/biz/passport_biz.js');
const CACHE_KEY = 'crun-pending-invite';
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
let pendingRequest = null;
let pendingRequestCode = '';

function normalize(code) { return String(code || '').trim().toUpperCase(); }
/**
 * 小程序码的 scene 是 URL 编码后的一串字符，可能直接是邀请码，也可能是 a=1&code=XXXX。
 * 两种都要能认出来，认不出就返回空，绝不让脏值进缓存。
 */
function parseScene(scene) {
  let value = String(scene || '').trim();
  if (!value) return '';
  try { value = decodeURIComponent(value); } catch (error) { /* 微信已解码时会抛错，保持原值 */ }
  if (value.includes('=')) {
    const params = {};
    value.split('&').forEach(pair => {
      const index = pair.indexOf('=');
      if (index > 0) params[pair.slice(0, index)] = pair.slice(index + 1);
    });
    value = params.code || params.c || params.inviteCode || '';
  }
  const code = normalize(value);
  return /^[A-Z0-9]{6}$/.test(code) ? code : '';
}
function capture(code) {
  code = normalize(code);
  if (!/^[A-Z0-9]{6}$/.test(code)) return '';
  wx.setStorageSync(CACHE_KEY, { code, savedAt: Date.now() });
  return code;
}
function getPendingCode() {
  const saved = wx.getStorageSync(CACHE_KEY);
  if (!saved || Date.now() - saved.savedAt >= MAX_AGE || !/^[A-Z0-9]{6}$/.test(saved.code || '')) return '';
  return saved.code;
}
function acceptPending(code = getPendingCode()) {
  code = normalize(code);
  if (!code) return Promise.resolve(null);
  if (pendingRequest && pendingRequestCode === code) return pendingRequest;
  capture(code);
  pendingRequestCode = code;
  const request = pendingRequest = cloudHelper.callCloudData('invite/accept', { code }, { hint: false }).then(result => {
    if (!result || typeof result.accepted !== 'boolean') throw new Error('邀请信息暂未同步');
    if (getPendingCode() === code) wx.removeStorageSync(CACHE_KEY);
    return result;
  }).finally(() => { if (pendingRequest === request) pendingRequest = null; });
  return request;
}
function clear() { wx.removeStorageSync(CACHE_KEY); }
/**
 * 落地处理（app.js 在每次进入小程序时调用一次，页面里不需要再加）：
 * 未注册 / 未登录 -> 什么都不做，保留暂存，注册页自动预填；
 * 已注册 -> 调一次绑定，服务端判定已绑定 / 码无效都会给出明确结果，随后清掉暂存；网络失败则保留，下次再试。
 */
function settle() {
  if (!getPendingCode() || !Passport.isLogin()) return Promise.resolve(null);
  return acceptPending().catch(() => null);
}
module.exports = { capture, getPendingCode, acceptPending, normalize, parseScene, clear, settle };
