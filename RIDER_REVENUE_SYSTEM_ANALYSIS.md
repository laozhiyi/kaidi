# 骑手收益分配方案分析

## 问题

"现在这个方式能否让骑手获得90%的收益?"

## 当前现状

### 收益分配机制审查结果

经过完整代码审查，**系统当前不支持骑手收益分配功能**：

| 功能 | 状态 | 说明 |
|-----|------|------|
| 微信支付 | ✅ 已实现 | 已修复 paySign 签名 |
| 订单自动发布 | ✅ 已实现 | 支付成功自动发布 |
| **骑手结算系统** | ❌ 未实现 | 无骑手收益分配逻辑 |
| **平台费用扣除** | ❌ 未实现 | 无佣金或手续费机制 |
| **骑手提现** | ❌ 未实现 | 无钱包、余额、提现功能 |

### 现有配置

**文件：** `operation_config_service.js`

系统的配置项中**不包含**任何收益分配相关的参数：

```javascript
const DEFAULTS = {
  // 服务配置
  enabled: true,
  paymentMode: 'offline',      // 支付方式：离线或微信
  
  // 定价配置
  smallPrice: 2,               // 小件价格
  mediumPrice: 4,              // 中件价格
  largePrice: 8,               // 大件价格
  maxPackages: 20,             // 最大包裹数
  
  // 规则配置
  maxActiveOrders: 3,          // 最大活跃订单
  maxOpenOrders: 10,           // 最大待接订单
  deliveryMinutes: 120,        // 配送时效
  urgentMinutes: 60,           // 加急时效
  
  // 时间配置
  openHour: 8,                 // 开放时间
  closeHour: 22,               // 关闭时间
  
  // 其他
  offlineNotice: '...'         // 线下结算说明
  
  // ❌ 缺少：
  // - riderCommissionRate (骑手佣金率)
  // - platformFeeRate (平台费率)
  // - withdrawMinAmount (提现最低额度)
  // - etc.
};
```

### 支付流程中的费用处理

**当前逻辑：**

```
用户支付订单费用 → 费用进入系统 → 订单自动发布
                        ↓
                     ❌ 无后续处理
                     
骑手完成订单 → 订单标记完成 → ❌ 骑手不获得任何收益
```

**预期逻辑（未实现）：**

```
用户支付订单费用（¥10）
        ↓
系统处理收益分配
├─ 平台手续费（10%）= ¥1
└─ 骑手收益（90%）= ¥9
        ↓
骑手余额增加 ¥9
        ↓
骑手可提现或用于后续订单
```

---

## 需要实现的骑手收益系统

### 1. 数据库模型

需要创建以下数据库表：

#### 1.1 骑手钱包表 (rider_wallet)

```javascript
{
  _id: 'rider_wallet_<userId>',
  _pid: 'crun',
  userId: 'openid...',
  
  // 余额信息
  balance: 1000,              // 可用余额（分）
  pendingBalance: 500,        // 待结算金额（分）
  withdrawnTotal: 5000,       // 已提现总额（分）
  
  // 统计
  totalEarnings: 6500,        // 总收入（分）
  totalOrders: 50,            // 完成订单数
  
  // 时间戳
  createdAt: 1694068800000,
  updatedAt: 1694068800000
}
```

#### 1.2 收益记录表 (earnings_log)

```javascript
{
  _id: 'earnings_log_<orderId>',
  _pid: 'crun',
  userId: 'rider_openid',
  orderId: 'mail_id',
  
  // 金额信息
  orderFee: 1000,             // 订单原价（分）
  platformFee: 100,           // 平台费用（分）
  riderEarnings: 900,         // 骑手收入（分）
  
  // 配置
  commissionRate: 0.1,        // 佣金率（10%）
  riderRate: 0.9,             // 骑手分成率（90%）
  
  // 状态
  status: 'completed',        // 已完成、待结算、已提现
  settledAt: 1694068800000,
  
  // 时间戳
  createdAt: 1694068800000
}
```

#### 1.3 提现记录表 (withdrawal_log)

```javascript
{
  _id: 'withdrawal_<userId>_<timestamp>',
  _pid: 'crun',
  userId: 'openid...',
  
  // 提现信息
  amount: 1000,               // 提现金额（分）
  paymentMethod: 'wechat',    // 提现方式
  status: 'completed',        // 待审核、处理中、已完成、已拒绝
  
  // 提现账户
  receiverOpenId: 'openid...',
  
  // 时间戳
  requestedAt: 1694068800000,
  approvedAt: 1694068800000,
  completedAt: 1694068800000
}
```

---

## 需要实现的功能

### 2. 后端业务逻辑

#### 2.1 操作配置 (operation_config_service.js)

添加骑手收益配置：

```javascript
const DEFAULTS = {
  // ... 现有配置 ...
  
  // 【新增】骑手收益配置
  riderCommissionRate: 0.1,     // 平台佣金率（10%）
  riderShareRate: 0.9,          // 骑手分成率（90%）
  withdrawMinAmount: 100,       // 提现最低额度（元）
  withdrawMaxAmount: 10000,     // 提现最高额度（元）
  withdrawFeeRate: 0.02,        // 提现手续费率（2%）
  withdrawDays: 1,              // 提现到账天数
};
```

#### 2.2 订单完成时处理收益

**修改：** `mail_service.js` 的订单完成逻辑

在订单标记为"已完成"时，触发收益分配：

```javascript
async confirmReceipt(userId, id) {
  // ... 现有逻辑 ...
  
  // 【新增】处理骑手收益
  if (mail.MAIL_ACCEPT_USER_ID) {
    const earnings = new RiderEarningsService();
    await earnings.recordEarning({
      orderId: id,
      riderId: mail.MAIL_ACCEPT_USER_ID,
      orderFee: mail.MAIL_TOTAL_FEE,
      commissionRate: config.riderCommissionRate,
      shareRate: config.riderShareRate
    });
  }
}
```

#### 2.3 骑手收益服务

**新文件：** `rider_earnings_service.js`

```javascript
class RiderEarningsService {
  // 记录单笔收益
  async recordEarning(data) {
    const platformFee = Math.round(data.orderFee * data.commissionRate);
    const riderEarnings = data.orderFee - platformFee;
    
    // 创建收益记录
    await store.transaction(async tx => {
      // 1. 写入收益日志
      await store.set(tx, 'earnings_log', data.orderId, {
        userId: data.riderId,
        orderFee: data.orderFee,
        platformFee: platformFee,
        riderEarnings: riderEarnings,
        status: 'completed',
        createdAt: Date.now()
      });
      
      // 2. 更新骑手钱包
      const wallet = await store.get(tx, 'rider_wallet', data.riderId);
      if (wallet) {
        wallet.balance += riderEarnings;
        wallet.totalEarnings += riderEarnings;
      } else {
        wallet = {
          userId: data.riderId,
          balance: riderEarnings,
          totalEarnings: riderEarnings
        };
      }
      await store.set(tx, 'rider_wallet', data.riderId, wallet);
    });
  }
  
  // 骑手申请提现
  async requestWithdrawal(riderId, amount) {
    const wallet = await store.get(store.database(), 'rider_wallet', riderId);
    
    if (!wallet || wallet.balance < amount) {
      throw new Error('余额不足');
    }
    
    // 创建提现记录
    const withdrawal = {
      userId: riderId,
      amount: amount,
      status: 'pending',
      createdAt: Date.now()
    };
    
    await store.transaction(async tx => {
      // 1. 扣除余额
      wallet.balance -= amount;
      await store.set(tx, 'rider_wallet', riderId, wallet);
      
      // 2. 创建提现记录
      await store.set(tx, 'withdrawal', 
        store.key(riderId, Date.now()), withdrawal);
    });
  }
}
```

#### 2.4 骑手钱包控制器

**新文件：** `rider_wallet_controller.js`

```javascript
class RiderWalletController {
  // 获取钱包余额
  async getWallet() {
    const wallet = await new RiderEarningsService()
      .getWallet(this._userId);
    return wallet;
  }
  
  // 申请提现
  async requestWithdrawal() {
    const p = this.validateData({ amount: 'must|int|min:100' });
    return new RiderEarningsService()
      .requestWithdrawal(this._userId, p.amount);
  }
  
  // 获取收益明细
  async getEarnings() {
    const p = this.validateData({ page: 'int|default:1' });
    return new RiderEarningsService()
      .getEarningsList(this._userId, p.page);
  }
}
```

---

## 前端需要实现的页面

### 3. 骑手端界面

#### 3.1 钱包页面 (wallet/index.wxml)

```wxml
<view class="wallet">
  <!-- 余额卡片 -->
  <view class="balance-card">
    <view class="balance-label">可用余额</view>
    <view class="balance-amount">¥{{wallet.balance}}</view>
    <button class="btn-withdraw">提现</button>
  </view>
  
  <!-- 统计信息 -->
  <view class="stats">
    <view class="stat-item">
      <view class="stat-label">总收入</view>
      <view class="stat-value">¥{{wallet.totalEarnings}}</view>
    </view>
    <view class="stat-item">
      <view class="stat-label">完成订单</view>
      <view class="stat-value">{{wallet.totalOrders}}</view>
    </view>
    <view class="stat-item">
      <view class="stat-label">已提现</view>
      <view class="stat-value">¥{{wallet.withdrawnTotal}}</view>
    </view>
  </view>
  
  <!-- 收益明细 -->
  <view class="earnings-list">
    <view class="earnings-header">收益明细</view>
    <view wx:for="{{earnings}}" class="earning-item">
      <view class="earning-info">
        <view class="earning-title">{{item.orderTitle}}</view>
        <view class="earning-time">{{item.completedAt}}</view>
      </view>
      <view class="earning-amount">+¥{{item.riderEarnings}}</view>
    </view>
  </view>
</view>
```

#### 3.2 提现页面 (wallet/withdraw.wxml)

```wxml
<view class="withdraw">
  <!-- 可提现金额 -->
  <view class="withdraw-info">
    <view class="info-item">
      <view class="label">可提现余额</view>
      <view class="value">¥{{wallet.balance}}</view>
    </view>
    <view class="info-item">
      <view class="label">最低提现额</view>
      <view class="value">¥{{minAmount}}</view>
    </view>
  </view>
  
  <!-- 提现金额输入 -->
  <view class="withdraw-form">
    <view class="form-group">
      <view class="label">提现金额</view>
      <input type="number" placeholder="请输入提现金额" 
        value="{{withdrawAmount}}" />
    </view>
    
    <view class="form-group">
      <view class="label">提现方式</view>
      <picker value="{{paymentMethod}}">
        <view>微信支付</view>
      </picker>
    </view>
  </view>
  
  <!-- 提交按钮 -->
  <button class="btn-submit" bindtap="submitWithdraw">
    提现申请
  </button>
</view>
```

---

## 配置建议

### 4. 推荐的收益分配方案

#### 方案 A：固定佣金（10%）

```javascript
{
  riderCommissionRate: 0.10,    // 平台佣金 10%
  riderShareRate: 0.90          // 骑手分成 90%
}

示例：
订单费用：¥10
├─ 平台费用：¥1（10%）
└─ 骑手收益：¥9（90%）
```

**优点：**
- 骑手收益明确
- 平台收入稳定
- 易于理解和宣传

**缺点：**
- 无法根据订单类型调整
- 无法实现差异化定价

#### 方案 B：动态佣金

```javascript
{
  commissionTiers: [
    { min: 0, max: 5, rate: 0.05 },    // ≤¥5，佣金 5%
    { min: 5, max: 10, rate: 0.10 },   // ¥5-10，佣金 10%
    { min: 10, max: 100, rate: 0.15 }  // >¥10，佣金 15%
  ]
}

示例：
订单 ¥3 → 骑手得 ¥2.85（95%）
订单 ¥8 → 骑手得 ¥7.20（90%）
订单 ¥15 → 骑手得 ¥12.75（85%）
```

**优点：**
- 可实现差异化定价
- 激励大额订单
- 灵活调整

**缺点：**
- 配置复杂
- 骑手收益不固定

---

## 实施步骤

### Phase 1：数据库准备（1-2 天）

- [ ] 创建 `rider_wallet` 表
- [ ] 创建 `earnings_log` 表
- [ ] 创建 `withdrawal_log` 表
- [ ] 创建数据库索引

### Phase 2：后端开发（3-5 天）

- [ ] 添加配置项
- [ ] 编写 `RiderEarningsService`
- [ ] 修改订单完成逻辑
- [ ] 编写提现处理逻辑
- [ ] 编写 API 接口

### Phase 3：前端开发（2-3 天）

- [ ] 设计钱包 UI
- [ ] 开发钱包页面
- [ ] 开发提现页面
- [ ] 开发收益明细页面
- [ ] 接入后端 API

### Phase 4：测试（2-3 天）

- [ ] 单元测试
- [ ] 集成测试
- [ ] 灰度测试
- [ ] 全量发布

---

## 当前状态总结

| 功能 | 状态 | 优先级 |
|-----|------|-------|
| 微信支付 | ✅ 已完成 | 已上线 |
| 订单自动发布 | ✅ 已完成 | 已上线 |
| **骑手收益分配** | ❌ 未开始 | **高** |
| **骑手提现系统** | ❌ 未开始 | **高** |
| 骑手钱包 | ❌ 未开始 | **中** |

---

## 建议

### 短期（立即）
1. 部署支付系统（已修复）
2. 确认骑手收益方案（固定或动态佣金）
3. 规划数据库结构

### 中期（本月）
1. 开发骑手收益系统
2. 测试提现流程
3. 灰度发布

### 长期（2-3 月）
1. 优化收益分配算法
2. 添加骑手统计和分析
3. 引入激励机制（完成度、好评率等）

---

**当前答案：** 

❌ **现在不能让骑手获得 90% 的收益**

原因：系统尚未实现骑手收益分配功能

✅ **可以实现：** 按照本文档的设计方案，完整开发骑手收益系统

预计工作量：**10-15 工作日**

