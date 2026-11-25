'use strict';
const env = process.env, crypto = require('crypto');
function pem(value, type) {
 const raw = String(value || '').replace(/\\n/g, '\n').trim();
 if (!raw) return raw;
 const begin = `-----BEGIN ${type} KEY-----`, end = `-----END ${type} KEY-----`;
 let body = raw;
 if (raw.includes('-----BEGIN')) {
  // Normalize only the expected PEM type. Keep malformed/other key types invalid.
  if (!raw.startsWith(begin) || !raw.endsWith(end)) return raw;
  body = raw.slice(begin.length, -end.length);
 }
 return `${begin}\n${body.replace(/\s/g, '')}\n${end}`;
}
const cfg = {
 appid: (env.ADAPAY_APP_ID || '').trim(), apiKey: (env.ADAPAY_API_KEY || '').trim(),
 wxAppid: (env.WECHAT_APP_ID || '').trim(),
 privateKey: pem(env.ADAPAY_PRIVATE_KEY, 'PRIVATE'), publicKey: pem(env.ADAPAY_PUBLIC_KEY, 'PUBLIC'),
 notifyUrl: (env.ADAPAY_NOTIFY_URL || '').trim(), digestKey: env.ADAPAY_IDENTITY_HMAC_KEY || '',
 // Live transactions require explicit opt-in; mock and live identities must never be mixed.
 prod: env.ADAPAY_PROD_MODE === 'true',
 selected: () => env.PAYMENT_PROVIDER === 'adapay'
};
cfg.invalidFields = () => {
 const bad = [];
 for (const [name, value, parse] of [['ADAPAY_PRIVATE_KEY',cfg.privateKey,crypto.createPrivateKey],['ADAPAY_PUBLIC_KEY',cfg.publicKey,crypto.createPublicKey]]) {
  try { if (parse(value).asymmetricKeyType !== 'rsa') bad.push(name); } catch (_) { bad.push(name); }
 }
 if (!/^app_[A-Za-z0-9_-]+$/.test(cfg.appid)) bad.push('ADAPAY_APP_ID');
 if (!new RegExp(cfg.prod ? '^api_live_' : '^api_test_').test(cfg.apiKey)) bad.push('ADAPAY_API_KEY');
 if (!/^wx[a-f\d]{16}$/i.test(cfg.wxAppid)) bad.push('WECHAT_APP_ID');
 if (Buffer.byteLength(cfg.digestKey) < 32) bad.push('ADAPAY_IDENTITY_HMAC_KEY');
 try { const u = new URL(cfg.notifyUrl); if (u.protocol !== 'https:' || u.search || u.hash || u.username || u.password || !u.pathname.endsWith('/adapay/notify')) bad.push('ADAPAY_NOTIFY_URL'); }
 catch (_) { bad.push('ADAPAY_NOTIFY_URL'); }
 return bad;
};
cfg.ready = () => cfg.invalidFields().length === 0;
module.exports = cfg;
