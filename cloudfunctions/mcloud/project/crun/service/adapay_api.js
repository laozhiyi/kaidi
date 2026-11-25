'use strict';
// Wire protocol verified against AdaPay official Node SDK 1.3.1 Http.js and Java Common.
// Keep the adapter independent of the SDK's raw request/response logging.
const crypto = require('crypto');
const cfg = require('../config/adapay_config.js');
const base = 'https://api.adapay.tech';
const safeCode = value => /^[A-Za-z0-9_]{1,80}$/.test(value || '') ? value : 'ADAPAY_REJECTED';
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
     if (res.statusCode < 200 || res.statusCode >= 300 || data.status === 'failed') throw Object.assign(new Error('ADAPAY_REQUEST_REJECTED'),{code:safeCode(data.error_code),verified:true});
     resolve(data);
    } catch (e) { reject(Object.assign(new Error('ADAPAY_REQUEST_FAILED'),{code:safeCode(e.code || e.message),verified:e.verified===true})); }
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
module.exports = {request, notification, verify, decode, cents, money};
