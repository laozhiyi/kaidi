'use strict';
const crypto = require('crypto');
const config = require('../config/pay_config.js');

function sign(message) {
 return crypto.sign('RSA-SHA256', Buffer.from(message), config.privateKey).toString('base64');
}

function verify(headers, body) {
 const serial = headers['wechatpay-serial'];
 const timestamp = headers['wechatpay-timestamp'];
 const nonce = headers['wechatpay-nonce'];
 const signature = headers['wechatpay-signature'];
 if (serial !== config.publicKeyId || !/^\d{10}$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 ||
     !nonce || !signature || !crypto.verify('RSA-SHA256', Buffer.from(timestamp + '\n' + nonce + '\n' + body + '\n'),
      config.publicKey, Buffer.from(signature, 'base64'))) throw new Error('INVALID_WECHAT_SIGNATURE');
}

function notification(event) {
 const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([key, value]) => [key.toLowerCase(), value]));
 if (typeof event.body !== 'string') throw new Error('INVALID_WECHAT_BODY');
 const body = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
 verify(headers, body);
 const notice = JSON.parse(body);
 const resource = notice.resource;
 if (!resource || resource.algorithm !== 'AEAD_AES_256_GCM') throw new Error('INVALID_WECHAT_RESOURCE');
 const bytes = Buffer.from(resource.ciphertext, 'base64');
 const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(config.apiV3Key), Buffer.from(resource.nonce));
 decipher.setAuthTag(bytes.subarray(-16));
 decipher.setAAD(Buffer.from(resource.associated_data || ''));
 const result = Buffer.concat([decipher.update(bytes.subarray(0, -16)), decipher.final()]);
 return { type: notice.event_type, data: JSON.parse(result.toString('utf8')) };
}

async function request(method, path, body) {
 const timestamp = String(Math.floor(Date.now() / 1000));
 const nonce = crypto.randomBytes(16).toString('hex');
 const json = body ? JSON.stringify(body) : '';
 const signature = sign([method, path, timestamp, nonce, json, ''].join('\n'));
 const authorization = 'WECHATPAY2-SHA256-RSA2048 mchid="' + config.mchid + '",nonce_str="' + nonce +
  '",timestamp="' + timestamp + '",serial_no="' + config.serial + '",signature="' + signature + '"';
 return new Promise((resolve, reject) => {
  const req = require('https').request({
   hostname: 'api.mch.weixin.qq.com', method, path, headers: {
    Authorization: authorization, 'Wechatpay-Serial': config.publicKeyId, Accept: 'application/json',
    'Content-Type': 'application/json', 'User-Agent': 'yunsuqu-cloud/1.0'
   }
  }, res => {
   const chunks = [];
   res.on('data', chunk => chunks.push(chunk));
   res.on('error', reject);
   res.on('end', () => {
    try {
     const raw = Buffer.concat(chunks).toString('utf8');
     if (res.statusCode < 200 || res.statusCode >= 300) {
      // Only a signed error may drive a money-state transition.
      verify(res.headers, raw);
      const error = JSON.parse(raw);
      if (path.startsWith('/v3/fund-app/mch-transfer/transfer-bills')) {
       const description = typeof error.message === 'string' ? error.message : '';
       let reason = 'other';
       if (/转账上下限|单笔.{0,12}(?:限额|下限|上限)|转账金额.{0,12}(?:过低|过高)/i.test(description)) reason = 'transfer_amount_limit';
       else if (/IP地址不允许|IP.{0,10}白名单/i.test(description)) reason = 'transfer_ip_not_allowed';
       else if (/收款感知|报备信息|转账场景/.test(description)) reason = 'transfer_scene';
       else if (/openid/i.test(description)) reason = 'transfer_openid';
       else if (/余额不足/.test(description)) reason = 'transfer_balance';
       const requestId = res.headers['request-id'];
       console.warn('[payment] merchant transfer rejected', {
        method,
        code: typeof error.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(error.code) ? error.code : 'UNKNOWN',
        statusCode: res.statusCode,
        reason,
        ...(method === 'POST' && Number.isSafeInteger(body?.transfer_amount) ? { amountFen: body.transfer_amount } : {}),
        ...(typeof requestId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(requestId) ? { wechatRequestId: requestId } : {})
       });
      }
      throw Object.assign(new Error('WECHAT_REQUEST_FAILED'), { code: error.code, statusCode: res.statusCode });
     }
     if (res.statusCode === 204 && !raw && !res.headers['wechatpay-signature']) return resolve(null);
     verify(res.headers, raw);
     resolve(raw ? JSON.parse(raw) : null);
    } catch (error) { reject(error); }
   });
  });
  req.on('error', reject);
  req.setTimeout(8000, () => req.destroy(new Error('WECHAT_REQUEST_TIMEOUT')));
  req.end(json || undefined);
 });
}

module.exports = { request, sign, notification };
