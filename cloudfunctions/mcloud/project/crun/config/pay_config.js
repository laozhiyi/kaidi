/**
 * 微信支付配置
 * 
 * 生产环境应该通过环境变量或云函数配置覆盖这些值
 */

module.exports = {
  // 小程序 AppID
  appid: process.env.WECHAT_APP_ID || 'wxa19ea5401f038886',
  
  // 商户号（由微信支付分配）
  mchid: process.env.WECHAT_PAY_MCH_ID || '1003137035',
  
  // APIv3 密钥（在商户平台生成）
  // 注意：这是 HMAC 签名的密钥，不是 RSA 私钥
  key: process.env.WECHAT_API_KEY || 'MIIEvgIBADANBgkqhkiG9w0BAQEFAASC',
  
  // 支付成功回调通知地址（可选，系统会自动处理）
  notifyUrl: process.env.WECHAT_PAY_NOTIFY_URL || 'https://api.mch.weixin.qq.com/pay/notify',
  
  // 支付结果回调的云函数名
  callbackFunction: process.env.WECHAT_PAY_CALLBACK_FUNCTION || 'mcloud'
};
