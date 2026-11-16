# 微信支付部署清单

## ✅ 已完成的配置

### 1. 后端代码

- ✅ **`payment_service.js`** — 微信支付 V3 API 集成
  - 统一下单接口：`POST /v3/pay/transactions/jsapi`
  - 查询订单接口：`GET /v3/pay/transactions/out-trade-no/{outTradeNo}`
  - 申请退款接口：`POST /v3/pay/refunds`
  - 查询退款接口：`GET /v3/pay/refunds/{outRefundNo}`
  - 关闭订单接口：`POST /v3/pay/transactions/out-trade-no/{outTradeNo}/close`

- ✅ **`cloud_base.js`** — 修复 Proxy 导致 SDK 方法丢失的问题
  - 确保 `openapi` 和 `cloudPay` 不被 bind 转换

- ✅ **`pay_config.js`** — 支付配置中心
  - 支持环境变量覆盖
  - 集中管理敏感信息

- ✅ **`mail_controller.js`** — 支付相关端点（已存在）
  - `mail/payment_prepare` — 获取预支付信息
  - `mail/payment_status` — 查询支付状态

- ✅ **`route.js`** — 路由配置（已存在）
  - 支付路由已注册

### 2. 配置文件

已创建文件：
- `cloudfunctions/mcloud/project/crun/config/pay_config.js` — 支付配置
- `cloudfunctions/mcloud/project/crun/config/WECHAT_PAY_GUIDE.md` — 使用指南

## 🔧 需要的配置

### 获取微信支付信息

1. **AppID**（小程序 AppID）
   - 登录：https://mp.weixin.qq.com
   - 找到：小程序后台 → 基本信息 → AppID

2. **商户号（mchid）**
   - 登录：https://pay.weixin.qq.com
   - 找到：账户中心 → 商户信息 → 商户号

3. **APIv3 密钥**
   - 登录：https://pay.weixin.qq.com
   - 路径：账户设置 → API安全 → API v3 密钥 → 创建或查看

4. **AppID 与商户号绑定**
   - 在商户平台确保小程序 AppID 已绑定到商户号

### 填入配置

编辑 `cloudfunctions/mcloud/project/crun/config/pay_config.js`：

```javascript
module.exports = {
  appid: 'wxa19ea5401f038886',           // ← 你的小程序 AppID
  mchid: '1003137035',                    // ← 你的商户号
  key: 'MIIEvgIBADANBgkqhkiG9w0...',    // ← 你的 APIv3 密钥
  notifyUrl: process.env.WECHAT_PAY_NOTIFY_URL || '...',
  callbackFunction: 'mcloud'
};
```

## 🚀 部署步骤

### 1. 更新配置文件

```bash
# 编辑支付配置
# 文件：cloudfunctions/mcloud/project/crun/config/pay_config.js
```

### 2. 上传云函数

在微信开发者工具中：

1. 右键 `cloudfunctions/mcloud` 文件夹
2. 选择 **"上传并部署：云端安装依赖"**
3. 等待上传和部署完成

### 3. 验证部署

```bash
# 在云开发控制台查看日志
# 检查是否有错误信息
```

## 📋 支付流程测试

### 1. 发布订单（选择微信支付）

```javascript
// 小程序中调用
wx.cloud.callFunction({
  name: 'mcloud',
  data: {
    route: 'mail/publish',
    requestId: 'xxxx',
    forms: [...],
    paymentMode: 'wechat'  // 选择微信支付
  }
})
```

### 2. 获取预支付信息

```javascript
wx.cloud.callFunction({
  name: 'mcloud',
  data: {
    route: 'mail/payment_prepare',
    id: '_id_from_publish'  // 来自第 1 步的 _id
  }
})
// 返回：{ payment: { prepayId, timeStamp, nonceStr, package, signType } }
```

### 3. 发起微信支付

```javascript
wx.requestPayment({
  timeStamp: response.payment.timeStamp,
  nonceStr: response.payment.nonceStr,
  package: response.payment.package,
  signType: response.payment.signType,
  paySign: '...',  // 小程序生成签名
  success(res) {
    // 支付成功，检查订单状态
    checkPaymentStatus(mailId);
  }
})
```

### 4. 查询支付状态

```javascript
wx.cloud.callFunction({
  name: 'mcloud',
  data: {
    route: 'mail/payment_status',
    id: '_id_from_publish'
  }
})
// 返回：{ paid: true|false, published: true|false, status: -1|0|1|99 }
```

## 🔍 故障排查

### 问题 1：支付下单返回 "WECHAT_APP_ID not configured"

**原因**：`pay_config.js` 中的 `appid` 为空或不正确

**解决**：
1. 检查是否填入了 AppID
2. 确保 AppID 与商户号已绑定

### 问题 2：支付下单返回 "HTTP 400" 或 "PARAM_ERROR"

**原因**：
- AppID 与商户号不匹配
- APIv3 密钥错误
- 支付参数格式错误

**解决**：
1. 确保 `appid`、`mchid`、`key` 都正确
2. 检查云函数日志中的详细错误信息
3. 查看微信支付文档确认参数格式

### 问题 3：签名错误 (HTTP 401)

**原因**：APIv3 密钥错误或签名算法不匹配

**解决**：
1. 确保 `key` 是 **APIv3 密钥**，不是其他密钥
2. 在商户平台重新复制密钥
3. 检查系统时间是否准确（签名使用时间戳）

### 问题 4：订单查询返回 "ORDERNOTEXIST"

**原因**：
- 商户号与 AppID 不匹配
- 订单号不存在或已过期

**解决**：
1. 检查 AppID 与商户号的绑定关系
2. 确认订单号是否正确
3. 查看微信支付商户平台的订单列表

### 问题 5：微信支付总是失败

**排查步骤**：
1. 查看云函数日志：云开发控制台 → 云函数 → mcloud → 日志
2. 搜索 `[payment]` 关键字查看支付相关日志
3. 检查返回的错误代码（对比微信支付 API 文档）
4. 验证网络连接是否正常

## 📚 相关文档

- 微信支付 V3 API 文档：https://pay.weixin.qq.com/wiki?id=126349
- JSAPI 支付指南：https://pay.weixin.qq.com/docs/merchant/apis/jsapi-payment/direct-jsapi-payment.html
- 本项目配置指南：`WECHAT_PAY_GUIDE.md`

## ✨ 后续优化

- [ ] 添加单元测试（mock HTTPS 请求）
- [ ] 支持沙箱测试环境切换
- [ ] 添加支付重试机制
- [ ] 支持分账功能
- [ ] 支持优惠券/代金券
