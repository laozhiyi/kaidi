# 管理后台页面结构

后台按业务模块组织，采用独立的小程序页面路由。工作台汇总待办；订单、投诉、用户分别进入列表和详情；营业、价格、履约规则分别维护。底部五个主入口为 **工作台 / 订单 / 投诉 / 用户 / 管理**。

## 核心页面

下列路径均相对于 `miniprogram/projects/crun/pages/admin/`，每条路由均有独立的 JS、JSON、WXML、WXSS 文件。

| 页面 | 路径 | 功能 |
| --- | --- | --- |
| 运营工作台 | `index/home/admin_home` | 今日订单、进行中订单、用户数量、异常/投诉/超时待办、常用入口 |
| 订单列表（新增） | `orders/list/admin_order_list` | 关键词、状态、校区、超时条件组合筛选，排序，分页，导出入口 |
| 订单详情（新增） | `orders/detail/admin_order_detail` | 取送信息、参与人、配送凭证、履约时间线、人工介入与异常处理 |
| 投诉列表（新增） | `feedback/list/admin_feedback_list` | 搜索、状态筛选、分页 |
| 反馈详情（新增） | `feedback/detail/admin_feedback_detail` | 关联订单、问题与凭证、历史回复、处理结论 |
| 用户列表 | `user/list/admin_user_list` | 搜索、账号状态筛选、分页、用户导出入口 |
| 用户详情 | `user/detail/admin_user_detail` | 资料审核、不通过理由、停用与恢复 |
| 管理中心（新增） | `settings/index/admin_settings` | 业务设置、内容客服、数据系统、账号权限的统一入口 |
| 服务设置（新增） | `settings/service/admin_service_settings` | 接单开关、公示营业时间、服务校区 |
| 价格设置（新增） | `settings/pricing/admin_pricing_settings` | 参考价格、包裹数量上限、线下结算说明 |
| 履约规则（新增） | `settings/rules/admin_rules_settings` | 发布/接单数量、配送时效、加急与注册审核 |
| 数据统计（新增） | `analytics/admin_analytics` | 订单状态分布、完成率与运营待办 |
| 系统维护（新增） | `monitor/admin_monitor` | 通知失败和超时统计、过期订单及通知维护 |
| 订单报表 | `mail/export/admin_mail_export` | 按日期与状态生成、打开、复制链接及删除 Excel 报表 |
| 用户报表 | `user/export/admin_user_export` | 按用户列表的查询条件导出 Excel 报表 |

公告、校区客服配置、客服会话、管理员账号、操作日志等沿用已有的独立页面，在管理中心提供入口。上述页面以及关于与联系、小程序码、修改密码、公告编辑器现已统一使用蓝灰色卡片、标题、筛选和表单样式。旧 `operations/admin_operations` 页面只负责兼容旧链接，按参数跳转到对应新页面。

## 窄屏布局与用户详情

- 工作台统计和常用功能保持两列，网格列允许收缩；图标与标题横向排列，360px 以下缩小间距。统计页使用汇总卡片、状态分布条和待办卡片；系统维护按任务说明、操作按钮和执行结果分区。
- 表单标签与输入区上下排列，列表随页面滚动，操作区可换行。单行文本框、数字框统一去掉纵向内边距，由原生输入控件居中显示文字，数字与单位使用居中对齐的弹性布局。
- 工作台和管理中心的数据统计入口使用已有的 `icon-rank` 图标。首页内嵌发单组件独立引入图标字体样式，恢复宣传语右侧图标。
- 用户详情优先按数据库文档 ID 查询，同时兼容 OpenID 和旧 `USER_ID` 链接；审核、停用和恢复均更新解析后的同一条记录，保留项目隔离与历史资料。
- 管理员会话过期时，云请求在跳转登录页后返回明确的鉴权错误，让读取和提交流程结束，并保留未提交的处理说明。

## 页面行为与权限

- 主导航使用 `redirectTo` 切换；详情使用 `navigateTo`。处理详情后返回，列表保留筛选条件、已加载页数与滚动位置，并更新受影响的数据。
- 读取失败、空列表、详情不存在、提交中均有对应状态。切页后忽略过时的请求响应；提交中的重复点击不会再次发出处理请求。
- 普通管理员可以处理订单、反馈与用户资料。业务配置和手动维护需要超级管理员权限；服务端再次校验权限。
- 设置按分组提交，服务端在事务内合并，避免不同设置页面覆盖彼此的修改。未保存的输入有离开提醒和恢复操作。
- 公示营业时间用于展示；服务是否接单由明确的服务开关决定，保留原有业务规则。
- Excel 报表每次最多 5,000 条，按项目和管理员分别保存，进入页面不会自动删除旧报表；导出包含结束日期当天，文字单元格防止被解释成公式。

共享逻辑位于 `biz/admin_console_biz.js`、`biz/admin_settings_biz.js`、`biz/admin_export_biz.js`，主导航位于 `cmpts/admin_nav/`，统一样式位于 `style/admin_console.wxss`（均相对于 `miniprogram/projects/crun/`）。

## 验证与预览

在项目根目录运行：

```powershell
node --test scripts/tests/*.test.js
node scripts/check-miniprogram-pages.cjs --wcc '<微信开发者工具内的 wcc.exe>' --wcsc '<微信开发者工具内的 wcsc.exe>'
node scripts/build-admin-layout-preview.cjs --output="$PWD/.tmp/admin-layout-preview.html"
```

`scripts/build-admin-preview.cjs` 从实际的页面 JS、WXML、WXSS 构建 15 个核心页面的本地交互预览。可通过 `WCC_PATH` 指定 WXML 编译器，通过 `--output=<绝对路径>` 指定输出文件。预览的数据适配器在 `scripts/preview/` 中，与小程序代码隔离；所有处理、电话、剪贴板和报表操作均为本地示例，不会访问线上服务。

`scripts/build-admin-layout-preview.cjs` 覆盖 36 个后台页面状态，可选择 320 / 360 / 375 / 414px 宽度，检查工作台两列布局、横向溢出和输入框与单位对齐。生成文件为 `.tmp/admin-layout-preview.html`，可手动在浏览器打开；浏览器预览不能替代微信 iOS / Android 原生输入框的真机检查。

`scripts/tests/admin-user-request-flow.test.js` 将注册登录、用户列表、详情读取和状态更新串联，使用实际请求封装、路由、控制器、校验和项目模型。微信传输与数据库 I/O 使用本地样例，覆盖三种用户标识、跨项目访问隔离以及管理员会话过期后的请求结束与草稿保留。

本次同时修改了 `cloudfunctions/mcloud` 的查询、配置和报表服务。上线需要重新部署该云函数，并重新编译/发布小程序。自动化服务测试使用模拟的数据库/SDK；实际云环境的鉴权、文件访问和 Excel 生成仍需部署后联调。

## 本地验收记录（2026-09-14）

| 检查项 | 结果 |
| --- | --- |
| 自动化回归 | 218 项通过，0 项失败；日志见 `.tmp/admin-regression-tests.log` |
| 页面、组件、导入与静态路由 | 64 个页面、117 个 WXML 模板通过 |
| WXML 渲染冒烟检查 | 87 个页面状态通过 |
| 微信编译器 | 118 个 WXML 源文件、132 个 WXSS 源文件通过 |
| 后台及首页发单图标引用 | 检查 102 个源文件，未发现引用了不存在的静态图标类名 |
| 窄屏预览文件 | 36 个页面状态已生成，可选 4 种手机宽度 |

浏览器截图和 144 个宽度组合的布局检查尚未执行：当前浏览器 URL 安全策略阻止打开本地 `file://` 预览文件。微信真机上的原生输入框对齐也需人工确认。用户详情可用性已由用户在上一任务中确认。
