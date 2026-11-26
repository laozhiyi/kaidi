'use strict';
// Wire protocol verified against AdaPay official Node SDK 1.3.1 Http.js and Java Common.
// Keep the adapter independent of the SDK's raw request/response logging.
const crypto = require('crypto');
const cfg = require('../config/adapay_config.js');
const base = 'https://api.adapay.tech';
const safeCode = value => /^[A-Za-z0-9_]{1,80}$/.test(value || '') ? value : 'ADAPAY_REJECTED';
// 把支付机构/银行渠道的拒绝原因归成固定类别，供页面提示用户改哪一项。
// error_msg 原文可能带证件号或卡号，只在内存中匹配关键词，不返回、不保存、不打印。
function reasonOf(data) {
 const param = String(data && data.invalid_param || '').toLowerCase(), msg = String(data && data.error_msg || '');
 if (/tel|phone|mobile/.test(param)) return 'phone';
 if (/cert/.test(param)) return 'identity';
 if (/name/.test(param)) return 'name';
 if (/card|acct|bank/.test(param)) return 'card';
 if (/已存在|重复/.test(msg)) return 'exists';
 if (/手机/.test(msg)) return 'phone';
 if (/信用卡|贷记|准贷记|[二Ⅱ]类|II类|卡类型|卡种|不支持(该|此)?(银行)?卡/.test(msg)) return 'card_type';
 const identity = /身份证|证件/.test(msg), name = /姓名|户名/.test(msg), card = /卡号|银行卡|账号/.test(msg);
 // 同时提到银行卡和身份信息时说不清是哪一项错，按整体不匹配提示逐项核对。
 if (card && (identity || name)) return 'mismatch';
 if (identity) return 'identity';
 if (name) return 'name';
 if (card) return 'card';
 if (/频繁|次数|上限|超限/.test(msg)) return 'limit';
 if (/要素|鉴权|认证|验证|不一致|不匹配|有误/.test(msg)) return 'mismatch';
 return '';
}
function verify(data, signature) {
 if (typeof data !== 'string' || typeof signature !== 'string' || !crypto.verify('RSA-SHA1', Buffer.from(data), cfg.publicKey, Buffer.from(signature, 'base64'))) throw new Error('ADAPAY_SIGNATURE_INVALID');
 return JSON.parse(data);
}
function decode(raw) {
 const packet = JSON.parse(raw);
 return verify(packet.data, packet.signature);
}
function request(method, path, params = {}) {
 if (!cfg.ready()) return Promise.reject(new Error('ADAPAY_NOT_CONFIGURED'));
 if (!/^\/v1\/[A-Za-z0-9_/-]+$/.test(path) || !['GET','POST'].includes(method)) throw new Error('ADAPAY_PATH_INVALID');
 const args = {...params, app_id: cfg.appid};
 const query = Object.keys(args).sort().map(k => k + '=' + args[k]).join('&');
 const body = method === 'POST' ? JSON.stringify(args) : '';
 const signature = crypto.sign('RSA-SHA1', Buffer.from(base + path + (method === 'POST' ? body : query)), cfg.privateKey).toString('base64');
 const url = new URL(base + path);
 if (method === 'GET') for (const k of Object.keys(args).sort()) url.searchParams.set(k, args[k]);
 return new Promise((resolve,reject) => {
  // AdaPay GET handlers must receive query parameters without a JSON content type,
  // matching the official SDK. JSON headers on GET cause app_not_exists responses.
  const headers = {Authorization:cfg.apiKey,Signature:signature,sdk_version:'node_1.3.1'};
  if (method === 'POST') headers['Content-Type'] = 'application/json';
  const req = require('https').request(url, {method,headers}, res => {
   const chunks = []; let size = 0;
   res.on('data', b => {size += b.length; if (size > 1024*1024) req.destroy(new Error('ADAPAY_RESPONSE_TOO_LARGE')); else chunks.push(b);});
   res.on('error', () => reject(new Error('ADAPAY_NETWORK_ERROR')));
   res.on('end', () => {
    try {
     const data = decode(Buffer.concat(chunks).toString('utf8'));
     if (res.statusCode < 200 || res.statusCode >= 300 || data.status === 'failed') throw Object.assign(new Error('ADAPAY_REQUEST_REJECTED'),{code:safeCode(data.error_code),verified:true,reason:reasonOf(data)});
     resolve(data);
    } catch (e) { reject(Object.assign(new Error('ADAPAY_REQUEST_FAILED'),{code:safeCode(e.code || e.message),verified:e.verified===true,reason:e.verified===true ? e.reason || '' : ''})); }
   });
  });
  // Never attach the HTTP request, response, credentials, or provider descriptions to errors.
  req.on('error', () => reject(new Error('ADAPAY_NETWORK_ERROR')));
  req.setTimeout(8000, () => req.destroy(new Error('ADAPAY_TIMEOUT')));
  req.end(body || undefined);
 });
}
function notification(event) {
 const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body;
 if (typeof raw !== 'string' || raw.length > 1024*1024) throw new Error('ADAPAY_BODY_INVALID');
 const p = raw.trim().startsWith('{') ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw));
 // Event type is outside the signed data; downstream decisions always re-query signed objects.
 return verify(p.data, p.sign);
}
function cents(value) {
 if (typeof value !== 'string' || !/^\d+\.\d{2}$/.test(value)) throw new Error('ADAPAY_AMOUNT_INVALID');
 const [whole, fraction] = value.split('.');
 const n = Number(whole)*100 + Number(fraction);
 if (!Number.isSafeInteger(n)) throw new Error('ADAPAY_AMOUNT_INVALID');
 return n;
}
const money = n => { if (!Number.isSafeInteger(n) || n < 0) throw new Error('ADAPAY_AMOUNT_INVALID'); return (n/100).toFixed(2); };
module.exports = {request, notification, verify, decode, cents, money, reasonOf};
