const cloudHelper = require('../../../helper/cloud_helper.js');
const CACHE_KEY = 'crun-pending-invite';
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
let pendingRequest = null;

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
  if (pendingRequest) return pendingRequest;
  capture(code);
  pendingRequest = cloudHelper.callCloudData('invite/accept', { code }, { hint: false }).then(result => {
    if (!result || typeof result.accepted !== 'boolean') throw new Error('邀请信息暂未同步');
    if (getPendingCode() === code) wx.removeStorageSync(CACHE_KEY);
    return result;
  }).finally(() => { pendingRequest = null; });
  return pendingRequest;
}
module.exports = { capture, getPendingCode, acceptPending, normalize, parseScene };
