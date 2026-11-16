# 微信支付配置指南

## 快速开始

### 1. 配置微信支付参数

编辑 `cloudfunctions/mcloud/project/crun/config/pay_config.js`，填入你的微信支付信息：

```javascript
module.exports = {
  appid: 'wxa19ea5401f038886',        // 小程序 AppID
  mchid: '1003137035',                 // 商户号
  key: 'MIIEvgIBADANBgkqhkiG9w0...',  // APIv3 密钥
  notifyUrl: '...',                    // 回调地址（可选）
  callbackFunction: 'mcloud'           // 回调云函数名
};
```

### 2. 配置说明

| 字段 | 说明 | 获取方式 |
|-----|------|---------|
| `appid` | 小程序 AppID | 微信公众平台 → 小程序后台 → 基本信息 |
| `mchid` | 商户号 | 微信支付商户平台 → 账户中心 → 商户信息 |
| `key` | APIv3 密钥 | 微信支付商户平台 → 账户设置 → API安全 → APIv3密钥 |
| `notifyUrl` | 支付成功回调 | 可选，系统默认处理 |
| `callbackFunction` | 回调云函数 | 默认为 `mcloud` |

### 3. 支付流程

1. **发布订单**（选择微信支付）
   - 小程序调用 `mail/publish` 接口发布订单
   - 订单支付模式为 `'wechat'`，订单状态为 `-1`（待支付）

2. **下单**（获取预支付交易信息）
   - 调用云函数 `mail/payment_prepare` 接口
   - 返回 `prepay_id`、`timeStamp`、`nonceStr`、`package`、`signType`

3. **发起支付**（客户端）
   - 调用 `wx.requestPayment()`，传入上述参数
   - 用户完成微信支付

4. **支付回调**（微信服务器）
   - 微信支付系统回调云函数 `mcloud`
   - 系统验证、记录支付结果
   - 订单状态自动更新为 `0`（已发布）

5. **查询支付状态**
   - 调用 `mail/payment_status` 接口
   - 返回支付状态、订单是否已发布

### 4. 订单状态说明

| 状态码 | 含义 | 支付状态 |
|-------|------|---------|
| `-1` | 待支付 | 未支付 |
| `0` | 已发布 | 已支付 |
| `1` | 已接单 | 已支付 |
| `99` | 已取消 | 已支付时自动退款 |

### 5. 环境变量覆盖

如果需要在不同环境使用不同的配置，可以设置环境变量：

```bash
# 在云函数配置中设置
WECHAT_APP_ID=wx...
WECHAT_PAY_MCH_ID=1234567890
WECHAT_API_KEY=your_key_here
```

### 6. 测试支付

1. 启用支付（确保配置正确）
2. 在小程序中发布一个订单，选择微信支付
3. 点击"去支付"
4. 在微信支付沙箱环境中测试

### 7. 故障排查

- **支付下单失败**：检查 `appid`、`mchid`、`key` 是否正确
- **签名错误**：确保 `key` 是 APIv3 密钥，不是商户私钥
- **交易不存在**：检查商户号是否与 AppID 绑定
- **回调失败**：检查云函数权限和网络连接

## API 端点

### 1. 发布订单

```
POST /mail/publish
Body: {
  serviceType: 'buy',
  endTime: 1234567890,
  ...
}
Response: {
  id: 'MAIL_xxxxx',
  _id: 'xxxxx',
  fee: 10,
  paymentMode: 'wechat'
}
```

### 2. 下单（获取预支付信息）

```
POST /mail/payment_prepare
Body: {
  id: '_id_from_publish'
}
Response: {
  payment: {
    prepayId: 'wx...',
    timeStamp: 1234567890,
    nonceStr: 'xxx',
    package: 'prepay_id=wx...',
    signType: 'RSA'
  }
}
```

### 3. 查询支付状态

```
GET /mail/payment_status?id=_id_from_publish
Response: {
  paid: true|false,
  published: true|false,
  status: -1|0|1|99
}
```

### 4. 支付回调

```
POST /mcloud (自动处理，无需手动调用)
```

