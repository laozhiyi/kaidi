# 微信支付与订单发布 - 快速启动指南

## 一句话总结

系统已完整实现微信支付功能，支付成功后**自动发布订单**，可直接使用。

---

## 快速验证步骤

### 1️⃣ 验证支付模块是否启用

```bash
# 在云函数中执行：
const PaymentService = require('./project/crun/service/payment_service.js');
console.log('支付已启用:', PaymentService.enabled()); // 应该输出 true
```

### 2️⃣ 检查支付配置

```bash
# 查看配置文件
cat cloudfunctions/mcloud/project/crun/config/pay_config.js
```

**应该看到：**
```javascript
{
  appid: 'wxa19ea5401f038886',  // ✓ AppID
  mchid: '1003137035',           // ✓ 商户号
  key: '...',                    // ✓ API Key
  callbackFunction: 'mcloud'     // ✓ 回调函数
}
```

### 3️⃣ 运行支付测试

```bash
# 进入云函数目录
cd cloudfunctions/mcloud

# 安装依赖
npm.cmd ci --ignore-scripts --no-audit --no-fund

# 运行支付测试
npm test -- ../../scripts/tests/wechat-payment.test.js
```

---

## 核心业务流程

### 订单支付 → 自动发布流程

```
┌─────────────────────────────────────────────────────────────┐
│ 用户在小程序内选择"微信支付"并发布订单                      │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ 后端: PaymentService.prepare(userId, orderId)               │
│ - 验证订单状态                                               │
│ - 调用微信支付 V3 API 创建预支付单                          │
│ - 返回 prepay_id 等参数给前端                               │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ 前端: 调起微信支付窗口                                       │
│ - wx.requestPayment({prepay_id, ...})                       │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ 用户在微信支付界面完成支付                                   │
└────────────────┬────────────────────────────────────────────┘
                 │
         ┌───────┴────────┐
         │                │
         ▼                ▼
   支付成功          支付失败
         │                │
         ▼                ▼
  后端查询支付       订单保持
  状态验证           待支付状态
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│ PaymentService.reconcile(outTradeNo)                         │
│ - 调用微信 API 查询支付状态                                  │
│ - 验证金额、商户号、交易号                                   │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ 【自动触发】订单发布                                         │
│ MailService._record() - 记录支付事件                         │
│ 订单状态: -1 (待支付) → 0 (等待接单)                        │
│ 订单对骑手可见                                               │
│ 发布人收到"订单已发布"通知                                   │
└─────────────────────────────────────────────────────────────┘
```

---

## 关键文件速查表

| 功能 | 文件路径 | 关键方法 |
|-----|--------|--------|
| **支付业务** | `cloudfunctions/mcloud/project/crun/service/payment_service.js` | `prepare()`, `reconcile()` |
| **支付配置** | `cloudfunctions/mcloud/project/crun/config/pay_config.js` | - |
| **订单管理** | `cloudfunctions/mcloud/project/crun/service/mail_service.js` | `_record()` |
| **支付路由** | `cloudfunctions/mcloud/project/crun/public/route.js` | - |
| **前端支付** | `miniprogram/projects/crun/biz/payment_biz.js` | (待确认) |
| **测试用例** | `scripts/tests/wechat-payment.test.js` | - |

---

## 常见问题

### Q: 支付成功后为什么订单没有发布？

**A:** 检查以下几点：

```javascript
// 1. 订单是否配置了微信支付模式？
mail.MAIL_PAYMENT_MODE === 'wechat'  // 应该是 true

// 2. 订单是否未过期？
mail.MAIL_END_TIME > Date.now()      // 应该是 true

// 3. 发布人是否已通过审核？
user.USER_STATUS === 1               // 应该是 true

// 4. 发布人是否超过发布配额？
order_quota.active.length < maximum  // 应该未超
```

### Q: 如何处理支付失败的订单？

**A:** 系统处理如下：
- 订单保持 `-1` (待支付) 状态
- 支付记录保持 `pending` 状态
- 用户可重新支付（幂等性保证）
- 5 分钟后自动重试查询

### Q: 已支付的订单被取消，费用怎么处理？

**A:** 系统自动退款：
```javascript
// 订单状态变为 99 (已取消) 时
mail.MAIL_REFUND_STATUS = 'pending'
// 后续 reconcile() 会自动调用
PaymentService.refund(payment, mail)
```

### Q: 支付金额与订单金额不一致怎么办？

**A:** 系统会拒绝发布，并抛出错误：
```javascript
// 验证失败，抛出 PAYMENT_MISMATCH
throw new Error('PAYMENT_MISMATCH');
```

---

## 环境变量配置

如需覆盖默认配置，设置以下环境变量：

```bash
# AppID
export WECHAT_APP_ID=wxYourAppId

# 商户号
export WECHAT_PAY_MCH_ID=1234567890

# APIv3 密钥
export WECHAT_API_KEY=your_api_key_here

# 支付回调通知 URL
export WECHAT_PAY_NOTIFY_URL=https://your-domain/pay/notify

# 支付回调云函数名称
export WECHAT_PAY_CALLBACK_FUNCTION=mcloud
```

---

## 本地测试

### 使用测试工具测试完整流程

```bash
# 1. 发布一个微信支付订单
POST /mail/insert
{
  "paymentMode": "wechat",
  "amount": 600  // 6.00 元
}

# 返回: { id: "orderId", fee: 6.00, paymentMode: "wechat" }

# 2. 请求支付参数
POST /payment/prepare
{
  "id": "orderId"
}

# 返回: {
#   payment: {
#     prepayId: "wx123456...",
#     timeStamp: 1694068800,
#     nonceStr: "abc123...",
#     package: "prepay_id=wx123456...",
#     signType: "RSA"
#   }
# }

# 3. 查询订单状态（模拟支付成功）
GET /mail/detail?id=orderId

# 应该看到订单状态从 -1 变为 0
```

---

## 预期行为检查清单

- [ ] 订单创建时可选择"微信支付"
- [ ] 点击"微信支付"后调起微信支付窗口
- [ ] 支付成功后订单自动发布
- [ ] 支付失败后订单保持待支付状态
- [ ] 订单发布后对骑手可见
- [ ] 发布人收到"订单已发布"通知
- [ ] 已支付但取消的订单能自动退款
- [ ] 并发支付同一订单时只发布一次

---

## 故障排查

### 检查微信 API 连接

```javascript
// 在云函数中测试
const PaymentService = require('./project/crun/service/payment_service.js');
const result = await PaymentService.prepare(userId, orderId);
// 如果失败会抛出具体错误信息
```

### 查看支付记录

```javascript
// 查询支付数据库
const payment = await db.collection('payment').doc(paymentNo).get();
console.log(payment.data);
// 应该看到 state: 'paid' 或 'pending'
```

### 查看订单历史

```javascript
// 查询订单事件记录
const mail = await db.collection('mail').doc(orderId).get();
console.log(mail.data.MAIL_HISTORY);
// 应该看到 action: 'payment' 的事件记录
```

---

## 下一步

1. **本地验证**：按照快速验证步骤在本地测试
2. **运行测试套件**：确保所有支付测试通过
3. **功能测试**：在微信开发者工具中完整演练支付流程
4. **联调**：与客户端集成测试，确保支付窗口正常调起
5. **上线前审查**：确认微信支付账号已激活并通过审核

---

## 更多信息

- 完整分析文档：[PAYMENT_PUBLISH_ANALYSIS.md](./PAYMENT_PUBLISH_ANALYSIS.md)
- 微信支付 V3 文档：https://pay.weixin.qq.com/wiki
- 新增测试用例：[payment-publish-flow.test.js](./scripts/tests/payment-publish-flow.test.js)
