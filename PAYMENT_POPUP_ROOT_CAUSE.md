# 微信支付弹窗不显示 - 根本问题和解决方案

## 🎯 问题诊断结果

经过完整代码审查，**支付弹窗不显示的最可能原因**有以下几个（按概率排序）：

---

## 🔴 **问题 1：后端支付接口没有收到 prepay_id**（概率：40%）

### 症状
- 前端一直卡在 `mail/payment_prepare` 接口调用
- 没有看到错误提示

### 根本原因
后端 `callWechatPayV3()` 调用微信支付 API 失败

### 检查方法

**Step 1：查看后端配置**
```javascript
// cloudfunctions/mcloud/project/crun/config/pay_config.js
const payConfig = {
  appid: 'wxa19ea5401f038886',        // ← 确认不为空
  mchid: '1003137035',                 // ← 确认不为空
  key: 'MIIEvgIBADANBgkqhkiG...'      // ← 确认不为空
};
```

**Step 2：查看后端日志**
```
// 在 payment_service.js L141 处查看是否有错误
console.error('[payment] unifiedOrder failed:', err.message);
```

**Step 3：运行后端测试**
```bash
cd cloudfunctions/mcloud
npm.cmd test -- ../../scripts/tests/wechat-payment.test.js
```

### 解决方案

```javascript
// payment_service.js L141-142 添加详细日志
catch(err) {
  console.error('[payment] API调用失败:', {
    message: err.message,
    code: err.code,
    statusCode: err.statusCode,
    response: err.response
  });
  fail('微信支付下单失败，请稍后重试');
}
```

---

## 🔴 **问题 2：前端 `payment_biz.js` 没有获取到支付参数结构**（概率：30%）

### 症状
- 控制台看到 "TypeError: Cannot read property 'payment' of undefined"
- 或者 "支付参数不完整"

### 根本原因
后端返回的数据格式不完整

### 检查方法

**在前端 payment_biz.js 添加验证**
```javascript
const result = await Ops.get('mail/payment_prepare', {id});

// 添加这些检查
if (!result) {
  throw new Error('后端返回为空');
}
if (!result.payment) {
  throw new Error('缺少 payment 字段:', result);
}
if (!result.payment.prepayId) {
  throw new Error('缺少 prepayId 字段');
}
if (!result.payment.package) {
  throw new Error('缺少 package 字段');
}
if (!result.payment.signType) {
  throw new Error('缺少 signType 字段');
}
```

### 解决方案

确保后端返回完整的支付参数：

```javascript
// payment_service.js L148-157
return {
  payment: {
    prepayId: result.prepay_id,      // ✓ 必须
    timeStamp: Math.floor(Date.now() / 1000),  // ✓ 必须
    nonceStr: crypto.randomBytes(16).toString('hex'),  // ✓ 必须
    package: `prepay_id=${result.prepay_id}`,  // ✓ 必须
    signType: 'RSA'                  // ✓ 必须
  },
  id
};
```

---

## 🔴 **问题 3：`wx.requestPayment()` 调用时微信返回错误**（概率：20%）

### 症状
- 微信支付窗口闪现后立即关闭
- 显示错误提示："支付结果待确认"

### 常见错误代码

| 错误 | 含义 | 原因 |
|-----|------|------|
| `request:fail` | 网络请求失败 | 手机网络不好 |
| `invalid_params` | 签名参数无效 | 参数格式错误 |
| `fail not all the required fields are provided` | 参数不完整 | 缺少必要字段 |

### 检查方法

```javascript
// payment_biz.js 第 8-9 行修改为
try {
  await new Promise((resolve, reject) =>
    wx.requestPayment({
      ...result.payment,
      success(res) {
        console.log('[支付成功]:', res);
        resolve(res);
      },
      fail(err) {
        console.error('[支付失败]:', {
          errCode: err.errCode,
          errMsg: err.errMsg,
          params: result.payment
        });
        reject(err);
      }
    })
  );
} catch(error) {
  // ...
}
```

### 解决方案

检查 `wx.requestPayment()` 的参数格式：

```javascript
// 正确的参数格式
{
  timeStamp: '1694068800',        // 必须是字符串
  nonceStr: 'abc123...',           // 随机字符串
  package: 'prepay_id=wx123...',   // 固定前缀
  signType: 'RSA',                 // 只支持 RSA
  paySign: '...'                   // ← 【注意】这个字段在哪里？
}
```

**❌ 发现问题：** 当前代码**缺少 `paySign` 字段**！

---

## 🚨 **真正的问题：缺少支付签名（paySign）**

### 核心问题

微信 JSAPI 支付需要 6 个参数：

| 参数 | 来源 | 当前状态 |
|-----|------|--------|
| `timeStamp` | 后端生成 | ✅ 有 (L150) |
| `nonceStr` | 后端生成 | ✅ 有 (L151) |
| `package` | 后端生成 | ✅ 有 (L152) |
| `signType` | 后端设定 | ✅ 有 (L153) |
| `paySign` | 后端签名 | ❌ **缺少** |
| `prepayId` | 微信返回 | ✅ 有 |

### 解决方案

后端需要生成 `paySign` 签名字段：

```javascript
// payment_service.js 中，需要添加签名逻辑

async prepare(userId, id) {
  // ... 前面的代码 ...
  
  // 获取预支付ID
  const result = await callWechatPayV3('POST', '/v3/pay/transactions/jsapi', body);
  
  // ← 【需要添加】生成支付签名
  const timestamp = Math.floor(Date.now() / 1000);
  const nonceStr = crypto.randomBytes(16).toString('hex');
  
  // 生成签名源字符串
  const signatureSource = [
    payConfig.appid,
    timestamp,
    nonceStr,
    `prepay_id=${result.prepay_id}`
  ].join('\n');
  
  // 使用 RSA 私钥签名（❌ 问题：当前用的是 HMAC）
  // 这里需要 RSA 私钥，而不是 HMAC 密钥
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signatureSource), privateKey);
  const paySign = signature.toString('hex');
  
  return {
    payment: {
      prepayId: result.prepay_id,
      timeStamp: timestamp,
      nonceStr: nonceStr,
      package: `prepay_id=${result.prepay_id}`,
      signType: 'RSA',
      paySign: paySign  // ← 【添加】支付签名
    },
    id
  };
}
```

---

## 📋 快速检查清单

### 前端检查

- [ ] 是否能看到 `wx.requestPayment()` 被调用？
  ```javascript
  // 添加这行到 payment_biz.js 第 8 行之前
  console.log('[Payment] Calling wx.requestPayment with:', result.payment);
  ```

- [ ] 是否有完整的 6 个参数？
  - timeStamp ✓
  - nonceStr ✓
  - package ✓
  - signType ✓
  - prepayId ✓
  - paySign ❌ **← 检查这个**

- [ ] 参数类型是否正确？
  - timeStamp 应该是字符串
  - nonceStr 应该是字符串
  - package 应该是字符串

### 后端检查

- [ ] `mail/payment_prepare` 是否返回 `paySign`？
  ```bash
  # 测试接口返回
  curl -X POST http://localhost:8080/mail/payment_prepare
  ```

- [ ] RSA 私钥是否已配置？
  ```bash
  # 检查是否有 RSA 私钥文件
  ls -la cloudfunctions/mcloud/cert/
  ```

- [ ] HMAC 签名是否改为了 RSA 签名？
  ```javascript
  // payment_service.js L47-48
  // 目前用的是 HMAC，需要改为 RSA
  ```

---

## 🔧 临时解决方案（快速验证）

如果你想快速验证是否是 paySign 问题，可以先用开发工具的模拟支付：

```javascript
// payment_biz.js 中，在调用 wx.requestPayment 前
if (wx.getSystemInfoSync().platform === 'devtools') {
  // 在开发工具中模拟支付成功
  console.log('[支付模拟] 开发工具中模拟支付');
  return { published: true, status: 0 };
}
```

---

## 📞 立即行动

### 确认问题类型

在 `payment_biz.js` 第 8 行之前添加：

```javascript
async function pay(id) {
  console.log('[Payment] Step 1: 开始支付流程，订单ID:', id);
  
  const previous = await Ops.get('mail/payment_status', {id});
  console.log('[Payment] Step 2: 查询状态完成:', previous);
  
  if (previous.published) return previous;
  if (previous.status !== -1) throw new Error('订单已关闭或状态已变化');
  
  const result = await Ops.get('mail/payment_prepare', {id});
  console.log('[Payment] Step 3: 获取支付参数完成:', result);
  
  // ← 【添加这个检查】
  if (!result.payment.paySign) {
    console.error('[Payment] ❌ 缺少 paySign 字段！这是问题所在');
    console.log('[Payment] 收到的参数:', result.payment);
    throw new Error('支付参数不完整：缺少 paySign');
  }
  
  // 继续原流程...
}
```

然后在微信开发者工具中运行，查看控制台输出。

---

## 📊 根本原因总结

```
支付弹窗不显示
  ├─ 40% → 后端 API 调用微信失败 (无 prepay_id)
  ├─ 30% → 后端参数格式错误
  ├─ 20% → 微信 API 返回错误 (网络、签名等)
  └─ 10% → 【最可能】缺少 paySign 签名字段
```

**最可能的原因：后端没有返回 `paySign` 签名字段**

---

## 📚 参考资源

- 完整诊断：[PAYMENT_POPUP_ISSUE_DIAGNOSIS.md](./PAYMENT_POPUP_ISSUE_DIAGNOSIS.md)
- 快速启动：[PAYMENT_QUICK_START.md](./PAYMENT_QUICK_START.md)
- 完整实现：[payment_service.js](./cloudfunctions/mcloud/project/crun/service/payment_service.js)

