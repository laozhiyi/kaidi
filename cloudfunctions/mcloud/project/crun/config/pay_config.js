'use strict';

const env = process.env;
const pem = value => (value || '').replace(/\\n/g, '\n').trim();
const config = {
 provider: (env.PAYMENT_PROVIDER || 'wechat').trim(),
 adapayReady: () => require('./adapay_config.js').ready(),
 appid: (env.WECHAT_APP_ID || '').trim(),
 mchid: (env.WECHAT_PAY_MCH_ID || '').trim(),
 privateKey: pem(env.WECHAT_PAY_PRIVATE_KEY),
 serial: (env.WECHAT_PAY_CERT_SERIAL || '').trim(),
 publicKey: pem(env.WECHAT_PAY_PUBLIC_KEY),
 publicKeyId: (env.WECHAT_PAY_PUBLIC_KEY_ID || '').trim(),
 apiV3Key: env.WECHAT_PAY_API_V3_KEY || '',
 notifyUrl: (env.WECHAT_PAY_NOTIFY_URL || '').trim()
};

function rsaKey(value, parse) {
 try { return parse(value).asymmetricKeyType === 'rsa'; }
 catch (_) { return false; }
}

function validNotifyUrl(value) {
 try {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.search && !url.hash && !url.username && !url.password;
 } catch (_) { return false; }
}

config.invalidFields = () => {
 const crypto = require('crypto');
 const checks = {
  WECHAT_APP_ID: /^wx[a-f\d]{16}$/i.test(config.appid),
  WECHAT_PAY_MCH_ID: /^\d{8,32}$/.test(config.mchid),
  WECHAT_PAY_CERT_SERIAL: /^[a-f\d]+$/i.test(config.serial),
  WECHAT_PAY_PUBLIC_KEY_ID: /^PUB_KEY_ID_\d+$/.test(config.publicKeyId),
  WECHAT_PAY_API_V3_KEY: Buffer.byteLength(config.apiV3Key) === 32,
  WECHAT_PAY_NOTIFY_URL: validNotifyUrl(config.notifyUrl),
  WECHAT_PAY_PRIVATE_KEY: rsaKey(config.privateKey, crypto.createPrivateKey),
  WECHAT_PAY_PUBLIC_KEY: rsaKey(config.publicKey, crypto.createPublicKey)
 };
 return Object.keys(checks).filter(name => !checks[name]);
};
config.ready = () => config.invalidFields().length === 0;
config.requested = () => env.WECHAT_PAY_ENABLED === 'true';
config.enabled = () => config.requested() && config.ready();

module.exports = config;
