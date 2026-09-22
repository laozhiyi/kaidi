# 多校架构部署、迁移与验收手册

适用版本：2026-09-21 多校整改。本手册取代旧文档中仅按 `_pid` 隔离、客户端监听数据库和 `mcloud` 共用定时器的部署步骤。实施与实测结果见根目录 [进度书](../ARCHITECTURE_PROGRESS.md)。

当前交付是代码、本地检查与可部署材料。尚未连接独立测试云环境，未上传函数、创建云端索引、改变线上安全规则或迁移真实数据。下述云端步骤必须在明确目标环境后执行并留存结果。

## 1. 数据与权限边界

| 范围 | 集合/内容 | 约束 |
| --- | --- | --- |
| 学校 | `bx_user`、`bx_identity_unique` | 同校跨校区共享账号、手机号唯一性；不同学校独立。用户审核、停用、导出及注册审核政策需要学校授权 |
| 校区 | 订单、配额、事件、公告、已读、通知、收藏、申诉、评价、邀请、客服、运营配置、审计、日志、业务 setup | 请求必须包含有效 `schoolId`、`campusId`；云端数据库包装器约束查询、文档、聚合与事务 |
| 受控全局 | `bx_school`、`bx_campus`、`bx_admin`、`bx_admin_limit`、`bx_request_scope`、`bx_tenant_migration`、版本初始化标记 | 分别由目录、管理员身份、登录限流、请求归属、迁移服务访问，不能据此开放客户端数据库权限 |
| 后台任务 | `bx_worker_state`，全局扫描订单/通知/过期限流桶 | 只在服务端显式 system 上下文中跨校区扫描；处理每条业务记录时恢复该记录的校区上下文 |

严格模式下，管理员权限分为平台、学校与校区。平台管理员必须同时满足 `ADMIN_STATUS=1`、`ADMIN_TYPE=1`、`ADMIN_PLATFORM=true`。学校授权为 `{schoolId, campusId:"*"}`；校区授权必须列出稳定 ID。`ADMIN_TYPE=1` 控制高级配置权限，本身不等于平台身份。授权变更会使目标管理员旧令牌失效。

本轮按用户要求默认启用 `ADMIN_LOGIN_CREDENTIALS_ONLY=true`：内测已有管理员凭正确账号密码即可登录，暂停登录限流、账号状态和学校／校区授权门槛，会话和业务事务同步采用该规则；角色、令牌校验及数据库范围隔离继续生效，不写入永久授权。多校正式权限验收前，显式设置 `ADMIN_LOGIN_CREDENTIALS_ONLY=false` 并重新登录；该开关由服务端环境控制，不能由小程序请求选择。详细行为见 [后台内测登录](../ADMIN_CONSOLE.md#内测登录)。

学校、校区编号为 2–48 位小写字母、数字、下划线或连字符，以字母开头；创建后不要通过改 ID 来重命名。名称可以修改。学校/校区停用会阻止普通业务请求；管理入口仍可选择停用校区，以恢复服务。公开目录只包含名称、编号、状态等元数据，不包含地点、账号、凭证。

所有业务集合，包括 `bx_order_feed`、`bx_news_manifest`、`bx_news_unread`、`bx_worker_state`、迁移日志与版本标记，均配置 [server-only.json](database-rules/server-only.json)：

```json
{"read": false, "write": false}
```

[order-feed.json](database-rules/order-feed.json) 同样关闭读写。订单变化通过 `operations/feed` 按校区读取最多 64 条不透明版本信号。**不要再开放 `_pid == 'crun'` 的客户端读取规则。** 安全规则须在控制台实际保存；上传 JSON 文件本身不会生效。

云存储权限另行配置：保留当前用户向 `private/<openid>/` 上传的权限，禁止客户端写入 `private-evidence/`。私密凭证通过云函数检查订单关系后获取临时链接。数据库规则不能直接用作整个存储桶的策略。当前线下结算；`payNotify` 已关闭，不应配置为支付成功入口。

## 2. 索引与资源配置

[database-indexes.json](database-indexes.json) 是候选索引清单，**不是控制台/CLI 导入格式，也未在云端应用**。每条 `fields` 前必须加上 `prefixes[scope]`：

- 校区查询：`_pid, schoolId, campusId`，然后是等值条件、排序及游标字段。
- 学校账号查询：`_pid, schoolId`，然后是身份或用户列表字段。
- 目录、全局认证、迁移和定时扫描：`_pid`，然后是对应查询字段。这些例外来自明确的服务端用途。

运行 `node scripts/check-architecture-deployment.cjs` 会生成字段已经展开的 `.tmp/architecture-validation/indexes-expanded.json`。按目标套餐的索引限制、查询分析与实际命中情况逐项创建。普通索引不能替代租户授权，也不能优化所有正则包含搜索、`OR`、`!=` 和深分页。

直接按 `_id` 读取的请求归属、配置、配额、幂等记录、公告摘要、用户已读索引、任务检查点复用内建文档索引。全部候选为非唯一索引；业务唯一性由稳定文档 ID、事务和迁移冲突检查实现。不要在未清理历史冲突前直接创建全局手机号唯一索引。

定时扫描使用 `时间 ASC, _id ASC` 游标，不能省略同时间戳的 `_id`。`WORKER_SHARD` 启用时，在对应全局任务索引的 `_pid` 后加 `workerShard ASC`。迁移窗口内全表分页使用 `_pid ASC, _id ASC`；是否需要临时索引取决于实际执行计划。

以下只是测试环境的起始配置，容量与超时以实测修正，不是吞吐承诺：

| 函数 | 入口/触发方式 | 起始资源建议 |
| --- | --- | --- |
| `mcloud` | 小程序 API，无 Timer | 512 MB，超时 30 秒；客户端 20 秒内未确认时进入同请求重试/核对；并发按套餐和数据库容量实测配置 |
| `ordersWorker` | `orders-minute`，每分钟 | 256 MB，60 秒；扫描时间预算 40 秒，每项最多 4 个并发处理者 |
| `notificationsWorker` | `notifications-minute`，每分钟 | 256 MB，60 秒；独立于 API 和订单维护，共用通知事务领取机制 |
| `tenantMigrator` | 临时管理调用，无 Timer | 512 MB，60 秒，迁移窗口中串行操作，默认每批 20 条 |

使用控制台仍支持维护、且满足代码能力要求的 Node.js 运行时；代码最低能力下限为 Node 16.13，但这不是推荐使用旧运行时。本地验证使用 Node 24.19.0 与已安装的 `wx-server-sdk 2.6.3`。必须在最终选择的真实云运行时安装锁定依赖并复验。

所有函数显式设置 `CLOUD_ENV_ID`。它优先于仓库已有 `config.CLOUD_ID`，以免测试部署误连原环境。不要从现有配置推断本次部署目标。首次空库安装还需至少 12 位的 `INIT_ADMIN_PASSWORD`，可设置 `INIT_ADMIN_NAME`；初始化完成后移除初始密码环境变量。恢复严格模式前旧库管理员必须通过迁移计划明确授权；内测也没有默认 `admin/123456` 自动建号入口。

通知函数单独配置 `ORDER_SUBSCRIBE_TEMPLATE_ID`、`ORDER_SUBSCRIBE_FIELDS`，并授予 `subscribeMessage.send`。字段映射形如 `{"order":"character_string1","status":"thing2","time":"time3"}`，必须使用实际微信模板字段。`mcloud` 保留图片/文字审核、小程序码等原有 OpenAPI 权限，并新增 `phonenumber.getPhoneNumber` 用于手机号授权登录。不要把所有权限照搬给迁移函数。手机号能力、旧账号补授权及真机步骤见 [微信登录说明](WECHAT_LOGIN.md)。

默认每批 50 条、最多 10 轮；订单任务每轮检查过期和履约超时两种队列，通知任务检查一类队列，实际还受 40 秒预算约束。订单任务另外清理最多各 100 条过期 `operation_limit`/`admin_limit`。`WORKER_BATCH_SIZE` 上限 100、`WORKER_MAX_BATCHES` 上限 20。若配置 `WORKER_SHARD=0..15`，须覆盖所有分片，并为每个分片保留独立检查点；不要同时启动全量与分片扫描器。

同一种任务/分片尽量保持单实例执行，避免检查点相互覆盖和重复扫描。事务保护业务结果，但不消除重复调度带来的数据库与通知调用成本。每次返回的 `hasMore` 是扫描继续信号，不等于实时积压数量。

前台订单信号每 10–12 秒查询，列表约 30 秒兜底刷新；通知摘要每 60 秒、收藏每 30 秒刷新，并在页面/小程序隐藏时停止。仅订单信号一项，1,000 个同时前台用户按平均 11 秒间隔估算约 91 次函数调用/秒，另外还有校区解析、列表和其他查询。不能将降低轮询频率等同于完成容量验收。

## 3. 本地生成与核对部署包

```powershell
node scripts/build-operations-worker.cjs
```

脚本打印本次独立目录 `.tmp/deploy/architecture-<随机标识>/`，内含 `ordersWorker`、`notificationsWorker`、`tenantMigrator`。每个包的 `index.js` 替换为专用入口，`config.json` 仅包含对应触发器/权限；包含锁文件，不包含 `node_modules`。`SOURCE_MANIFEST.json` 记录逐文件 SHA-256；批次另有 `DEPLOYMENT_MANIFEST.json`。

```powershell
node scripts/check-architecture-deployment.cjs '.tmp/deploy/architecture-本次标识'
```

检查成功后，使用控制台/开发者工具“云端安装依赖”部署到确认的环境；API 单独部署 `cloudfunctions/mcloud`。这些本地脚本不会安装、上传或部署。修改源文件后重新生成整个批次，不混用不同批次的函数。

**删除旧 `mcloud` 上的 `operations-minute` 触发器。** 新 API 的 `config.json` 已是空触发器列表，代码也拒绝 Timer 事件；云端旧触发器未必随代码上传自动删除。确认 `ordersWorker`、`notificationsWorker` 各自的定时触发器实际存在，迁移函数没有公开 HTTP 入口或定时触发器。

## 4. 历史数据迁移

迁移期间暂停所有旧业务写入、旧定时器和新版 worker，等待旧实例及在途请求结束。仅暂停营业不足以阻止旧客户端确认、客服等写操作，应在函数调用入口/版本切换层阻断旧写流量。先做云数据库备份，保留旧函数/前端版本、配置、权限和索引清单，并实测备份恢复路径。

### 4.1 初始化与冻结计划

1. 在独立测试环境恢复脱敏备份，确认环境 ID。初始化会补齐集合；版本标记为 `bx_setup_crun_20260921_tenants`，只有所有集合成功就绪后才创建，不要手工提前建标记。
2. 现有广西师范大学目录由种子生成 `gxnu/yucai`、`gxnu/wangcheng`、`gxnu/yanshan`；种子只用于兼容，不是前端开校配置。它会读取旧全局运营配置中的注册审核政策。其他目标学校必须先创建有效目录；可在维护窗口先迁移明确的原超级管理员为平台管理员，再使用新后台创建目录，期间不开放业务写入。
3. 复制 [tenant-migration.example.json](../scripts/tenant-migration.example.json)，填写旧学校 ID、校区名称别名、配置复制目标和每位旧管理员授权。`defaults` 是某集合无法关联时的明确默认归属；`overrides` 的键为 `集合简称/旧文档ID`，值为归属。用户只填学校范围，其他业务记录填学校和校区。不要用默认值掩盖无法核实的归属。
4. 无学校/校区标签的旧公告、邀请、订阅、审计、日志、setup，以及已停止而没有订单关联的请求，通常需要明确默认或逐条映射。有关联的客服消息、订单事件、通知、评价等从关联记录解析范围，关联缺失会报错。历史的派生配额、刷新、限流和唯一键记录保留为退役记录；手机号、请求归属等重新建立。
5. 对全部集合、全部分页先执行 `plan`，解决所有 `unresolved` 后冻结计划并保存 `planHash`。**开始写入后不随意更换计划**；更改计划产生新哈希，不会自动重新分配已具备范围的记录，原计划日志仍需单独保留和回滚。

`tenantMigrator` 只有设置 `TENANT_MIGRATION_ENABLED=true` 且显式设置 `CLOUD_ENV_ID` 才允许执行；拒绝带小程序 `OPENID` 的调用。只在受控云控制台或管理凭据下调用。`plan` 不迁移业务记录，但函数首次调用可能执行集合及目录初始化；它不是完全无写操作的初始化检查。

### 4.2 按批预检、应用与续跑

调用事件中的 `plan` 必须是完整 JSON 对象，不是本地文件路径。示例结构：

```json
{
  "action": "plan",
  "collection": "mail",
  "after": "",
  "size": 20,
  "plan": {
    "version": 1,
    "legacySchoolId": "gxnu",
    "aliases": {},
    "configTargets": [],
    "defaults": {},
    "overrides": {},
    "admins": {}
  }
}
```

上例的空映射必须用已核实的计划替换。集合顺序以 `TenantMigration.COLLECTIONS` 为准：

```text
mail, user, admin, news, campus_service, campus_service_message,
feedback, order_review, order_event, order_request, feedback_request,
review_request, notification, news_read, fav, invite, subscription,
operation_config, identity_unique, order_quota, order_feed,
operation_limit, operation_audit, setup, log
```

依赖对象可以从尚未迁移的源记录按同一计划解析，但全部关联记录最终必须完成迁移。首次需要恢复后台目录管理时可先完成 `admin`；不要因此跳过其他集合或后续全量核验。

每一页的执行步骤：

1. 用相同 `plan/collection/after/size` 调用 `action:"plan"`，保存 `batchHash` 与明细。任何 `unresolved` 都必须处理后重新预检。
2. 将 `action` 改为 `"apply"`，加入 `expectedHash:返回的batchHash`，其他参数完全不变。预检后源数据或映射变化会拒绝写入。
3. 成功后使用返回的 `nextAfter` 继续。`hasMore=true` 时不能停止；即使最后一页恰好等于批量大小，也需继续空页以保存完成检查点。
4. 超时/部分批次失败时，保留原计划，读取保存的检查点。对未确认的同一页重新 `plan` 再 `apply`；已迁记录返回 `already`，不会覆盖备份。不要跳过尚未成功的分页，也不要删除日志。
5. 即使集合为空，也执行一次预检、应用，形成完成检查点。全局运营配置复制到明确目标校区后全部 `enabled=false`；保留原记录作为退役历史。

每个源记录及其派生写入在一个事务内提交，每个目标只有一份回滚日志。批次之间不是一个大事务，续跑是正常流程。数据较大或关联读取较多时缩小批量，保持冻结写窗口。

### 4.3 完整核验与发布准备

所有源集合应用完毕后，逐集合调用 `action:"verify"`，从 `after:""` 开始分页直到 `hasMore=false`，并要求每页 `issues=[]`。检查包括学校/校区、关联归属、账号重复与手机号锁、请求归属保护、配置/订阅键、任务分片、订单规则快照、管理员授权以及有效公告正文。核验发现问题时修复后从该集合第一批重新核验；不能跳页以产生假完成。

随后对每个目标校区调用：

```javascript
// plan 为前面冻结的完整 JSON 对象。
const event = {action:"finalize", plan, scope:{schoolId:"gxnu", campusId:"yucai"}};
```

`finalize` 要求全部集合迁移、核验完成，存在有效平台管理员，未执行回滚，并且目标校区暂停服务。它会重建该校区公告摘要并记回滚日志；重复执行同一版本不会重复改写。每校区有效公告最多 500 条，摘要 UTF-8 大小最多 600,000 字节；超出需先撤下旧公告。返回 `ready:true` 仅表示数据准备完成，**不会自动营业，也不表示云容量或权限验收通过**。

历史每个角色在途订单达到 1,000 条时核验会停止，不能靠截断查询自动生成错误配额。需先人工核实异常积压再继续。

### 4.4 回滚

保持维护窗口与 worker 停止，用原计划调用 `action:"rollback"`，从空 `after` 开始按返回游标遍历全部日志。只恢复当前记录仍与迁移后哈希一致的目标；迁移后已有业务写入会拒绝覆盖。遇到拒绝时导出差异并人工处理，不强制清库。回滚不自动撤销初始目录/集合/安全规则/函数部署，需要配合保存的环境备份。

回滚后不要运行新版业务和定时器处理未带范围的旧记录。部署原配套版本并恢复对应安全策略前应完成恢复演练。`bx_order_request`、`bx_feedback_request`、`bx_review_request`、`bx_request_scope` 和迁移日志不得作为清理缓存删除，否则可能重新放行旧请求。

## 5. 新增学校的正常运营步骤

当前内测版本已按要求移除首页、订单列表、管理员登录、管理中心的新增学校／校区选择器 UI，底层目录与校区隔离仍保留。多校开放前需先恢复选择入口并发布该界面版本，再执行以下流程。

完成上述准备后，平台管理员进入“管理 → 学校与校区”，新建学校、校区和地点，配置学校/校区管理员授权；目录摘要和地点/授权详情按需加载。切换到新校区，填写营业时间、价格、履约规则、客服及独立公告，再开启服务。学校注册审核政策在规则页由学校管理员或平台管理员设置，不能通过切换校区绕过。

“管理 → 服务范围与营业时间”中的 `enforceBusinessHours`（按营业时间限制发布与接单）默认关闭，旧配置缺少该字段时也关闭，适用于内测全天开放。有当前校区配置权限的超级管理员可开启，开启后前后端按北京时间的营业区间执行限制；服务总开关关闭时仍暂停新订单，已有订单继续履约。本次调整须同步更新 `mcloud` 云函数与小程序，未执行真实云配置写入。

这个过程不需要重新发布小程序或按学校复制云函数。目录目前有 5,000 条级别的防过量边界；接近该规模需改为搜索/分页目录并测量响应体。新增“打印”“排队”这种**新业务**仍需增加前后端插件和表单并发版；文件交付、商家结算等新增生命周期能力也需要扩展核心，不能只配置一个名称。

## 6. 真实云端验收与放量

以下目前全部待执行，必须记录环境 ID、运行时、函数版本/部署包哈希、数据库量级、账号角色、执行时间和结果。安全与一致性检查通过后再做容量测试；生产放量前保留一轮可恢复备份。

| 项目 | 执行与通过标准 |
| --- | --- |
| A/B/C 隔离 | 同校 A/B、另一学校 C；列表、详情、请求恢复、收藏、公告/已读、客服、配置、导出均只访问目标范围；无范围/伪造范围拒绝 |
| 客户端安全规则 | 普通小程序 SDK 直接 get/query/watch 订单、刷新信号、账号、迁移日志均被拒绝，所有直接写入被拒绝；合法云函数页面仍可工作 |
| 管理员授权 | 校区管理员无法操作另一校区；不能管理学校共享账号/审核政策；学校管理员只管理本校；授权撤回、账号停用即时生效；跨校区登录限流不重置 |
| 微信手机号登录 | AppID、手机号服务权限及额度有效；真实授权后强制补全必填资料；同校号码归属唯一；旧账号补授权；停用／待审／拒绝账号不能靠重登录放行 |
| 校区切换 | 恢复内测隐藏的选择器 UI 后，验证 A/B 快速切换、请求延迟返回、切换学校重新登录；旧响应不覆盖新范围，未确认请求切回原校区后仍可核对 |
| 争抢与状态竞争 | 多账号同一订单并发接取，恰好一人成功；事件、配额、通知一致；覆盖接单/取消/编辑、送达/确认、请求核对与延迟旧请求竞争 |
| 配置与插件 | 三种业务服务端校验/计价一致，规则快照不随后续改价变化；时间限制关闭或未配置时全天开放，开启后按 UTC+8 执行，手动暂停仍有效；选择入口恢复后新校区不经发版即可配置并营业 |
| 真实索引与冷启动 | 公共列表各排序、个人订单、状态/加急/地点筛选、后台报表、公告/客服聚合、任务扫描逐项记录执行计划、扫描/返回比与冷/热延迟 |
| 定时任务 | 旧触发器已移除；两类 worker 分别运行，连续多批、异常最旧记录、时间预算中断后均能续跑；监控 backlog、最早待处理时间与失败数 |
| 微信订阅 | 真机授权、模板字段、收件人、实际投递和详情入口；无权限/额度用尽/网络异常终止或按预算重试，不影响已保存的站内通知 |
| 迁移与回滚 | 脱敏快照完整走 plan/apply/verify/finalize，再演练回滚与恢复；保持旧 ID、历史、请求记录；记录件数、关联抽样和备份验证 |
| 容量 | 依据目标峰值逐级增加真实并发，统计成功业务数、P50/P95/P99、超时、事务冲突、数据库读写/连接/索引成本、审核/OpenAPI额度、积压趋势 |

微信外部消息发送无法与数据库事务原子提交。发送成功但回执丢失后可能重试，不能承诺外部投递严格一次；站内通知和订单结果依靠事务/幂等保证。不要用“定时器执行成功”代替实际通知到达或积压清空检查。

验收后关闭 `TENANT_MIGRATION_ENABLED` 并删除/停用临时迁移函数，保存迁移审计与环境备份；按校区逐步开放服务。日常监控至少覆盖函数错误/超时、资源配额、数据库读写、最早到期任务年龄、通知 `failed/retry/sending` 数、事务冲突，以及 worker 的 `failed/cleanupFailed/hasMore/durationMs`。

## 7. 可复现的本地检查

```powershell
node --test --test-reporter=tap --test-timeout=10000 scripts/tests/*.test.js
node scripts/check-operations-sdk.cjs
node scripts/check-architecture-source.cjs
node scripts/check-miniprogram-pages.cjs
node scripts/check-miniprogram-compile.cjs --tools '微信开发者工具安装目录'
node scripts/build-operations-worker.cjs
node scripts/check-architecture-deployment.cjs '.tmp/deploy/本次生成目录'
git diff --check
```

依赖已安装时不必重复下载；首次安装使用锁文件 `npm ci --prefix cloudfunctions/mcloud --ignore-scripts --no-audit --no-fund`。SDK 冒烟通过拦截真实已安装 SDK 的底层请求进行，不访问网络；本地事务替身、编译及部署包校验均不能替代第 6 节真实云端验收。
