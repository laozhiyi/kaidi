# 系统架构总览

## 微信支付系统架构图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          WeChat Mini Program (小程序)                    │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  用户界面                                                         │   │
│  │  ┌─────────────────────────────────────────────────────────┐    │   │
│  │  │ 发布订单页面                                             │    │   │
│  │  │ • 填写寄件信息                                          │    │   │
│  │  │ • 选择支付方式（微信支付 / 离线支付）                 │    │   │
│  │  │ • 确认费用                                             │    │   │
│  │  └────────────────────────┬────────────────────────────────┘    │   │
│  │                            │                                     │   │
│  │                            ▼                                     │   │
│  │  ┌─────────────────────────────────────────────────────────┐    │   │
│  │  │ 订单详情页面                                             │    │   │
│  │  │ ┌──────────────────────────────────────────────────┐   │    │   │
│  │  │ │ 支付按钮 (仅当 MAIL_PAYMENT_MODE='wechat')       │   │    │   │
│  │  │ │ 点击 → 调用 payment/prepare → 起调微信支付窗口  │   │    │   │
│  │  │ └──────────────────────────────────────────────────┘   │    │   │
│  │  │ • 订单状态显示                                         │    │   │
│  │  │ • 骑手接单信息                                         │    │   │
│  │  └────────────────────────┬────────────────────────────────┘    │   │
│  │                            │                                     │   │
│  │                    ┌───────┴───────┐                             │   │
│  │                    │               │                             │   │
│  │                    ▼               ▼                             │   │
│  │            ┌─────────────┐  ┌──────────────┐                    │   │
│  │            │ 支付场景 1:   │  │  支付场景 2:  │                    │   │
│  │            │ 直接支付    │  │  扫码支付    │                    │   │
│  │            │ (JSAPI)     │  │  (Native)    │                    │   │
│  │            └─────┬───────┘  └──────┬───────┘                    │   │
│  │                  │                 │                             │   │
│  └──────────────────┼─────────────────┼─────────────────────────────┘   │
│                     │                 │                                  │
│                     │ (1) 提交支付参数  │ (1) 获取支付二维码             │
│                     │                 │                                  │
│  ┌──────────────────▼─────────────────▼──────────────────────────────┐  │
│  │                    WeChat Payment Service                        │  │
│  │  • 用户调起微信支付窗口                                           │  │
│  │  • 输入密码、指纹或面容验证                                      │  │
│  │  • 完成支付                                                      │  │
│  │  ┌───────────────────────────────────────────────────────┐      │  │
│  │  │ (2) 支付结果返回给小程序                              │      │  │
│  │  └──────────────────┬──────────────────────────────────────┘      │  │
│  │                     │                                             │  │
│  │                     ▼                                             │  │
│  │            ┌────────────────┐                                     │  │
│  │            │ 支付回调处理    │                                     │  │
│  │            │ • 更新界面      │                                     │  │
│  │            │ • 显示成功/失败  │                                     │  │
│  │            └────────────────┘                                     │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                    │                                      │
│                                    │ (3) 查询订单状态/监听通知           │
│                                    │                                      │
└────────────────────────────────────┼──────────────────────────────────────┘
                                     │
                 ┌───────────────────▼───────────────────┐
                 │                                       │
                 ▼                                       ▼
        ┌─────────────────────┐              ┌──────────────────────┐
        │  WeChat Pay API     │              │  Cloud Functions     │
        │  (api.mch.weixin... │              │  (mcloud)            │
        │   qq.com)           │              │                      │
        │                     │              │  ┌────────────────┐  │
        │  • 创建预支付单     │              │  │ 路由处理       │  │
        │  • 查询订单        │              │  │ • payment/..   │  │
        │  • 申请退款        │              │  └────────────────┘  │
        │  • 查询退款        │              │                      │
        └─────────────────────┘              │  ┌────────────────┐  │
                 │                           │  │ 业务逻辑       │  │
                 │ (4) 数据交互              │  │ • payment_    │  │
                 │                           │  │   service.js  │  │
                 │ 使用 HMAC-SHA256 签名    │  │ • mail_       │  │
                 │ 验证请求合法性            │  │   service.js  │  │
                 │                           │  │ • order_      │  │
                 └───────────────────────────┤  │   rules.js    │  │
                                             │  └────────────────┘  │
                                             │                      │
                                             │  ┌────────────────┐  │
                                             │  │ 数据库操作     │  │
                                             │  │ • 创建/更新    │  │
                                             │  │   payment 记录 │  │
                                             │  │ • 更新 mail    │  │
                                             │  │   状态 (-1→0)  │  │
                                             │  │ • 记录订单事件 │  │
                                             │  │ • 发送通知     │  │
                                             │  └────────────────┘  │
                                             │                      │
                                             └──────────────────────┘
                                                     │
                                             ┌───────▼────────┐
                                             │                │
                                             ▼                ▼
                                    ┌──────────────┐  ┌──────────────┐
                                    │ 数据库表     │  │ 通知系统     │
                                    │              │  │              │
                                    │ • payment    │  │ • 发布人通知 │
                                    │ • mail       │  │ • 骑手通知   │
                                    │ • order_     │  │ • 管理员告警 │
                                    │   event      │  │              │
                                    │ • order_     │  └──────────────┘
                                    │   quota      │
                                    │ • notifi-    │
                                    │   cation     │
                                    └──────────────┘
```

---

## 支付流程时序图

```
小程序          云函数           微信支付API       数据库
   │               │                │              │
   │ (1)点击支付   │                │              │
   ├──────────────>│                │              │
   │  payment/     │ (2)验证订单    │              │
   │  prepare      ├─────────────────────────────>│
   │               │ MAIL_STATUS=-1?              │
   │               │ MAIL_END_TIME > now?         │
   │               │<─────────────────────────────┤
   │               │                              │
   │               │ (3)创建支付记录             │
   │               ├─────────────────────────────>│
   │               │ INSERT payment (state=pending)
   │               │<─────────────────────────────┤
   │               │                              │
   │               │ (4)调起微信支付             │
   │               ├──────────────────────────────>│
   │               │ POST /v3/pay/transactions/jsapi
   │  (5)返回      │ {appid, mchid, amount, ...}│
   │  prepayId     │<──────────────────────────────┤
   │<──────────────┤ {prepay_id: "wx123..."}     │
   │               │                              │
   │ (6)调起微信    │                              │
   │ 支付窗口       │                              │
   ├───────────────────────────────────────────────>│
   │ wx.requestPayment({prepayId, ...})           │
   │               │                              │
   │ (7)用户操作    │                              │
   │ • 选择支付方式 │                              │
   │ • 输入密码     │                              │
   │ • 验证指纹/面容│                              │
   │               │                              │
   │ (8)支付成功    │                              │
   │ (或失败/取消)  │                              │
   │<───────────────────────────────────────────────┤
   │               │                              │
   │ (9)查询订单状态│                              │
   ├──────────────>│ (10)reconcile()             │
   │  mail/detail  ├──────────────────────────────>│
   │               │ GET /v3/pay/transactions/   │
   │               │     out-trade-no/{id}      │
   │               │<──────────────────────────────┤
   │               │ {tradeState: "SUCCESS",    │
   │               │  amount: {...}}            │
   │               │                              │
   │               │ (11)验证支付信息           │
   │               │ • outTradeNo 匹配?         │
   │               │ • amount 匹配?             │
   │               │ • mchid 匹配?              │
   │               │                              │
   │               │ (12)事务处理                │
   │               ├─────────────────────────────>│
   │               │ BEGIN TRANSACTION          │
   │               │ • UPDATE mail SET          │
   │               │   MAIL_STATUS = 0,         │
   │               │   MAIL_PAY_STATUS = 1,     │
   │               │   MAIL_TRANSACTION_ID = ..│
   │               │ • UPDATE payment SET       │
   │               │   state = 'paid'           │
   │               │ • INSERT order_event {...} │
   │               │ • INSERT notification {...}│
   │               │ COMMIT                     │
   │               │<─────────────────────────────┤
   │               │                              │
   │  (13)订单已   │                              │
   │  发布，可    │                              │
   │  显示成功    │                              │
   │<──────────────┤                              │
   │  {            │                              │
   │   status: 0,  │                              │
   │   published: true,                           │
   │   paid: true  │                              │
   │  }            │                              │
   │               │                              │
```

---

## 关键数据结构

### PaymentService 类

```
PaymentService
├── enabled()
│   └─ 检查是否启用微信支付
│      返回: boolean
│
├── prepare(userId, orderId)
│   └─ 准备支付
│      入参: userId (发布人ID), orderId (订单ID)
│      出参: { payment: {...}, id: orderId }
│      调用链: prepare → callWechatPayV3 (POST /v3/pay/transactions/jsapi)
│
├── status(userId, orderId)
│   └─ 获取订单支付状态
│      返回: { paid, published, status, refundStatus }
│
├── reconcile(outTradeNo)
│   └─ 查询并同步支付状态
│      核心逻辑:
│      1. 调用 callWechatPayV3 (GET)
│      2. 验证金额/商户号/交易号
│      3. 事务更新 mail + payment
│      4. 触发订单发布 (MAIL_STATUS: -1 → 0)
│
├── refund(payment, mailRow)
│   └─ 处理退款
│      触发条件: 订单取消且已支付
│      调用: callWechatPayV3 (POST /v3/pay/refunds)
│
├── sweep()
│   └─ 后台任务：扫描待确认的支付并对账
│      运行间隔: 由云函数调度器决定
│
└── callback(event)
    └─ 处理微信服务器回调通知
       入参: { out_trade_no, ... }
       调用: reconcile()
```

### 数据库表结构

#### payment 表
```javascript
{
  _id: 'a'.repeat(32),           // 商户订单号 (支付号)
  orderId: 'mail_id',            // 关联订单ID
  userId: 'openid',              // 发布人openid
  merchant: '1003137035',        // 商户号
  amount: 600,                   // 金额(分): 6.00元
  state: 'pending|paid|refunded|complete|closed',
  transactionId: 'wx123...',     // 微信交易号
  createdAt: 1694068800000,
  nextCheckAt: 1694068860000,    // 下次检查时间
  MAIL_PAY_NO: 'a'.repeat(32)    // (与_id相同)
}
```

#### mail 表 (支付相关字段)
```javascript
{
  _id: 'mail_id',
  MAIL_USER_ID: 'poster_openid',
  MAIL_PAYMENT_MODE: 'wechat|offline',
  MAIL_PAY_NO: 'a'.repeat(32),           // 支付号
  MAIL_TOTAL_FEE: 600,                   // 金额(分): 6.00元
  MAIL_PAY_STATUS: 0|1|2,                // 0=未支付, 1=已支付, 2=已退款
  MAIL_TRANSACTION_ID: 'wx123...',       // 微信交易号
  MAIL_PAY_TIME: 1694068800000,
  MAIL_STATUS: -1|0|1|2|3|4|9|99,        // -1=待支付, 0=待接单, 99=已取消
  MAIL_END_TIME: 1694068800000,          // 订单超时时间
  MAIL_REFUND_STATUS: 'pending|processing|success|failed'
}
```

#### order_event 表
```javascript
{
  _id: 'mail_id_version',
  orderId: 'mail_id',
  action: 'payment',               // 支付事件
  status: 0,                       // 订单状态
  at: 1694068800000,              // 时间戳
  actor: 'poster',                 // 操作者
  note: '微信支付已确认，订单已发布',
  proof: null,                     // 凭证
  exception: null,                 // 异常信息
  actorId: 'openid'               // 操作者ID
}
```

---

## 支付状态转换图

```
              创建订单
                 │
                 ▼
        MAIL_STATUS: -1
        MAIL_PAY_STATUS: 0
        (待支付/编辑中)
          │           │
          │           └─ 支付失败或未支付
          │               │
          │               ▼ (用户可重新支付)
          │           (保持 -1 状态)
          │
          │ [支付成功 + 未过期]
          ▼
    payment.state: 'paid'
    MAIL_PAY_STATUS: 1
    MAIL_TRANSACTION_ID: 'wx123...'
          │
          ▼
    【自动发布】
    MAIL_STATUS: 0
    (等待接单)
          │
    ┌─────┴──────────────────┐
    │                         │
    ▼ (正常流程)              ▼ (异常流程)
骑手接单                   订单已过期
    │                         │
    ▼                         │
MAIL_STATUS: 1           MAIL_STATUS: 99
    │                    (已取消)
    ▼                         │
已取件                        ▼
    │                   MAIL_REFUND_STATUS: 'pending'
    ▼                         │
MAIL_STATUS: 4           (自动触发退款)
    │                         │
    ▼                         ▼
已送达                   payment.state: 'refunded'
    │                    MAIL_PAY_STATUS: 2
    ▼
MAIL_STATUS: 2
    │
    ▼
发布人确认收货
    │
    ▼
MAIL_STATUS: 9
(已完成)

[异常处理]
MAIL_STATUS: 3 ─────> (异常处理中) ─────> 9 或 99
```

---

## 错误处理流程

```
发起支付
   │
   ├─ 订单验证失败
   │  └─ MAIL_PAYMENT_MODE != 'wechat'
   │  └─ MAIL_STATUS != -1
   │  └─ MAIL_END_TIME <= now
   │  └─ 返回: AppError('当前订单不可支付，请查看订单状态')
   │
   ├─ 微信 API 调用失败
   │  └─ 网络错误
   │  └─ 签名验证失败
   │  └─ 返回: AppError('微信支付下单失败，请稍后重试')
   │
   ├─ 支付查询失败
   │  └─ 金额不匹配
   │     └─ 返回: Error('PAYMENT_MISMATCH')
   │  └─ 商户号不匹配
   │     └─ 返回: Error('PAYMENT_MISMATCH')
   │  └─ 交易号为空
   │     └─ 返回: Error('PAYMENT_MISMATCH')
   │  └─ 订单已取消
   │     └─ 自动触发退款
   │
   └─ 订单已过期但支付成功
      └─ 返回: Error('PAYMENT_ORDER_MISMATCH')
         (订单状态强制转为 99，标记待退款)
```

---

## 并发安全性保证

```
并发场景1: 同时发起多次支付查询
   reconcile(paymentNo)
   reconcile(paymentNo)  ← 并发调用
   
   保障机制:
   ├─ 事务锁
   │  └─ 每次 reconcile 使用 store.transaction()
   │     确保原子操作
   │
   ├─ 状态检查
   │  └─ if (payment.state === 'paid') return
   │     幂等性保证，重复查询无害
   │
   └─ 结果: ✓ 订单仅发布一次


并发场景2: 同时发起支付和取消
   prepare(userId, orderId)
   cancelMail(userId, orderId)  ← 并发调用
   
   保障机制:
   ├─ 事务内验证
   │  └─ 事务内重新查询 MAIL_STATUS
   │     确认未被并发修改
   │
   ├─ 乐观锁
   │  └─ 比较 MAIL_VERSION
   │
   └─ 结果: ✓ 至多一个操作成功


并发场景3: 多用户发布/接单
   publish(poster1)
   publish(poster2)
   acceptMail(rider, order1)     ← 不同用户的操作
   
   保障机制:
   ├─ 配额限制
   │  └─ order_quota 表记录活跃订单
   │     enforce maximum active orders per user
   │
   └─ 结果: ✓ 各用户配额独立管理
```

---

## 监控和日志

### 关键日志点

```javascript
// 支付 API 调用
console.log('[payment] callWechatPayV3', { method, path, statusCode });

// 支付查询失败
console.error('[payment] queryOrder failed:', { id, error.message });

// 支付不匹配
console.error('[payment] PAYMENT_MISMATCH', { 
  expected: { outTradeNo, merchant, amount },
  actual: response 
});

// 退款失败
console.error('[payment] refund request failed:', error.message);

// 订单过期但支付成功
console.error('[payment] PAYMENT_ORDER_MISMATCH', { orderId, paymentNo });
```

### 监控指标

```
Payment Metrics:
├─ payment.prepare.calls (速率: 每分钟次数)
├─ payment.prepare.errors (速率: 每分钟次数)
├─ payment.prepare.latency (直方图: ms)
│
├─ payment.reconcile.calls (速率)
├─ payment.reconcile.success (速率: 支付成功)
├─ payment.reconcile.mismatch (速率: 验证失败)
├─ payment.reconcile.latency (直方图: ms)
│
└─ payment.refund.success (速率: 退款成功)
   payment.refund.failure (速率: 退款失败)
   payment.refund.latency (直方图: ms)

Order Metrics:
├─ order.auto_publish (速率: 由支付触发的发布)
├─ order.auto_publish.delay (直方图: ms)
├─ order.cancellation_with_refund (速率)
└─ order.refund_success_rate (百分比)
```

