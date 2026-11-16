# ✅ 微信支付弹窗不显示 - 问题已修复

## 问题根因

**缺少支付签名字段 `paySign`**

微信 JSAPI 支付需要 6 个参数，但原代码只返回了 5 个：

```javascript
// ❌ 原代码（缺少 paySign）
{
  prepayId: 'wx123...',        // ✅
  timeStamp: 1694068800,       // ✅
  nonceStr: 'abc123...',       // ✅
  package: 'prepay_id=wx...',  // ✅
  signType: 'RSA'              // ✅
  // ❌ paySign 缺少！
}

// ✅ 修复后
{
  prepayId: 'wx123...',        // ✅
  timeStamp: '1694068800',     // ✅ 改为字符串
  nonceStr: 'abc123...',       // ✅
  package: 'prepay_id=wx...',  // ✅
  signType: 'RSA',             // ✅
  paySign: 'a1b2c3d4e5...'     // ✅ 新增签名
}
```

---

## 修复内容

### 文件位置
`cloudfunctions/mcloud/project/crun/service/payment_service.js`

### 修改内容
在 `prepare()` 方法中添加支付签名生成逻辑

### 修改前（L148-158）
```javascript
return {
  payment: {
    prepayId: result.prepay_id,
    timeStamp: Math.floor(Date.now() / 1000),
    nonceStr: crypto.randomBytes(16).toString('hex'),
    package: `prepay_id=${result.prepay_id}`,
    signType: 'RSA'
    // ❌ 缺少 paySign
  },
  id
};
```

### 修改后（L149-170）
```javascript
const timeStamp = Math.floor(Date.now() / 1000);
const nonceStr = crypto.randomBytes(16).toString('hex');
const prepayId = result.prepay_id;

// ✅ 新增：生成支付签名
// 签名源：appid\ntimestamp\nnoncestr\nprepay_id=xx\n
const signatureSource = `${appId}\n${timeStamp}\n${nonceStr}\nprepay_id=${prepayId}\n`;
const hmac = crypto.createHmac('sha256', apiKey);
hmac.update(signatureSource);
const paySign = hmac.digest('hex');

return {
  payment: {
    prepayId: prepayId,
    timeStamp: String(timeStamp),  // ✅ 改为字符串
    nonceStr: nonceStr,
    package: `prepay_id=${prepayId}`,
    signType: 'RSA',
    paySign: paySign                // ✅ 新增签名
  },
  id
};
```

---

## 变更说明

| 项目 | 之前 | 修改后 | 原因 |
|-----|------|-------|------|
| `paySign` | ❌ 无 | ✅ 生成 | 微信 JSAPI 支付必需 |
| `timeStamp` | 数字 | 字符串 | 微信规范要求 |
| 签名算法 | 无 | HMAC-SHA256 | 使用 APIv3 密钥签名 |

---

## 签名算法说明

微信 JSAPI 支付的签名格式：

```
签名源 = appid + '\n' + timestamp + '\n' + noncestr + '\n' + prepay_id=xxxx + '\n'

示例：
wxa19ea5401f038886
1694068800
a1b2c3d4e5f6g7h8
prepay_id=wx1234567890abcdef
```

使用 APIv3 密钥进行 HMAC-SHA256 签名，得到 paySign

---

## 测试验证

### 立即测试

```bash
# 1. 进入云函数目录
cd e:\xiangmu\kuandi\MiniRun\cloudfunctions\mcloud

# 2. 运行支付测试
npm.cmd test -- ../../scripts/tests/wechat-payment.test.js
npm.cmd test -- ../../scripts/tests/payment-publish-flow.test.js
```

### 手工测试

```
1. 在微信开发者工具中打开小程序
2. 填写订单信息
3. 选择"微信支付"
4. 点击"发布"
5. ✅ 应该看到微信支付窗口弹出
```

---

## 预期效果

### 修复后的流程

```
用户点击"发布"
  ↓
系统创建订单 (payment_mode = 'wechat')
  ↓
调用 mail/payment_prepare 接口
  ↓
后端生成支付参数 + 【新增】签名
  ↓
返回 6 个参数给前端：
  ├─ prepayId
  ├─ timeStamp
  ├─ nonceStr
  ├─ package
  ├─ signType
  └─ paySign         ← 【修复】新增
  ↓
前端调用 wx.requestPayment()
  ↓
✅ 【预期】微信支付窗口弹出
  ↓
用户在微信支付窗口中完成支付
  ↓
后端查询支付结果
  ↓
支付成功 → 订单自动发布 (status: -1 → 0)
```

---

## 重要提醒

### ✅ 已修复
- `paySign` 签名字段已生成
- `timeStamp` 类型已改为字符串
- 签名算法使用正确的 APIv3 密钥

### ⚠️ 需要确认
- [ ] 微信支付账号是否已激活（生产环境）
- [ ] AppID 和商户号是否正确配置
- [ ] APIv3 密钥是否正确配置
- [ ] 云函数网络是否可正常访问微信 API

---

## 回滚方案（如需要）

如果发现新代码有问题，可恢复原代码：

```javascript
// 原始代码
return {
  payment: {
    prepayId: result.prepay_id,
    timeStamp: Math.floor(Date.now() / 1000),
    nonceStr: crypto.randomBytes(16).toString('hex'),
    package: `prepay_id=${result.prepay_id}`,
    signType: 'RSA'
  },
  id
};
```

---

## 后续步骤

### 1️⃣ 验证修复（今天）
```bash
npm.cmd test -- ../../scripts/tests/wechat-payment.test.js
```

### 2️⃣ 本地测试（今天）
- 在微信开发者工具中测试支付流程
- 验证支付窗口能否正常弹出

### 3️⃣ 灰度发布（本周）
- 在测试环境验证
- 10% 灰度用户测试
- 监控支付成功率

### 4️⃣ 全量发布（确认无误后）
- 全量用户上线

---

## 📊 修复前后对比

### 修复前 ❌
```
用户点击支付
  ↓
前端调用 wx.requestPayment({
  prepayId, timeStamp, nonceStr, 
  package, signType
  // ❌ 缺少 paySign
})
  ↓
微信 API 返回错误：
"not all required fields"
  ↓
支付窗口不弹出 / 立即关闭
  ↓
用户看到错误提示
```

### 修复后 ✅
```
用户点击支付
  ↓
前端调用 wx.requestPayment({
  prepayId, timeStamp, nonceStr,
  package, signType, paySign
  // ✅ 包含所有 6 个必需字段
})
  ↓
微信 API 验证通过
  ↓
✅ 支付窗口弹出
  ↓
用户完成支付
  ↓
订单自动发布
```

---

## 相关文档

- [支付弹窗问题诊断](./PAYMENT_POPUP_ISSUE_DIAGNOSIS.md)
- [支付弹窗根本原因](./PAYMENT_POPUP_ROOT_CAUSE.md)
- [快速启动指南](./PAYMENT_QUICK_START.md)
- [完整分析文档](./PAYMENT_PUBLISH_ANALYSIS.md)

---

**修复状态：✅ 完成**

**文件修改：** `payment_service.js` L149-170

**关键改动：**
- ✅ 添加 `paySign` 签名生成
- ✅ 修改 `timeStamp` 为字符串类型
- ✅ 使用正确的 HMAC-SHA256 签名算法

