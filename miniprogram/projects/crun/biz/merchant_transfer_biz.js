// 商家转账用户确认模式：拉起微信收款确认页（requestMerchantTransfer）
// 文档：success 仅代表页面展示成功，不代表收款成功；收款结果以服务端查单为准。

function supported() {
 if (typeof wx === 'undefined' || typeof wx.requestMerchantTransfer !== 'function') return false;
 try { return typeof wx.canIUse !== 'function' || wx.canIUse('requestMerchantTransfer'); }
 catch (_) { return false; }
}

// 返回 'ok' | 'cancel'；其他失败抛出带可读文案的 Error
function requestMerchantTransfer(confirm) {
 if (!supported()) return Promise.reject(new Error('你的微信版本过低，请更新至最新版本'));
 if (!confirm || !confirm.appId || !confirm.mchId || !confirm.package) {
  return Promise.reject(new Error('收款参数缺失，请稍后重试'));
 }
 return new Promise((resolve, reject) => {
  wx.requestMerchantTransfer({
   mchId: confirm.mchId,
   appId: confirm.appId,
   package: confirm.package,
   success: () => resolve('ok'),
   fail: res => {
    const message = (res && res.errMsg) || '';
    // requestMerchantTransfer:cancel —— 用户未确认收款并返回
    if (/cancel/i.test(message)) return resolve('cancel');
    // package 过期（24 小时内未领取）需重新发起转账
    if (/expire|过期|invalid|package/i.test(message)) return reject(new Error('收款链接已过期，请等待系统重新发起'));
    reject(new Error('收款页面打开失败，请稍后重试'));
   }
  });
 });
}

module.exports = { requestMerchantTransfer, supported };
