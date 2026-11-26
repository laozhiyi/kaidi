# 协作规范

本规范适用于所有参与云速取开发的人。`npm test` 里的 `repo-hygiene.test.js` 会自动检查其中的文件规则。规则不满足时测试失败，不能推送。

## 一、多人协作流程

所有人都在 `main` 上开发和提交，不新开分支，不走 Pull Request。`main` 始终保持可运行、可部署的状态，推送前必须拉取最新代码并跑通检查。

```bash
# 1. 开始改动前，先拿到最新代码
git checkout main
git pull --rebase origin main

# 2. 开发、提交（一次提交只做一件事）
git add -A
git status                              # 提交前看一眼：没有日志、截图、密钥
git commit -m "订单列表支持按校区导出"

# 3. 推送前同步别人刚推送的改动，并跑检查
git pull --rebase origin main
npm.cmd test --prefix cloudfunctions/mcloud
node scripts/check-miniprogram-pages.cjs   # 改了页面、组件时
git push origin main
```

- **冲突**：`git pull --rebase` 时如果出现冲突，先解决冲突文件，再执行 `git add <文件>` 和 `git rebase --continue`。拿不准的冲突找改过该文件的同事确认，不要直接用自己的版本覆盖。
- **稳定版本**：经过真机验收的版本，在 `main` 上打标签：`git tag -a baseline-YYYY-MM-DD -m "说明"`，再执行 `git push origin baseline-YYYY-MM-DD`。用 `git tag` 可以查看所有标签。
- **回退**：想看旧版本，执行 `git checkout <标签>`。要撤销 `main` 上已推送的某次提交，用 `git revert <提交号>` 生成反向提交，**不要**对 `main` 执行 `reset --hard` 或 `push --force`，否则会抹掉别人的提交。
- **云端部署**：推送到 `main` 不等于已经部署。改了 `cloudfunctions/mcloud` 要重新上传云函数；改了 `miniprogram/` 要重新编译上传。数据库规则、索引、环境变量的变化要写进提交说明，并按 [部署手册](docs/DEPLOYMENT.md) 执行。

## 二、哪些文件可以提交

仓库只放「别人拉下来就能用」的东西。

| 位置 | 内容 |
| --- | --- |
| `miniprogram/` | 小程序源码 |
| `cloudfunctions/` | 云函数源码（不含 `node_modules` 和打包副本） |
| `scripts/` | 检查脚本、回归测试、测试夹具、预览工具 |
| `deployment/` | 数据库安全规则、索引清单等部署配置（只放 JSON 等配置，不放说明文档） |
| `docs/` | 维护文档（见下文第三节） |
| `.github/` | 自动检查配置 |
| 根目录 | `README.md`、`CONTRIBUTING.md`、`AGENTS.md`、`CLAUDE.md`、`.gitignore`、`project.config.json` |

`AGENTS.md` 是给 AI 编程助手看的仓库规则（Codex、Cursor、Copilot 等直接读取）。`CLAUDE.md` 只有一行 `@AGENTS.md`，让 Claude Code 读取同一份规则；改规则只改 `AGENTS.md`。

**不能提交**的内容已写进 [.gitignore](.gitignore)，主要有：

- **密钥与个人配置**：`project.private.config.json`、证书私钥（`pem/`、`*.pem`、`*.p12`、`*.key`）、`.env`。只提交模板 `.env.example`。密钥一旦提交，即使删除也会留在历史里，必须到平台轮换。
- **临时产物**：测试日志、截图、调试快照、预览 HTML、打包副本。统一放在 `.tmp/`，这个目录整体不提交。
- **本地工具与笔记**：`node_modules/`、AI 助手目录（`.claude/`、`.workbuddy/`、`.ccgui/`）、个人规划笔记 `.planning/`。

需要在根目录新增文件或目录时，先在提交说明里写明原因，同时更新本节和 `scripts/tests/repo-hygiene.test.js` 的白名单。

## 三、文档怎么写

文档只描述**系统现在是怎么工作的**，不记录「做了什么、怎么排查的」。

| 内容 | 放在哪里 |
| --- | --- |
| 功能行为、接口、配置、部署步骤、排错表 | `docs/` 里对应模块的文档，改代码时在同一次提交里更新 |
| 这次改了什么、为什么改 | 提交说明（commit message） |
| 排查过程、测试报告、修复总结、方案草稿 | 提交说明或 GitHub Issue；个人草稿放 `.tmp/` 或 `.planning/`（不提交） |
| 待办、已知问题 | GitHub Issue |

具体规则：

1. **一个模块一份文档**，放在 `docs/` 下，并在 README 的「维护文档」表里登记。新增模块文档前先看能否并入已有文档。
2. **直接修改原文，不要追加**。行为变了就改写对应段落；不要在末尾加「2026-xx-xx 修复……」「本次……」「本轮……」这类段落。历史可以用 `git log -p docs/xxx.md` 查到。
3. **功能删除时，同时删除或改写相关文档**，不要留下描述已不存在功能的内容。
4. 文档中不写临时状态（例如「尚未上传」「未执行真机验收」），这些写在提交说明里。
5. 数值、版本、标记名尽量指向代码出处（例如「以 `package.json` 为准」），避免文档和代码对不上。

自动检查会拒绝：根目录或 `docs/` 以外的说明文档、README 未登记的 `docs/` 文档、带日期的过程段落，以及「本轮」「按用户要求」「尚未上传」等过程用语。

## 四、提交说明

- 提交说明使用简洁的中文，说清楚改了什么，例如 `完善微信登录、手机号验证与雁山校区内测`。一次提交只做一件事。
- 改动较大时在提交说明正文里写明：影响的流程、做过的检查、是否需要重新上传云函数或小程序、是否改了数据库集合、安全规则、索引或环境变量。
- 涉及登录授权、支付、订阅消息等微信平台能力的改动，要在目标云环境的真机上验证。
