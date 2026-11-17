const Ops = require('./operations_biz.js');
const Passport = require('../../../comm/biz/passport_biz.js');

async function ensure(orderId, isCurrent = () => true) {
 const token = Passport.getToken();
 if (!token || !token.id || !token.sessionToken) throw new Error('请先微信登录');
 const check = () => {
  const current = Passport.getToken();
  if (!isCurrent() || !current || current.id !== token.id || current.sessionToken !== token.sessionToken) {
   throw new Error('登录状态或当前页面已变化，请重新接单');
  }
 };
 check();
 const result = await Ops.get('mail/earnings_authorization_prepare', { id: orderId });
 check();
 if (result && result.authorized === true) return true;
 if (!result || result.authorized !== false || !result.confirm || !result.confirm.appId || !result.confirm.mchId || !result.confirm.package) {
  throw new Error('未收到有效的结算授权，请重新接单');
 }
 if (typeof wx.requestMerchantTransfer !== 'function') throw new Error('请更新微信后开通报酬自动到账');
 try {
  await new Promise((resolve, reject) => wx.requestMerchantTransfer({ ...result.confirm, success: resolve, fail: reject }));
 } catch (error) {
  check();
  throw new Error(error && /cancel/i.test(error.errMsg || '') ? '已取消报酬自动到账授权，尚未接单' : '结算授权未完成，请重新接单');
 }
 check();
 // JSAPI success only means the authorization page opened. The signed server query decides whether to accept the order.
 const confirmed = await Ops.get('mail/earnings_authorization_confirm');
 check();
 if (!confirmed || confirmed.authorized !== true) throw new Error('报酬自动到账授权尚未生效，请重新接单');
 return true;
}

module.exports = { ensure };
