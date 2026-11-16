'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname,'../../cloudfunctions/mcloud/project/crun');
function load(file, scope) {
 const module = { exports:{} };
 vm.runInNewContext(fs.readFileSync(path.join(root,file),'utf8'),{module,Buffer,URL,...scope});
 return module.exports;
}
const pair = crypto.generateKeyPairSync('rsa',{modulusLength:2048});
const privateKey = pair.privateKey.export({type:'pkcs8',format:'pem'});
const publicKey = pair.publicKey.export({type:'spki',format:'pem'});
const credentials = {
 WECHAT_APP_ID:'wx0123456789abcdef', WECHAT_PAY_MCH_ID:'1234567890', WECHAT_PAY_PRIVATE_KEY:privateKey,
 WECHAT_PAY_CERT_SERIAL:'ABCDEF1234', WECHAT_PAY_PUBLIC_KEY:publicKey, WECHAT_PAY_PUBLIC_KEY_ID:'PUB_KEY_ID_123456',
 WECHAT_PAY_API_V3_KEY:'a'.repeat(32), WECHAT_PAY_NOTIFY_URL:'https://example.test/payment'
};
const config = env => load('config/pay_config.js',{process:{env},require});

test('new payments require the switch and complete configuration',()=>{
 assert.equal(config({}).enabled(),false);
 assert.equal(config(credentials).ready(),true);
 assert.equal(config(credentials).enabled(),false);
 assert.equal(config({...credentials,WECHAT_PAY_ENABLED:'true'}).enabled(),true);
 assert.equal(config({...credentials,WECHAT_PAY_ENABLED:'true',WECHAT_PAY_PRIVATE_KEY:'invalid'}).enabled(),false);
});

test('requested payments with bad fields block offline publishing and report only field names',()=>{
 const logs = [];
 const cfg = config({...credentials,WECHAT_PAY_ENABLED:'true',WECHAT_PAY_CERT_SERIAL:'invalid',WECHAT_PAY_PUBLIC_KEY:'not a public key'});
 const service = load('service/payment_service.js', {
  require:id=>id.includes('pay_config')?cfg:{},
  console:{warn:(message, data)=>logs.push([message, Array.from(data.invalidFields)])}
 });
 assert.equal(service.newOrderMode(),'unavailable');
 assert.equal(service.newOrderMode(),'unavailable');
 assert.deepEqual(logs,[['[payment] invalid config',['WECHAT_PAY_CERT_SERIAL','WECHAT_PAY_PUBLIC_KEY']]]);
});

test('RSA signs checkout and payment notifications require a valid signature and authenticated ciphertext',()=>{
 const cfg=config(credentials);
 const api=load('service/wechat_pay_api.js',{require:id=>id.includes('config')?cfg:require(id)});
 const message='wx-app\n123\nnonce\nprepay_id=test\n';
 assert(crypto.verify('RSA-SHA256',Buffer.from(message),publicKey,Buffer.from(api.sign(message),'base64')));
 const nonce='abcdefghijkl';
 const cipher=crypto.createCipheriv('aes-256-gcm',Buffer.from(cfg.apiV3Key),Buffer.from(nonce));
 cipher.setAAD(Buffer.from('transaction'));
 const encrypted=Buffer.concat([cipher.update('{"trade_state":"SUCCESS"}'),cipher.final(),cipher.getAuthTag()]);
 const body=JSON.stringify({event_type:'TRANSACTION.SUCCESS',resource:{
  algorithm:'AEAD_AES_256_GCM',nonce,associated_data:'transaction',ciphertext:encrypted.toString('base64')
 }});
 const timestamp=String(Math.floor(Date.now()/1000));
 const signature=crypto.sign('RSA-SHA256',Buffer.from([timestamp,nonce,body,''].join('\n')),privateKey).toString('base64');
 const headers={'Wechatpay-Timestamp':timestamp,'Wechatpay-Nonce':nonce,'Wechatpay-Serial':cfg.publicKeyId,'Wechatpay-Signature':signature};
 assert.equal(api.notification({body,headers}).data.trade_state,'SUCCESS');
 assert.throws(()=>api.notification({body:body+' ',headers}),/INVALID_WECHAT_SIGNATURE/);
 assert.throws(()=>api.notification({body,headers:{...headers,'Wechatpay-Serial':'PUB_KEY_ID_9'}}),/INVALID_WECHAT_SIGNATURE/);
});
