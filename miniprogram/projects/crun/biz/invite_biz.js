const cloudHelper = require('../../../helper/cloud_helper.js');
const CACHE_KEY = 'crun-pending-invite';
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
let pendingRequest = null;

function normalize(code) { return String(code || '').trim().toUpperCase(); }
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
module.exports = { capture, getPendingCode, acceptPending, normalize };
