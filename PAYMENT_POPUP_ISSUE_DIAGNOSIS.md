# 微信支付弹窗不显示 - 诊断与解决方案

## 问题现象

用户点击"发布"后，微信支付小窗没有弹出

---

## 📍 根本原因分析

### 完整的支付流程链路

```
用户点击"发布"
    ↓ (mail_add_logic.js L865)
系统创建订单 + 查询支付模式
    ↓
if (result.paymentMode === 'wechat') {
    ↓
   调用 payment_biz.js .pay(id)
    ↓
   payment_biz.js 内部流程：
   ├─ (L3) 查询支付状态：mail/payment_status
   ├─ (L5-6) 验证订单状态和发布状态
   ├─ (L7) 获取支付参数：mail/payment_prepare
   ├─ (L8) 调用 wx.requestPayment()  ← 【这里弹出微信支付窗口】
   └─ (L9-17) 处理支付结果
}
```

### 支付小窗不显示的原因

弹窗会**卡在某一个步骤**，主要原因有以下几个：

---

## 🔍 诊断清单

### ❌ 问题 1：`mail/payment_prepare` 接口失败

**症状：** 前端控制台看到错误

**检查方法：**
```javascript
// 在 payment_biz.js 的 L7 处，添加调试：
const result = await Ops.get('mail/payment_prepare', {id});
console.log('payment_prepare 结果:', result);
```

**可能的错误：**

| 错误 | 原因 | 解决 |
|-----|------|------|
| 支付配置不完整 | 后端配置缺失 | ✅ 已验证完整 |
| 订单状态错误 | 订单已发布或已过期 | 检查 MAIL_STATUS 是否为 -1 |
| 用户未登录 | openid 获取失败 | 先完成微信登录 |
| 云函数调用失败 | 网络或权限问题 | 检查网络和云函数权限 |

**验证方法：**
```bash
# 查看控制台错误消息
console.error(error.message)

# 预期返回：
{
  payment: {
    prepayId: "wx123...",
    timeStamp: 1694068800,
    nonceStr: "abc123...",
    package: "prepay_id=wx123...",
    signType: "RSA"
  },
  id: "orderId"
}
```

### ❌ 问题 2：缺少 `signType` 和 `package` 字段

**症状：** wx.requestPayment() 调用时微信返回"签名参数错误"

**根本原因：** 后端 `mail/payment_prepare` 返回的数据不完整

**检查后端代码：** `payment_service.js` L149-156

```javascript
return {
  payment: {
    prepayId: result.prepay_id,      // ✓ 应该有
    timeStamp: Math.floor(Date.now() / 1000),  // ✓ 应该有
    nonceStr: crypto.randomBytes(16).toString('hex'),  // ✓ 应该有
    package: `prepay_id=${result.prepay_id}`,  // ✓ 关键字段
    signType: 'RSA'                  // ✓ 关键字段
  },
  id
};
```

**当前状态：** ✅ 已正确实现

### ❌ 问题 3：wx.requestPayment() 调用失败

**症状：** 前端捕获异常，支付窗口没显示

**检查方法：**
```javascript
// payment_biz.js L8
try {
  await new Promise((resolve, reject) =>
    wx.requestPayment({
      ...result.payment,
      success: resolve,
      fail: reject
    })
  );
} catch(error) {
  console.error('支付调用失败:', error);
  // 错误会被捕获到 L10-13
}
```

**常见错误代码：**

| 错误代码 | 含义 | 解决 |
|---------|------|------|
| `request:fail` | 请求失败 | 检查网络 |
| `invalid_params` | 参数不完整 | 检查 prepayId 是否为空 |
| `cancel` | 用户取消 | 这是正常行为 |
| `system_error` | 微信系统错误 | 重试或稍后支付 |

### ❌ 问题 4：订单已发布或已过期

**症状：** 错误消息 "订单已关闭或状态已变化，请查看订单详情"

**根本原因：** 前端查询到的订单状态不是 -1（待支付）

**检查方法：**
```javascript
// payment_biz.js L5-6
if (previous.status !== -1) {
  throw new Error('订单已关闭或状态已变化，请查看订单详情');
}
```

**可能原因：**
1. 订单已被其他用户接单 (status=1)
2. 订单已过期 (status=99)
3. 数据库中订单状态被修改

### ❌ 问题 5：之前支付已成功，再次点击时报错

**症状：** 错误消息 "订单已关闭" 或 "支付已取消"

**根本原因：** 支付_biz.js 的智能重试逻辑

**代码位置：** payment_biz.js L3-6

```javascript
// 智能判断：如果订单已发布，说明之前支付成功
const previous = await Ops.get('mail/payment_status', {id});
if (previous.published) {
  // ✓ 直接返回已发布状态，不再弹出支付窗口
  return previous;
}
```

**这是正常行为** - 支付成功后不需要再支付

---

## ✅ 排查步骤（按顺序）

### Step 1：确认后端配置
```bash
# 查看配置文件
cat cloudfunctions/mcloud/project/crun/config/pay_config.js

# 检查是否有值：
appid ✓
mchid ✓
key ✓
```

### Step 2：检查前端错误
```javascript
// 在 payment_biz.js 顶部添加日志
async function pay(id) {
  console.log('[Payment] Starting payment for order:', id);
  
  const previous = await Ops.get('mail/payment_status', {id});
  console.log('[Payment] Previous status:', previous);
  
  if (previous.published) return previous;
  if (previous.status !== -1) throw new Error('订单已关闭或状态已变化');
  
  const result = await Ops.get('mail/payment_prepare', {id});
  console.log('[Payment] Prepare result:', result);
  
  // ... 继续
}
```

### Step 3：运行测试
```bash
# 运行支付测试
cd cloudfunctions/mcloud
npm.cmd test -- ../../scripts/tests/wechat-payment.test.js
npm.cmd test -- ../../scripts/tests/payment-publish-flow.test.js
```

### Step 4：本地调试
```
1. 打开微信开发者工具
2. 打开控制台 → Console 标签
3. 发布订单，观察日志
4. 查找错误消息
```

### Step 5：检查网络
```javascript
// payment_biz.js 中，在调用前添加网络检查
const networkType = wx.getSystemInfoSync().networkType;
console.log('[Payment] Network type:', networkType);
if (networkType === 'none') {
  throw new Error('网络未连接，请检查网络状态');
}
```

---

## 🔧 快速诊断脚本

将以下代码添加到 `payment_biz.js` 中，用于快速诊断：

```javascript
const Ops = require('./operations_biz.js');

async function pay(id) {
  console.log('[Payment Debug] === 开始支付流程 ===');
  console.log('[Payment Debug] 订单ID:', id);
  
  // Step 1: 检查网络
  const network = wx.getSystemInfoSync().networkType;
  console.log('[Payment Debug] 网络状态:', network);
  if (network === 'none') throw new Error('网络未连接');
  
  // Step 2: 查询支付状态
  console.log('[Payment Debug] 正在查询支付状态...');
  const previous = await Ops.get('mail/payment_status', {id});
  console.log('[Payment Debug] 支付状态:', previous);
  
  if (previous.published) {
    console.log('[Payment Debug] 订单已发布，无需再次支付');
    return previous;
  }
  
  if (previous.status !== -1) {
    throw new Error(`订单已关闭或状态已变化，当前状态: ${previous.status}`);
  }
  
  // Step 3: 获取支付参数
  console.log('[Payment Debug] 正在准备支付参数...');
  const result = await Ops.get('mail/payment_prepare', {id});
  console.log('[Payment Debug] 支付参数:', result);
  
  if (!result.payment.prepayId) {
    throw new Error('微信支付参数不完整，缺少 prepayId');
  }
  
  // Step 4: 调起微信支付
  console.log('[Payment Debug] 正在调起微信支付窗口...');
  console.log('[Payment Debug] 支付参数详情:', {
    prepayId: result.payment.prepayId,
    timeStamp: result.payment.timeStamp,
    nonceStr: result.payment.nonceStr,
    package: result.payment.package,
    signType: result.payment.signType
  });
  
  try {
    await new Promise((resolve, reject) =>
      wx.requestPayment({
        ...result.payment,
        success(res) {
          console.log('[Payment Debug] 支付成功:', res);
          resolve(res);
        },
        fail(err) {
          console.log('[Payment Debug] 支付失败:', err);
          reject(err);
        }
      })
    );
    console.log('[Payment Debug] 支付窗口已关闭（用户完成支付）');
  } catch(error) {
    console.log('[Payment Debug] 支付异常:', error.message);
    const status = await Ops.get('mail/payment_status', {id});
    console.log('[Payment Debug] 当前订单状态:', status);
    if (status.published) return status;
    throw new Error(
      /cancel/i.test(error.errMsg || '') 
        ? '支付已取消，订单尚未发布，可在订单详情继续支付' 
        : '支付结果待确认，请在订单详情核对'
    );
  }
  
  // Step 5: 验证支付成功
  console.log('[Payment Debug] 正在验证支付结果...');
  const status = await Ops.get('mail/payment_status', {id});
  console.log('[Payment Debug] 最终订单状态:', status);
  
  if (!status.published) {
    throw new Error(
      status.status === 99
        ? '订单已关闭，已付款项将原路退回'
        : '支付结果确认中，请在订单详情刷新核对'
    );
  }
  
  console.log('[Payment Debug] 支付流程完成 ✓');
  return status;
}

module.exports = { pay };
```

---

## 📋 完整检查清单

- [ ] **后端配置**
  - [ ] AppID 已配置
  - [ ] 商户号已配置
  - [ ] APIv3 密钥已配置

- [ ] **前端网络**
  - [ ] 小程序已连接网络
  - [ ] 云函数网络可访问

- [ ] **数据流**
  - [ ] `mail/payment_status` 接口可调用
  - [ ] `mail/payment_prepare` 接口可调用
  - [ ] 接口返回数据完整

- [ ] **微信 API**
  - [ ] `wx.requestPayment()` 支持当前环境
  - [ ] 微信服务器可访问

- [ ] **订单状态**
  - [ ] 订单状态为 -1（待支付）
  - [ ] 订单未过期
  - [ ] 用户有发布权限

- [ ] **错误处理**
  - [ ] 控制台无 JavaScript 错误
  - [ ] 无网络请求失败
  - [ ] 无权限验证失败

---

## 🆘 仍未解决？

### 最常见的 3 个原因：

**1️⃣ 后端支付配置不生效**
```bash
# 检查环境变量是否被应用
echo $WECHAT_APP_ID
echo $WECHAT_PAY_MCH_ID
echo $WECHAT_API_KEY

# 如果为空，需要设置环境变量或更新配置文件
```

**2️⃣ 前端网络请求超时或失败**
```javascript
// 添加网络诊断
wx.getNetworkType({
  success(res) {
    console.log('网络类型:', res.networkType);
  }
});
```

**3️⃣ 微信开发者工具中的调试不是真实的网络请求**
```
→ 改用真实手机在微信中扫码测试
→ 使用真实的微信账号
→ 确保手机已连接网络
```

---

## 📞 需要帮助？

1. 查看 `PAYMENT_QUICK_START.md` 的故障排查章节
2. 运行 `scripts/tests/payment-publish-flow.test.js` 验证后端
3. 使用上面的诊断脚本输出日志

