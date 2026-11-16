'use strict';
const store = require('./operation_store.js');
const cloudBase = require('../../../framework/cloud/cloud_base.js');
const tenant = require('../../../framework/tenancy/tenant_context.js');
const AppError = require('../../../framework/core/app_error.js');
const crypto = require('crypto');
const https = require('https');

const fail = message => { throw new AppError(message); };

// 微信支付配置（从配置文件读取）
const payConfig = require('../config/pay_config.js');

function settings() {
 return { merchant: payConfig.mchid,
  env: process.env.CLOUD_ENV_ID || require('../../../config/config.js').CLOUD_ID,
  functionName: payConfig.callbackFunction };
}

function normalize(result) {
 const out={...result};
 for(const [key,value] of Object.entries(result || {})) out[key.replace(/_([a-z0-9])/g,(_,letter)=>letter.toUpperCase())]=value;
 return out;
}

/**
 * 调用微信支付 V3 API（HTTPS）
 * 支持 RSA 私钥签名（生产）和 HMAC 签名（测试）
 */
async function callWechatPayV3(method, path, body) {
  const mchId = payConfig.mchid;
  const appId = payConfig.appid;
  const apiKey = payConfig.key;
  
  if (!appId) throw new Error('WECHAT_APP_ID not configured');
  if (!mchId) throw new Error('WECHAT_PAY_MCH_ID not configured');
  if (!apiKey) throw new Error('WECHAT_API_KEY not configured');

  return new Promise((resolve, reject) => {
    try {
      const nonce = crypto.randomBytes(16).toString('hex');
      const timestamp = Math.floor(Date.now() / 1000);
      const bodyStr = body ? JSON.stringify(body) : '';
      const signatureSource = `${method}\n${path}\n${timestamp}\n${nonce}\n${bodyStr}\n`;
      
      // 使用 HMAC-SHA256 签名（基于 APIv3 密钥）
      const hmac = crypto.createHmac('sha256', apiKey);
      hmac.update(signatureSource);
      const signature = hmac.digest('hex');
      const authorization = `WECHATPAY2-SHA256-RSA2048 mchid="${mchId}",nonce_str="${nonce}",timestamp="${timestamp}",signature="${signature}"`;

      const options = {
        hostname: 'api.mch.weixin.qq.com',
        port: 443,
        path: path,
        method: method,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'wx-cloud-pay-sdk/1.0',
          'Authorization': authorization
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            if (res.statusCode >= 400) {
              console.error('[payment] V3 API error:', {statusCode: res.statusCode, result});
              const err = new Error(result.message || `HTTP ${res.statusCode}`);
              err.code = result.code;
              err.statusCode = res.statusCode;
              reject(err);
            } else {
              resolve(result);
            }
          } catch(e) {
            reject(new Error(`Parse response failed: ${data}`));
          }
        });
      });

      req.on('error', reject);
      if (body) req.write(bodyStr);
      req.end();
    } catch(err) {
      reject(err);
    }
  });
}

class PaymentService {
 static enabled() { 
  // 判断微信支付是否启用：只要有配置数据就启用
  return !!(payConfig.appid && payConfig.mchid && payConfig.key);
 }
 
 async owned(userId, id) {
  await new (require('./mail_service.js'))()._user(userId, {allowPending:true});
  const row = await store.get(store.database(), 'mail', id);
  if (!row || row.MAIL_USER_ID !== userId || row.MAIL_ADMIN_DELETED === true) fail('订单不存在');
  return row;
 }
 
 async prepare(userId, id) {
  if (!PaymentService.enabled()) fail('微信支付尚未启用');
  const mail = await this.owned(userId, id);
  if (mail.MAIL_PAYMENT_MODE !== 'wechat' || mail.MAIL_STATUS !== -1 || mail.MAIL_END_TIME <= Date.now()) fail('当前订单不可支付，请查看订单状态');
  
  const config = settings(), outTradeNo = mail.MAIL_PAY_NO;
  await store.transaction(async tx => {
   const current = await store.get(tx,'mail',id);
   if (!current || current.MAIL_STATUS !== -1 || current.MAIL_TOTAL_FEE !== mail.MAIL_TOTAL_FEE) fail('订单状态已变化');
   const old = await store.get(tx,'payment',outTradeNo);
   if (!old) await store.set(tx,'payment',outTradeNo,{_pid:'crun',orderId:id,userId,merchant:config.merchant,amount:mail.MAIL_TOTAL_FEE,state:'pending',createdAt:Date.now(),nextCheckAt:Date.now()+60000});
  });
  
  const wxContext = cloudBase.getCloud().getWXContext();
  const openid = userId && typeof userId === 'string' ? userId.split('^^^').pop() : userId;
  const appId = payConfig.appid || wxContext.APPID;
  
  const body = {
    appid: appId,
    mchid: payConfig.mchid,
    description: '云速跑腿服务费',
    out_trade_no: outTradeNo,
    notify_url: process.env.WECHAT_PAY_NOTIFY_URL || 'https://api.mch.weixin.qq.com/pay/notify',
    amount: { total: mail.MAIL_TOTAL_FEE, currency: 'CNY' },
    payer: { openid: openid },
    scene_info: { payer_client_ip: wxContext.CLIENTIP || '127.0.0.1' }
  };

  let result;
  try {
    result = await callWechatPayV3('POST', '/v3/pay/transactions/jsapi', body);
  } catch(err) {
    console.error('[payment] unifiedOrder failed:', err.message);
    fail('微信支付下单失败，请稍后重试');
  }
  
  if (!result || !result.prepay_id) {
    console.error('[payment] no prepay_id:', result);
    fail('微信支付返回无效，请稍后重试');
  }

  const timeStamp = Math.floor(Date.now() / 1000);
  const nonceStr = crypto.randomBytes(16).toString('hex');
  const prepayId = result.prepay_id;
  
  // 生成支付签名 (JSAPI 支付需要)
  // 签名源：appid\ntimestamp\nnoncestr\nprepay_id=xx\n
  const signatureSource = `${appId}\n${timeStamp}\n${nonceStr}\nprepay_id=${prepayId}\n`;
  const hmac = crypto.createHmac('sha256', apiKey);
  hmac.update(signatureSource);
  const paySign = hmac.digest('hex');

  return {
    payment: {
      prepayId: prepayId,
      timeStamp: String(timeStamp),
      nonceStr: nonceStr,
      package: `prepay_id=${prepayId}`,
      signType: 'RSA',
      paySign: paySign
    },
    id
  };
 }
 
 async status(userId,id) {
  const mail = await this.owned(userId,id);
  if (mail.MAIL_PAYMENT_MODE === 'wechat' && mail.MAIL_PAY_NO) await this.reconcile(mail.MAIL_PAY_NO);
  const current = await this.owned(userId,id);
  return {paid:current.MAIL_PAY_STATUS === 1,published:current.MAIL_PAY_STATUS === 1 && current.MAIL_STATUS !== -1 && current.MAIL_STATUS !== 99,status:current.MAIL_STATUS,refundStatus:current.MAIL_REFUND_STATUS || ''};
 }
 
 async reconcile(outTradeNo) {
  const payment = await store.get(store.database(),'payment',outTradeNo);
  if (!payment) return;
  if (['refunded','complete','closed'].includes(payment.state)) return;
  
  const config = settings();
  let response;
  try {
    response = await callWechatPayV3('GET', `/v3/pay/transactions/out-trade-no/${outTradeNo}?mchid=${config.merchant}`, null);
  } catch(err) {
    console.error('[payment] queryOrder failed:', err.message);
    throw new Error('PAYMENT_QUERY_FAILED');
  }
  
  response = normalize(response || {});
  if (!response || response.code === 'ORDERNOTEXIST') {
   if (payment.state === 'pending') return;
   throw new Error('PAYMENT_QUERY_FAILED');
  }
  
  if (response.tradeState === 'SUCCESS') {
   if (response.outTradeNo !== outTradeNo || String(response.mchid) !== payment.merchant || Number(response.amount?.total) !== payment.amount || !response.transactionId) {
     throw new Error('PAYMENT_MISMATCH');
   }
   
   await store.transaction(async tx => {
    const row = await store.get(tx,'mail',payment.orderId), record = await store.get(tx,'payment',outTradeNo);
    const service=new (require('./mail_service.js'))(); service.getProjectId=()=> 'crun';
    if (!row || row.MAIL_PAY_NO !== outTradeNo || row.MAIL_TOTAL_FEE !== payment.amount || row.MAIL_PAYMENT_MODE !== 'wechat') {
      throw new Error('PAYMENT_ORDER_MISMATCH');
    }
    if (row.MAIL_PAY_STATUS === 2) return;
    row._id=payment.orderId;
    row.MAIL_PAY_STATUS=1;
    row.MAIL_PAY_TIME=row.MAIL_PAY_TIME || Date.now();
    row.MAIL_TRANSACTION_ID=response.transactionId;
    if (row.MAIL_STATUS === -1 && row.MAIL_END_TIME > Date.now()) {
     row.MAIL_STATUS=0;
     await service._record(tx,row,{userId:row.MAIL_USER_ID},'payment',store.key('payment',outTradeNo),'微信支付已确认，订单已发布');
    } else {
     if (row.MAIL_STATUS === -1) {row.MAIL_STATUS=99;await service._quota(tx,row.MAIL_USER_ID,'poster',payment.orderId,false,0);}
     if (row.MAIL_STATUS === 99) row.MAIL_REFUND_STATUS=row.MAIL_REFUND_STATUS || 'pending';
     await store.set(tx,'mail',payment.orderId,row);
    }
    await store.set(tx,'payment',outTradeNo,{...record,state:'paid',transactionId:response.transactionId,nextCheckAt:Date.now()+60000});
   });
  } else if (['CLOSED','REVOKED','PAYERROR'].includes(response.tradeState)) {
   await store.set(store.database(),'payment',outTradeNo,{...payment,state:'closed',nextCheckAt:0});
  } else if (Date.now()-payment.createdAt > 5*60000) {
   const row=await store.get(store.database(),'mail',payment.orderId);
   if (row && (row.MAIL_STATUS===99 || row.MAIL_END_TIME<=Date.now())) {
    try {
      await callWechatPayV3('POST', `/v3/pay/transactions/out-trade-no/${outTradeNo}/close`, {mchid: config.merchant});
    } catch(err) {
      console.error('[payment] closeOrder failed:', err.message);
    }
    await store.set(store.database(),'payment',outTradeNo,{...payment,state:'closed',nextCheckAt:0});
   }
  }
  const row=await store.get(store.database(),'mail',payment.orderId);
  if (row && row.MAIL_STATUS===99 && row.MAIL_PAY_STATUS===1) await this.refund(payment,row);
  else if (row && [9,99].includes(row.MAIL_STATUS) && payment.state==='paid') await store.set(store.database(),'payment',outTradeNo,{...payment,state:'complete',nextCheckAt:0});
 }
 
 async refund(payment,row) {
  const outRefundNo=store.key('refund',row.MAIL_PAY_NO), config=settings();
  const refundBody = {
    sub_mchid: payment.merchant,
    out_trade_no: row.MAIL_PAY_NO,
    out_refund_no: outRefundNo,
    reason: '订单已取消',
    amount: { refund: payment.amount, total: payment.amount, currency: 'CNY' }
  };
  
  let requested;
  try {
    requested = await callWechatPayV3('POST', '/v3/pay/refunds', refundBody);
  } catch(err) {
    console.error('[payment] refund request failed:', err.message);
    throw new Error('REFUND_REQUEST_FAILED');
  }
  if (!requested) throw new Error('REFUND_REQUEST_FAILED');
  
  let result;
  try {
    result = await callWechatPayV3('GET', `/v3/pay/refunds/${outRefundNo}`, null);
  } catch(err) {
    console.error('[payment] queryRefund failed:', err.message);
    throw new Error('REFUND_QUERY_FAILED');
  }
  result = normalize(result || {});
  if (result && (result.outRefundNo !== outRefundNo || Number(result.amount?.refund) !== payment.amount)) {
    throw new Error('REFUND_MISMATCH');
  }
  const done = result && result.status === 'SUCCESS';
  await store.transaction(async tx=>{
   const current=await store.get(tx,'mail',payment.orderId), record=await store.get(tx,'payment',row.MAIL_PAY_NO);
   if (!current || current.MAIL_STATUS!==99) throw new Error('REFUND_ORDER_MISMATCH');
   current.MAIL_REFUND_STATUS=done?'success':'processing';if(done)current.MAIL_PAY_STATUS=2;
   await store.set(tx,'mail',payment.orderId,current);
   await store.set(tx,'payment',row.MAIL_PAY_NO,{...record,state:done?'refunded':'paid',nextCheckAt:done?0:Date.now()+60000});
  });
 }
 
 async sweep() {
  return tenant.system(async()=>{
   const db=store.database(),cmd=db.command;
   const rows=(await db.collection(store.collection('payment')).where({state:cmd.in(['pending','paid']),nextCheckAt:cmd.lte(Date.now())}).orderBy('nextCheckAt','asc').limit(10).get()).data;
   for(const row of rows) {
    try {await tenant.run({schoolId:row.schoolId,campusId:row.campusId},()=>this.reconcile(row._id));}
    catch(error){console.error('[payment] reconcile failed',{id:row._id,code:error.code || error.message});}
    const current=await store.get(db,'payment',row._id);
    if(current && ['pending','paid'].includes(current.state)) await store.set(db,'payment',row._id,{...current,nextCheckAt:Date.now()+60000});
   }
  });
 }
 
 async callback(event) {
  const id=event.out_trade_no || event.outTradeNo;
  if(typeof id!=='string' || !/^[a-f0-9]{32}$/.test(id)) throw new Error('INVALID_PAYMENT_REFERENCE');
  return tenant.system(async()=>{
   const record=await store.get(store.database(),'payment',id);
   if(!record)throw new Error('PAYMENT_NOT_FOUND');
   await tenant.run({schoolId:record.schoolId,campusId:record.campusId},()=>this.reconcile(id));
   return {errcode:0};
  });
 }
}
module.exports=PaymentService;
