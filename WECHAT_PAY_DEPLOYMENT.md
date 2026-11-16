# 微信支付与跑腿报酬部署

适用于云速取商户收跑腿费、完单后通过微信支付「商家转账」支付劳务报酬。接单人领取订单跑腿费的 90%，以分为单位向下取整。云速取承担微信支付手续费。代买的商品款继续按既有流程另行结算。

## 商户平台和云开发

1. 核对 JSAPI 支付已绑定云速取 AppID，并核对商家转账已获批「佣金报酬」场景（1005）。转账使用用户确认收款模式。
2. 在云开发为发起转账的 `mcloud` 启用固定公网出口 IP，把实际出口 IP 加到商户平台「商家转账」的 API 安全 IP 白名单。确认转账资金账户有足够可用余额和额度。
3. 为 `mcloud` 配置专用 HTTPS HTTP 网关路径，保留 POST 原始请求体和微信支付请求头。把完整地址设为支付通知地址。转账结果通过云端查单和订单维护定时器更新。
4. 创建或确认 `bx_payment` 集合。应用 [仅服务端访问规则](deployment/database-rules/server-only.json)，按 [索引清单](deployment/database-indexes.json) 创建 `payment_due`。确认订单维护触发器实际调用到已更新的函数。

## mcloud 环境变量

| Key | Value |
| --- | --- |
| `WECHAT_APP_ID` | 云速取小程序 AppID |
| `WECHAT_PAY_MCH_ID` | 已绑定的商户号 |
| `WECHAT_PAY_PRIVATE_KEY` | 商户 API 证书对应的私钥 PEM |
| `WECHAT_PAY_CERT_SERIAL` | 商户 API 证书序列号 |
| `WECHAT_PAY_PUBLIC_KEY` | 微信支付公钥 PEM |
| `WECHAT_PAY_PUBLIC_KEY_ID` | 该微信支付公钥 ID |
| `WECHAT_PAY_API_V3_KEY` | 32 字节 APIv3 密钥，用于解密通知 |
| `WECHAT_PAY_NOTIFY_URL` | 上述 HTTPS 通知地址 |
| `WECHAT_PAY_ENABLED` | 默认为关闭。只在目标测试环境验证时设为 `true` |

PEM 支持原始换行和字面 `\n`。凭据仅放在云端配置。如果 Git 中历史默认值为真实凭据，先轮换。此接入采用微信支付公钥模式。

## 验收与回退

- 部署 `mcloud`，重新编译并生成体验版。用两台真机验证付款确认后发布、取消或无人接单原路退款、完单可领、确认收款后到账，以及重复点击和退出后重试。
- 在商户后台核对原交易、退款和转账单。转账返回结果不明时按原商户单号查询。查询确认失败或关闭后，才允许重新创建转账单。
- 遇到线上问题时先关闭 `WECHAT_PAY_ENABLED` 停止创建新的微信支付订单，保留有效凭据和定时任务，用于已有订单的支付确认、退款和报酬领取。
