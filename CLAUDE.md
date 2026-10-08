# FBIF 2026 观众注册系统

## 定位与权威边界

这是 FBIF 2026 观众注册系统的现役仓库。前端接收行业观众和消费者报名；API 先写 PostgreSQL，再通过 BullMQ 异步同步飞书多维表格；附件走 OSS 直传。

- 本地现役副本：当前目录。
- GitHub 主仓库：`fbif-2026-registration`；`main` 是唯一部署分支。
- `归档/fbif-2026-registration` 与 `归档/web-fbif-form` 是冻结快照，只能用于考古，不得从那里开发、部署或维护文档。
- 仓库、环境和端口的最终解释以 `docs/repo-deploy-truth-map.md` 与当前 workflow/脚本为准；README 只提供入口。

## 不可破坏的规则

1. 不得把姓名、手机号、证件号、报名明细或真实请求载荷写进 Markdown、测试快照、截图文件名或日志样例。
2. 不得提交 `.env*`、数据库口令、飞书/OSS/身份证验证凭据、Webhook、Cookie 或 token。示例只写变量名或明显占位符。
3. `POST /api/submissions` 的 `202` 只表示“已落库并受理”，不代表飞书已同步；最终状态必须查 `GET /api/submissions/:id/status`。
4. `clientRequestId` 是提交幂等键；不要移除唯一约束或绕过既有去重逻辑。
5. 手机号和证件号必须继续加密存储，并保留哈希索引用于匹配；不要把明文加入新字段或结构化日志。
6. Production 和 Preview 必须使用不同端口、Docker 项目名与数据库。Preview 容器不得占用生产 `8080/18080`，生产域名 API 必须经主机 `3001` 网关。
7. Push 到 `main` 只自动更新 Preview。没有用户明确确认，不得触发生产 workflow、改生产 DNS/CDN、迁移生产数据或清理生产队列。
8. Prisma 生产迁移必须向后兼容。删列、改名、改类型等破坏性迁移只能在独立维护窗口执行。
9. 本仓库可能含未提交业务改动或本地 worktree；先读 `git status`，只改任务涉及的文件，不回退他人修改。

## 结构与关键入口

| 路径 | 职责 |
| --- | --- |
| `apps/web/src/App.tsx` | 单页报名流程、归因参数、提交与成功页 |
| `apps/web/src/styles.css` | 现役页面样式 |
| `apps/api/src/server.ts` | Express 中间件、健康检查与路由注册 |
| `apps/api/src/config/env.ts` | 后端环境变量校验真身 |
| `apps/api/src/validation/submission.ts` | 报名载荷校验 |
| `apps/api/src/services/submissionService.ts` | 入库、加密与幂等 |
| `apps/api/src/services/feishuService.ts` | 飞书字段映射与写入 |
| `apps/api/src/worker.ts` | 队列消费、重试与最终状态 |
| `apps/api/src/queue/backpressure.ts` | 队列压力与延迟入队 |
| `apps/api/prisma/schema.prisma` | 数据模型真身 |
| `apps/api/ecosystem.config.cjs` | PM2：3 个 API 实例和可选 worker |
| `scripts/remote-deploy.sh` | 蓝绿发布、门禁、提升与回滚 |
| `.github/workflows/deploy-preview.yml` | `main` 推送后自动更新 Preview |
| `.github/workflows/deploy-aliyun.yml` | 人工触发生产发布 |

## 数据与接口不变量

- API：`GET /health`、`GET /metrics`、`GET /api/csrf`、`POST /api/oss/policy`、`POST /api/id-verify`、`POST /api/submissions`、`GET /api/submissions/:id/status`。
- 同步状态：`PENDING → PROCESSING → SUCCESS`；可重试失败经过 `RETRYING`，最终不可恢复才进入 `FAILED`。
- 入队失败不能拖延已经成功的 `202` 响应；后台会记录错误并依赖扫描/重试机制恢复。
- 飞书字段名可以由环境变量映射；改字段时必须同时核对代码、共享 Base、Preview/Production 配置及 `docs/feishu-setup.md`。
- 腾讯广告点击参数的优先级和落库/飞书字段以 `docs/tencent-ads-attribution-spec.md` 为准。
- 前端表单、后端 Zod、Prisma schema、飞书字段映射四层必须一起演进；只改一层会制造静默丢字段。

## 本地命令

```bash
# 基础依赖
docker compose up -d

# API
cd apps/api
cp .env.example .env
npm ci
npm run prisma:migrate
npm run dev
npm test
npm run build

# Web
cd apps/web
cp .env.example .env
npm ci
npm run dev
npm test
npm run build

# 一体化联调
node scripts/local-stack.mjs start
node scripts/local-stack.mjs status

# 生产编排静态校验
docker compose -f docker-compose.production.yml config --quiet
```

API 测试使用 Node test runner，Web 使用 Vitest。改动提交链路时至少覆盖无效输入、幂等、入库、状态查询和已有前端流程；纯文档整理仍需跑链接与命令存在性检查。

## 部署模型

- Production：Caddy 提供 HTTPS/静态文件，API 经主机 Nginx `3001` 转到蓝/绿槽位 `8080/18080`。
- Preview：Caddy `3003`，API 经独立网关和 `28080/28081` 临时槽位，不得复用生产槽位。
- API 镜像入口为 `/entrypoint-pm2.sh`：先执行可选 Prisma migrate，再由 `pm2-runtime` 启动 3 个 `fbif-api` cluster 实例和可选 `fbif-worker`。
- `scripts/remote-deploy.sh` 的 `preflight → prepare → promote` 是两套环境共同的发布骨架；不要手写一条旁路部署命令。
- 生产发布前必须通过端口隔离门禁；串线时按 `docs/production-port-isolation-runbook.md` 止血，不要现场猜端口或删除未知容器。
- CDN/ESA 是否已接管域名属于外部状态，不能仅凭仓库配置推断；启用、验收和回退按对应指南执行。

## 环境变量

以 `apps/api/src/config/env.ts`、`apps/api/.env.example` 和 workflow 为真身。文档只记分组，不复制值：

- 数据：`DATABASE_URL`、`REDIS_URL`、`DATA_KEY`、`DATA_HASH_SALT`、数据库连接池参数。
- 飞书：应用凭据、Base/Table 标识、字段映射、来源标识、worker 并发/QPS、重试与告警参数。
- OSS：访问凭据、Bucket/Region/Host、公开地址、上传前缀、大小/有效期/ACL。
- 身份验证：启用开关、服务地址、AppCode、超时与 token TTL。
- 网关与限流：`WEB_ORIGIN`、`TRUST_PROXY_HOPS`、全局/突发/CSRF 限流参数。
- 容器入口：`RUN_DB_MIGRATE`、`RUN_WORKER`。

新增或改名环境变量时同步更新 schema、`.env.example`、compose/workflow，以及对应 runbook；不得只改某一套部署环境。

## 文档入口

| 目的 | 文档 |
| --- | --- |
| 文档目录与权威关系 | `docs/README.md` |
| API 请求与响应 | `docs/api.md` |
| 本地联调 | `docs/local-dev-environment.md` |
| 仓库/环境真相 | `docs/repo-deploy-truth-map.md` |
| 发布流程 | `docs/release-flow.md` |
| GitHub Actions | `docs/github-actions-deploy.md` |
| 日常生产排障 | `docs/runbook.md` |
| 端口串线止血 | `docs/production-port-isolation-runbook.md` |
| 飞书字段 | `docs/feishu-setup.md` |
| 腾讯广告归因 | `docs/tencent-ads-attribution-spec.md` |
| CDN/ESA | `docs/cdn-setup-guide.md`、`docs/esa-migration-guide.html`、`docs/esa-production-cutover.html` |

## 协作流程

1. 开始前读 `git status --short`、相关源码、测试和上表中的权威文档。
2. 在功能分支做最小修改；不要把 `.claude/worktrees/` 或本地证据目录当作现役代码。
3. 本地测试、构建和 compose 静态校验通过后再提交 PR。
4. 合并 `main` 后验证 Preview；将真实验证结果与不确定项明确告诉用户。
5. 只有用户确认后才手动触发生产发布；发布后按 workflow/Runbook 验证健康、CSRF、静态资源和报名受理链路。

长期未排期事项统一放在 `TODOS.md`；临时执行计划完成或失效后应删除，不能把 CLAUDE.md、README 或 `docs/` 当任务流水账。
