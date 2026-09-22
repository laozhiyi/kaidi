## 功能介绍 
![image](https://github.com/dearancelan/MiniRun/assets/89879893/9fca151d-259d-4f2c-aa93-a033585d3090)

  校园跑腿小程序: 在帮助学生和教职员工解决日常生活中的琐事，提供便利、快捷的服务.解决学生和教职员工日常生活中的燃眉之急，促进了校园内的互助和共享文化，提升了校园生活的便利性和舒适度。 

- 公告资讯：提供校园内的新闻、通知、课程表等信息，让用户及时了解校园动态。 
- 任务发布：用户在首页填写快递代取需求，包括校区、驿站、取件信息、送达地址和时间。
- 任务接单： 其他用户（跑腿者）可以浏览并接受发布的任务，承接后负责完成任务，并与发布者协商具体细节。 
- 订单管理：订单中心统一展示可接单、我的接单、我的发布和已完成订单，并提供收藏、评价和申诉入口。
![image](https://github.com/dearancelan/MiniRun/assets/89879893/db5de849-e992-491b-9b03-53bc6c31238e)


## 技术 运用
- 本项目使用微信小程序平台进行开发。
- 使用腾讯专门的小程序云开发技术，云资源包含云函数，数据库，带宽，存储空间，定时器等，资源配额价格低廉，无需域名和服务器即可搭建。
- 小程序本身的即用即走，适合小工具的使用场景，也适合快速开发迭代。
- 云开发提供托管运行环境；仍需正确配置权限、备份、告警与容量，详见 [稳定性上线说明](RELIABILITY.md)。
- 资源承载力可根据业务发展需要随时弹性扩展。  



## 演示 
 ![image](https://github.com/dearancelan/MiniRun/assets/89879893/06ca55a2-adf4-483b-8937-94ce12bee794)


## 安装

- 安装手册见源码包里的word文档 



## 项目结构

项目基于**微信小程序云开发**，分为 `miniprogram`（小程序端）和 `cloudfunctions`（云端）两大部分。

```
MiniRun/
├── cloudfunctions/               # 云开发云函数
│   └── mcloud/
│       ├── index.js             # 云函数入口
│       ├── framework/            # 框架核心
│       │   ├── core/             # 核心（Router路由等）
│       │   ├── database/         # 数据库封装
│       │   ├── validate/         # 数据校验
│       │   └── utils/            # 工具函数
│       └── project/crun/         # 跑腿项目云端代码
│           ├── controller/       # 控制器
│           ├── service/         # 业务逻辑层
│           ├── model/            # 数据模型
│           ├── public/          # 公共配置/路由
│           └── service/admin/    # 后台管理服务
│
├── miniprogram/                  # 小程序前端
│   ├── app.js / app.json / app.wxss   # 全局配置
│   ├── projects/crun/           # 跑腿项目前端代码
│   │   ├── images/              # 图片资源
│   │   ├── pages/               # 页面文件
│   │   └── style/              # 项目级样式
│   ├── cmpts/                    # 公共组件
│   ├── style/                   # 全局公共样式
│   ├── tpls/                    # 公共模板
│   ├── setting/                # 设置相关
│   └── lib/                    # 第三方库
└── project.config.json          # 小程序项目配置
```

### 页面对应关系

以下列出主要页面，完整注册清单见 `miniprogram/app.json`。当前底部导航为首页、订单、我的；公告和消息中心从首页、个人中心进入。`scripts/check-miniprogram-pages.cjs` 检查整个小程序目录中的 Page 注册、页面文件和静态导航，避免未注册的旧页面被遗漏。

#### TabBar 页面（底部导航）

| 页面名称 | 路径 | 功能说明 |
|---|---|---|
| 首页 | `projects/crun/pages/default/index/default_index` | 首页入口，展示banner、快捷入口 |
| 订单 | `projects/crun/pages/order/index/order_index` | 可接单、我的接单、我的发布、已完成 |
| 我的 | `projects/crun/pages/my/index/my_index` | 个人中心主页 |

#### 首页相关

| 页面名称 | 路径 | 功能说明 |
|---|---|---|
| 首页 | `projects/crun/pages/default/index/default_index` | 首页 |
| 关于我们 | `projects/crun/pages/about/index/about_index` | 关于页面 |
| 全局搜索 | `projects/crun/pages/search/search` | 搜索页 |

#### 用户端 — 公告与消息

| 页面名称 | 路径 | 功能说明 |
|---|---|---|
| 公告列表 | `projects/crun/pages/news/index/news_index` | 公告列表、重要标记与已读状态 |
| 公告详情 | `projects/crun/pages/news/detail/news_detail` | 阅读公告，成功展示后记录已读 |
| 消息中心 | `projects/crun/pages/operations/operations` | 公告、订单和处理通知，未读筛选及详情直达 |

#### 用户端 — 快递 (mail)

| 页面名称 | 路径 | 功能说明 |
|---|---|---|
| 发布快递 | `projects/crun/pages/mail/add/mail_add` | 填写并发布快递代取订单 |
| 编辑快递 | `projects/crun/pages/mail/edit/mail_edit` | 编辑快递任务 |
| 接单详情 | `projects/crun/pages/mail/detail/mail_detail` | 浏览并接单 |
| 我的订单详情 | `projects/crun/pages/mail/my_detail/mail_my_detail` | 管理自己发布或接取的订单 |
| 订单中心 | `projects/crun/pages/order/index/order_index` | 可接单、我的接单、我的发布、已完成 |

#### 用户端 — 个人中心 (my)

| 页面名称 | 路径 | 功能说明 |
|---|---|---|
| 我的主页 | `projects/crun/pages/my/index/my_index` | 个人中心 |
| 用户注册 | `projects/crun/pages/my/reg/my_reg` | 用户注册 |
| 个人信息 | `projects/crun/pages/my/personal/my_personal` | 查看或修改个人信息 |
| 常用联系人 | `projects/crun/pages/my/contact/contact` | 管理常用联系人 |
| 常用地址 | `projects/crun/pages/my/address/address` | 管理常用地址 |
| 我的收藏 | `projects/crun/pages/my/fav/my_fav` | 收藏列表 |
| 我的评价 | `projects/crun/pages/my/review/my_review` | 发出与收到的评价 |
| 我的信誉分 | `projects/crun/pages/my/reputation/my_reputation` | 信誉分构成与计分记录 |

#### 管理端 — 首页/登录

| 页面名称 | 路径 | 功能说明 |
|---|---|---|
| 后台登录 | `projects/crun/pages/admin/index/login/admin_login` | 管理员登录 |
| 后台首页 | `projects/crun/pages/admin/index/home/admin_home` | 后台仪表盘/数据概览 |
| 内容管理 | `projects/crun/pages/admin/content/admin_content` | 内容管理主页 |

#### 管理端 — 公告管理 (news)

| 页面名称 | 路径 | 功能说明 |
|---|---|---|
| 公告列表 | `projects/crun/pages/admin/news/list/admin_news_list` | 公告列表管理 |
| 添加公告 | `projects/crun/pages/admin/news/add/admin_news_add` | 新增公告 |
| 编辑公告 | `projects/crun/pages/admin/news/edit/admin_news_edit` | 编辑公告 |

#### 管理端 — 订单管理

| 页面名称 | 路径 | 功能说明 |
|---|---|---|
| 订单列表 | `projects/crun/pages/admin/orders/list/admin_order_list` | 订单查询与筛选 |
| 订单详情 | `projects/crun/pages/admin/orders/detail/admin_order_detail` | 订单过程与人工介入 |
| 快递导出 | `projects/crun/pages/admin/mail/export/admin_mail_export` | 导出快递数据 |

#### 管理端 — 反馈处理

| 页面名称 | 路径 | 功能说明 |
|---|---|---|
| 反馈列表 | `projects/crun/pages/admin/feedback/list/admin_feedback_list` | 反馈和申诉筛选 |
| 反馈详情 | `projects/crun/pages/admin/feedback/detail/admin_feedback_detail` | 回复、处理和评分 |

#### 管理端 — 用户管理

| 页面名称 | 路径 | 功能说明 |
|---|---|---|
| 用户列表 | `projects/crun/pages/admin/user/list/admin_user_list` | 用户列表管理 |
| 用户详情 | `projects/crun/pages/admin/user/detail/admin_user_detail` | 查看用户详情 |
| 用户导出 | `projects/crun/pages/admin/user/export/admin_user_export` | 导出用户数据 |

#### 管理端 — 管理员管理 (mgr)

| 页面名称 | 路径 | 功能说明 |
|---|---|---|
| 管理员列表 | `projects/crun/pages/admin/mgr/list/admin_mgr_list` | 管理员列表 |
| 添加管理员 | `projects/crun/pages/admin/mgr/add/admin_mgr_add` | 新增管理员 |
| 编辑管理员 | `projects/crun/pages/admin/mgr/edit/admin_mgr_edit` | 编辑管理员信息 |
| 修改密码 | `projects/crun/pages/admin/mgr/pwd/admin_mgr_pwd` | 修改管理员密码 |
| 操作日志 | `projects/crun/pages/admin/mgr/log/admin_log_list` | 管理员操作日志 |

#### 管理端 — 系统设置 (setup)

| 页面名称 | 路径 | 功能说明 |
|---|---|---|
| 关于设置 | `projects/crun/pages/admin/setup/about/admin_setup_about` | 小程序关于页面配置 |
| 关于列表 | `projects/crun/pages/admin/setup/about_list/admin_setup_about_list` | 关于页面列表 |
| 二维码设置 | `projects/crun/pages/admin/setup/qr/admin_setup_qr` | 小程序码/二维码配置 |

旧入口 `projects/crun/pages/admin/operations/admin_operations` 仅用于将已有链接跳转到新版管理页面。旧订单编辑地址 `projects/crun/pages/mail/edit/mail_edit` 也只跳转到当前发布/编辑表单。两个入口均不承载另一套业务逻辑。当前导航使用独立页面，详见 [后台管理说明](ADMIN_CONSOLE.md)。

### 公共组件 (cmpts/)

| 组件路径 | 说明 |
|---|---|
| `cmpts/public/list/comm_list_cmpt` | 通用列表组件 |
| `cmpts/public/picker/picker_cmpt` | 选择器组件 |
| `cmpts/public/modal/modal_cmpt` | 模态框组件 |
| `cmpts/public/form/form_set/form_set_cmpt` | 表单配置组件 |
| `cmpts/public/form/form_show/form_show_cmpt` | 表单展示组件 |
| `cmpts/public/img/img_upload_cmpt` | 图片上传组件 |
| `cmpts/public/calendar/*` | 日历相关组件 |
| `cmpts/public/poster/poster_cmpt` | 海报生成组件 |
| `cmpts/public/editor/editor_cmpt` | 富文本编辑器组件 |
| `cmpts/public/custom_nav/custom_nav_cmpt` | 自定义导航组件 |
| `cmpts/biz/detail/detail_cmpt` | 详情页通用业务组件 |
| `cmpts/biz/foot/foot_cmpt` | 页脚版本信息组件 |

### 云函数后端 (cloudfunctions/mcloud/)

#### Controller 层 — 控制器

| 文件 | 说明 |
|---|---|
| `controller/home_controller.js` | 首页数据 |
| `controller/news_controller.js` | 公告 |
| `controller/operations_controller.js` | 消息中心、未读摘要、已读与订单订阅 |
| `controller/passport_controller.js` | 用户登录注册 |
| `controller/my_controller.js` | 个人中心 |
| `controller/mail_controller.js` | 快递 |
| `controller/fav_controller.js` | 收藏 |
| `controller/check_controller.js` | 校验 |
| `controller/admin/*` | 管理端各模块控制器 |

#### Service 层 — 业务逻辑

| 文件 | 说明 |
|---|---|
| `service/home_service.js` | 首页 |
| `service/news_service.js` | 公告 |
| `service/notification_service.js` | 公告与个人消息聚合、未读和阅读记录 |
| `service/passport_service.js` | 登录注册 |
| `service/mail_service.js` | 快递 |
| `service/fav_service.js` | 收藏 |
| `service/base_project_service.js` | 公共基础服务 |
| `service/admin/*` | 管理端各模块服务 |

#### Model 层 — 数据模型

| 文件 | 说明 |
|---|---|
| `model/user_model.js` | 用户 |
| `model/news_model.js` | 公告 |
| `model/mail_model.js` | 快递 |
| `model/fav_model.js` | 收藏 |
| `model/base_project_model.js` | 基础模型 |

### 架构总结

- **用户端** 提供快递代取、公告与消息、个人资料、收藏评价、信誉分和客服反馈。
- **管理端** 提供订单、用户、反馈、公告、数据统计、系统设置和维护页面。
- **公共组件** 封装了列表、表单、日历、海报、图片上传等复用 UI
- **云端采用 MVC 架构**：Controller → Service → Model，每层职责清晰

## 图片保存流程

项目使用**微信云开发云存储**保存图片，数据库仅存储 `fileID`，不保存本地路径。

### 核心流程

```
用户选择图片（本地临时路径）
    ↓
图片内容安全校验（content_check_helper）
    ↓
wx.cloud.uploadFile() 上传到云存储
    ↓
获得 cloud:// 文件 ID
    ↓
云函数写入数据库（USER_FORMS / 业务表）
```

### 关键文件说明

| 文件 | 作用 |
|------|------|
| `miniprogram/cmpts/public/img/img_upload_cmpt.js` | 图片选择、预览、删除 |
| `miniprogram/helper/cloud_helper.js` | 图片上传核心逻辑 |
| `cloudfunctions/mcloud/project/crun/service/passport_service.js` | 个人资料保存（含头像 + 表单图片） |

### cloud_helper.js 核心函数

| 函数 | 说明 |
|------|------|
| `transTempPics(imgList, dir, id)` | 批量上传临时图片到云存储，返回 fileID 列表 |
| `transTempPicOne(img, dir, id)` | 单张图片上传（如头像），内部调用 `transTempPics` |
| `transFormsTempPics(forms, dir, id)` | 处理表单中所有图片字段（type=image），逐个上传 |
| `transCoverTempPics(imgList, dir, id)` | 处理封面图片上传 |

### 云存储路径规则

```
cloudPath = PID + '/' + dir + id + '/' + random + ext
```

示例：`crun/user/20260901/1234567.jpg`

- `PID`：项目 ID，由 `pageHelper.getPID()` 获取
- `dir`：目录名，如 `user/`、`news/` 等
- `id`：业务记录 ID，日期格式时为 `YYYYMMDD`
- `random`：时间戳与长随机值，降低多人同时上传时的文件名碰撞风险
- `ext`：文件扩展名（`.jpg` / `.png` 等）

### 图片字段配置（单张限制）

在 `projects/crun/public/project_setting.js` 的 `USER_FIELDS` 中，通过 `max` 参数控制上传数量：

```javascript
{ mark: 'payPic', title: '收款码', type: 'image', must: false, max: 1, ext: { hint: '...' } }
```

- `max: 1`：仅允许上传 1 张，超出后 `+` 按钮自动隐藏
- `max: 4`（组件默认值）：允许上传 4 张

### 个人资料提交时图片处理示例

```javascript
// 1. 头像：transTempPicOne
let pic = await cloudHelper.transTempPicOne(this.data.formPic, 'user/', '', false);
data.pic = pic;

// 2. 表单图片（收款码等）：transFormsTempPics
let forms = this.selectComponent("#cmpt-form").getForms(true);
await cloudHelper.transFormsTempPics(forms, 'user/', '');

// 3. 提交到云函数
await cloudHelper.callCloudSumbit('passport/edit_base', data, opts);
```

### 数据库存储格式

| 字段 | 存储内容 | 示例 |
|------|---------|------|
| `USER_PIC` | 头像 fileID | `cloud://xxx/xxx.jpg` |
| `USER_FORMS`（payPic） | 收款码 fileID | `cloud://xxx/xxx.jpg` |
| `NEWS_PIC` | 公告封面 fileID 数组 | `["cloud://xxx/a.jpg","cloud://xxx/b.jpg"]` |

## 后台管理系统截图 

- 后台学校／校区管理授权校验已直接删除，登录、会话及后台操作均不要求 `ADMIN_SCOPES`；旧环境变量也不能恢复该门槛。内测默认已有账号密码正确即可登录，`ADMIN_LOGIN_CREDENTIALS_ONLY=false` 仅恢复账号状态与登录限流检查。角色和当前数据范围继续生效。必须上传部署更新后的 `mcloud`，再重新编译小程序，详见 [后台说明](ADMIN_CONSOLE.md#内测登录)。
- 首次空库安装通过环境变量 `INIT_ADMIN_NAME`（默认 `admin`）和至少 12 位的 `INIT_ADMIN_PASSWORD` 创建平台管理员。没有默认密码；旧管理员登录无需补学校／校区授权，初始化后移除初始密码变量。

## 公告与站内消息提醒

首页公告可直接阅读，首页消息入口、个人中心与底部“我的”共用未读提醒。消息中心支持公告和个人通知、只看未读、全部已读及详情直达，详情成功展示后才清除未读。保留现有订单微信订阅。

需同时更新 `mcloud` 云函数和小程序；新增的 `bx_news_read` 集合会自动补齐。发布方式、数据规则、索引和验证步骤见 [公告与站内消息说明](NOTIFICATIONS.md)。

## 订单收藏、互评与信誉分

- 在“订单 → 可接单”卡片或订单详情中收藏订单，可从“我的 → 我的收藏”再次打开；已接取、过期或下架的收藏可移除。订单页的悬浮发布按钮已移除，仍可从首页发布订单。
- 收藏量由云端收藏记录统计，自己的收藏操作成功后立即更新，其他用户的变化在可接单列表和详情页每 30 秒自动同步。离开页面后停止同步，返回页面时重新获取；不向客户端开放收藏者身份或私密订单数据。
- “我的信誉分”位于“常用联系人”上方，展示分数构成、收到的订单评价和已生效的申诉审核记录。所有用户初始为 80 分；1～5 星分别记 **-4、-2、0、+2、+4 分**。总分为基础分加两类计分的累计值，最后限制在 **0～100**。
- 已完成订单的发布者、接单人均可评价对方，每人每单一次；“已完成”列表和订单详情提供评价入口，“我的评价”可切换查看发出和收到的评价。评价保存后不可覆盖，网络重试不会重复计分；原有有效评价自动纳入信誉分。
- “我的评价”卡片仅显示头像、名字、星级和评价内容：收到的评价显示评价人，发出的评价显示被评价人。评价列表不返回订单编号、时间或用户账号等关联信息，页面不提供订单跳转；头像缺失或加载失败时显示默认头像。
- 从订单提交申诉时，云端根据订单关系确定被申诉用户。只有管理员核实、处理完成并选择星级后才计分。普通回复不改变已有评分，修改星级会替换原评分，撤销评分或将反馈转为继续跟进/不予处理会移除对应计分，历史记录保留。未关联明确订单对方的一般反馈不能给用户评分。

更新时需同时部署 `mcloud` 云函数与小程序代码。云函数初始化会自动补齐 `bx_order_review`、`bx_review_request` 等集合，无需重置用户或历史收藏；数据库写入继续由云函数执行。信誉分不依赖客户端上传的用户身份、基础分或加减分数值。

本地验证：`npm test --prefix cloudfunctions/mcloud`；页面和路由检查：`node scripts/check-miniprogram-pages.cjs`。该脚本也支持传入微信开发者工具的 `--wcc`、`--wcsc` 编译器路径，检查实际 WXML/WXSS 编译与页面状态渲染。

## 并发、自动刷新与流畅度

订单采用事务抢单、请求去重、配额校验和提交结果核对；发布或状态变化后，可接单、个人订单和详情自动更新。公共请求和列表处理重复点击、旧响应、弱网重试与分页，订单分段保留短时内存快照，常用按钮立即反馈处理状态。

多校版本需要配套部署 `mcloud`、对应小程序、独立订单/通知定时函数，并关闭全部集合的客户端数据库读写（包括 `bx_order_feed`）。删除旧共享定时器并完成历史数据迁移后，再逐校区开放服务。规则、索引、发布顺序和真实云验收要求见 [多校部署与迁移手册](deployment/MULTI_TENANT_ROLLOUT.md)。本地并发模拟不代表已经完成线上部署或通过容量验收。

## 多校架构整改

学校与校区使用稳定 ID，账号在学校内共享，订单、公告、运营设置和地点按校区隔离。平台后台可新增学校、校区及管理员授权，已支持的业务无需按学校重新发版；取、送、买共用订单事务核心，业务校验、计价和表单差异通过插件注册。

本轮实施记录、测试结果和剩余真实云端验收项见 [架构整改建议与进度书](ARCHITECTURE_PROGRESS.md)。

## 微信登录与资料补全

AppID 为 `wx3d8dc6fb0e764ec7`。内测默认允许直接点“手动填写资料注册”；微信手机号能力不支持或返回权限错误时，也会自动切换为手填。填写手机号、昵称、头像、性别、学院、专业与所在校区后，可按学校审核规则使用功能。手填号码保留未验证状态，已微信验证的号码更换仍须重新授权。服务端设置 `ALLOW_MANUAL_REGISTRATION=false` 可恢复强制微信手机号验证，学校审核和账号停用规则始终生效。

需要配套更新 `mcloud` 与小程序后生效。手机号授权接口保留 `phonenumber.getPhoneNumber` 权限，手填路径不调用该接口。实现、旧账号处理及真机步骤见 [登录与注册说明](deployment/WECHAT_LOGIN.md)。真机日志已定位原生权限拒绝 `102`，与后台预拉取日志不同；手填注册可用于继续测试。本地 497 项回归及微信模板编译通过，本任务尚未部署或完成真机验收。
