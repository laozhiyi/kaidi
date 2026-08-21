## 功能介绍 
![image](https://github.com/dearancelan/MiniRun/assets/89879893/9fca151d-259d-4f2c-aa93-a033585d3090)

  校园跑腿小程序: 在帮助学生和教职员工解决日常生活中的琐事，提供便利、快捷的服务.解决学生和教职员工日常生活中的燃眉之急，促进了校园内的互助和共享文化，提升了校园生活的便利性和舒适度。 

- 公告资讯：提供校园内的新闻、通知、课程表等信息，让用户及时了解校园动态。 
- 任务发布： 用户可以发布各种生活任务，如代购食物、快递取送、打印文件等，描述任务需求、地点、时间等信息。
- 任务接单： 其他用户（跑腿者）可以浏览并接受发布的任务，承接后负责完成任务，并与发布者协商具体细节。 
- 分类管理：小程序可以按照不同的任务类型进行分类管理，如代购、快递、搬运等，方便用户快速找到所需服务。  
![image](https://github.com/dearancelan/MiniRun/assets/89879893/db5de849-e992-491b-9b03-53bc6c31238e)


## 技术 运用
- 本项目使用微信小程序平台进行开发。
- 使用腾讯专门的小程序云开发技术，云资源包含云函数，数据库，带宽，存储空间，定时器等，资源配额价格低廉，无需域名和服务器即可搭建。
- 小程序本身的即用即走，适合小工具的使用场景，也适合快速开发迭代。
- 云开发技术采用腾讯内部链路，没有被黑客攻击的风险，不会 DDOS攻击，节省防火墙费用，安全性高且免维护。
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

#### TabBar 页面（底部导航）

| 页面名称 | 路径 | 功能说明 |
|---|---|---|
| 首页 | `projects/crun/pages/default/index/default_index` | 首页入口，展示banner、快捷入口 |
| 公告通知 | `projects/crun/pages/news/index/news_index` | 校园公告/资讯列表 |
| 我的 | `projects/crun/pages/my/index/my_index` | 个人中心主页 |

#### 首页相关

| 页面名称 | 路径 | 功能说明 |
|---|---|---|
| 首页 | `projects/crun/pages/default/index/default_index` | 首页 |
| 关于我们 | `projects/crun/pages/about/index/about_index` | 关于页面 |
| 全局搜索 | `projects/crun/pages/search/search` | 搜索页 |

#### 用户端 — 任务 (thing)

| 页面名称 | 路径 | 功能说明 |
|---|---|---|
| 任务大厅 | `projects/crun/pages/thing/index/thing_index` | 任务列表/大厅首页 |
| 发布任务 | `projects/crun/pages/thing/add/thing_add` | 发布新任务 |
| 编辑任务 | `projects/crun/pages/thing/edit/thing_edit` | 编辑已有任务 |
| 任务详情 | `projects/crun/pages/thing/detail/thing_detail` | 任务详情页 |

#### 用户端 — 快递 (mail)

| 页面名称 | 路径 | 功能说明 |
|---|---|---|
| 快递大厅 | `projects/crun/pages/mail/index/mail_index` | 快递任务列表 |
| 添加快递 | `projects/crun/pages/mail/add/mail_add` | 发布快递任务 |
| 编辑快递 | `projects/crun/pages/mail/edit/mail_edit` | 编辑快递任务 |
| 快递详情 | `projects/crun/pages/mail/detail/mail_detail` | 快递详情页 |

#### 用户端 — 代购 (food)

| 页面名称 | 路径 | 功能说明 |
|---|---|---|
| 代购大厅 | `projects/crun/pages/food/index/food_index` | 代购任务列表 |
| 添加代购 | `projects/crun/pages/food/add/food_add` | 发布代购任务 |
| 编辑代购 | `projects/crun/pages/food/edit/food_edit` | 编辑代购任务 |
| 代购详情 | `projects/crun/pages/food/detail/food_detail` | 代购详情页 |

#### 用户端 — 跑腿 (follow)

| 页面名称 | 路径 | 功能说明 |
|---|---|---|
| 跑腿大厅 | `projects/crun/pages/follow/index/follow_index` | 跑腿任务列表 |
| 添加跑腿 | `projects/crun/pages/follow/add/follow_add` | 发布跑腿任务 |
| 编辑跑腿 | `projects/crun/pages/follow/edit/follow_edit` | 编辑跑腿任务 |
| 跑腿详情 | `projects/crun/pages/follow/detail/follow_detail` | 跑腿详情页 |

#### 用户端 — 个人中心 (my)

| 页面名称 | 路径 | 功能说明 |
|---|---|---|
| 我的主页 | `projects/crun/pages/my/index/my_index` | 个人中心 |
| 用户注册 | `projects/crun/pages/my/reg/my_reg` | 用户注册 |
| 编辑资料 | `projects/crun/pages/my/edit/my_edit` | 编辑个人信息 |
| 我的足迹 | `projects/crun/pages/my/foot/my_foot` | 浏览历史/足迹 |
| 我的收藏 | `projects/crun/pages/my/fav/my_fav` | 收藏列表 |

#### 管理端 — 首页/登录

| 页面名称 | 路径 | 功能说明 |
|---|---|---|
| 后台登录 | `projects/crun/pages/admin/index/login/admin_login` | 管理员登录 |
| 后台首页 | `projects/crun/pages/admin/index/home/admin_home` | 后台仪表盘/数据概览 |
| 内容管理 | `projects/crun/pages/admin/content/admin_content` | 内容管理主页 |
| 内容预览 | `projects/crun/pages/admin/preview/admin_preview` | 预览页 |

#### 管理端 — 公告管理 (news)

| 页面名称 | 路径 | 功能说明 |
|---|---|---|
| 公告列表 | `projects/crun/pages/admin/news/list/admin_news_list` | 公告列表管理 |
| 添加公告 | `projects/crun/pages/admin/news/add/admin_news_add` | 新增公告 |
| 编辑公告 | `projects/crun/pages/admin/news/edit/admin_news_edit` | 编辑公告 |

#### 管理端 — 任务管理 (thing)

| 页面名称 | 路径 | 功能说明 |
|---|---|---|
| 任务列表 | `projects/crun/pages/admin/thing/list/admin_thing_list` | 所有任务管理 |
| 任务导出 | `projects/crun/pages/admin/thing/export/admin_thing_export` | 导出任务数据 |

#### 管理端 — 快递管理 (mail)

| 页面名称 | 路径 | 功能说明 |
|---|---|---|
| 快递列表 | `projects/crun/pages/admin/mail/list/admin_mail_list` | 所有快递任务管理 |
| 快递导出 | `projects/crun/pages/admin/mail/export/admin_mail_export` | 导出快递数据 |

#### 管理端 — 代购管理 (food)

| 页面名称 | 路径 | 功能说明 |
|---|---|---|
| 代购列表 | `projects/crun/pages/admin/food/list/admin_food_list` | 所有代购任务管理 |
| 代购导出 | `projects/crun/pages/admin/food/export/admin_food_export` | 导出代购数据 |

#### 管理端 — 跑腿管理 (follow)

| 页面名称 | 路径 | 功能说明 |
|---|---|---|
| 跑腿列表 | `projects/crun/pages/admin/follow/list/admin_follow_list` | 所有跑腿任务管理 |
| 跑腿导出 | `projects/crun/pages/admin/follow/export/admin_follow_export` | 导出跑腿数据 |

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
| `cmpts/biz/foot/foot_cmpt` | 底部足迹组件 |

### 云函数后端 (cloudfunctions/mcloud/)

#### Controller 层 — 控制器

| 文件 | 说明 |
|---|---|
| `controller/home_controller.js` | 首页数据 |
| `controller/news_controller.js` | 公告 |
| `controller/passport_controller.js` | 用户登录注册 |
| `controller/my_controller.js` | 个人中心 |
| `controller/thing_controller.js` | 任务 |
| `controller/mail_controller.js` | 快递 |
| `controller/food_controller.js` | 代购 |
| `controller/follow_controller.js` | 跑腿 |
| `controller/fav_controller.js` | 收藏 |
| `controller/check_controller.js` | 校验 |
| `controller/admin/*` | 管理端各模块控制器 |

#### Service 层 — 业务逻辑

| 文件 | 说明 |
|---|---|
| `service/home_service.js` | 首页 |
| `service/news_service.js` | 公告 |
| `service/passport_service.js` | 登录注册 |
| `service/thing_service.js` | 任务 |
| `service/mail_service.js` | 快递 |
| `service/food_service.js` | 代购 |
| `service/follow_service.js` | 跑腿 |
| `service/fav_service.js` | 收藏 |
| `service/base_project_service.js` | 公共基础服务 |
| `service/admin/*` | 管理端各模块服务 |

#### Model 层 — 数据模型

| 文件 | 说明 |
|---|---|
| `model/user_model.js` | 用户 |
| `model/news_model.js` | 公告 |
| `model/thing_model.js` | 任务 |
| `model/mail_model.js` | 快递 |
| `model/food_model.js` | 代购 |
| `model/follow_model.js` | 跑腿 |
| `model/fav_model.js` | 收藏 |
| `model/base_project_model.js` | 基础模型 |

### 架构总结

- **用户端** 涉及 4 大业务模块：**任务 (thing)**、**快递 (mail)**、**代购 (food)**、**跑腿 (follow)**，每块均有列表/详情/新增/编辑 4 个页面
- **管理端** 对应每个业务模块有列表页和导出页，外加用户管理、管理员管理、系统设置等页面
- **公共组件** 封装了列表、表单、日历、海报、图片上传等复用 UI
- **云端采用 MVC 架构**：Controller → Service → Model，每层职责清晰

 

## 后台管理系统截图 
- 后台超级管理员默认账号:admin，密码123456，请登录后台后及时修改密码和创建普通管理员。
