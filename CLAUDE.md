# FBIF 2026 观众注册系统

## 项目概述

FBIF 食品创新展 2026 观众注册表单系统。单页表单应用，支持行业观众和消费者两种角色注册，数据异步同步到飞书多维表格。

## 项目结构

```
fbif-2026-registration/
├── apps/
│   ├── web/          # React 前端 (Vite + TypeScript)
│   ├── api/          # Express 后端 (Prisma + BullMQ)
│   └── mock-api/     # Mock API (本地开发用)
├── docs/             # 部署/运维/性能/规范文档
├── tests/            # K6 负载测试脚本
├── scripts/
│   ├── remote-deploy.sh            # 蓝绿部署脚本 (服务器端执行)
│   ├── rollback-production.sh      # 生产回滚
│   ├── bootstrap-server.sh         # 新服务器一键初始化
│   ├── update-backend-env.sh       # 环境变量管理 (CI 共享)
│   ├── install-nginx-remote.sh     # Nginx 安装脚本
│   ├── post-deploy-verify.sh       # 部署后验证
│   └── report-deploy-drift.sh      # 部署漂移检测
├── deploy/
│   └── Caddyfile.template          # Caddy HTTPS 反向代理模板
├── docker-compose.yml              # 本地开发 (Postgres + Redis)
├── docker-compose.production.yml   # 生产/preview 统一编排 (API + Postgres + Redis)
├── docker-compose.nginx.yml        # Nginx 配置
└── .github/workflows/
    ├── deploy-aliyun.yml           # 生产部署 (手动 dispatch, 蓝绿发布)
    ├── deploy-preview.yml          # Preview 部署 (push to main 自动触发)
    ├── backfill-feishu-metadata.yml # 飞书元数据回填 (手动)
    └── install-nginx.yml           # Nginx 安装 (手动)
```

## 技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 前端 | React + TypeScript + Vite | 18.3 / 5.5 / 5.4 |
| 后端 | Express + Prisma ORM | 4.19 / 5.19 |
| 队列 | BullMQ + ioredis | 5.16 / 5.4 |
| 数据库 | PostgreSQL + Redis | 16 / 7 |
| 安全 | helmet + csurf + express-rate-limit + zod | - |
| 监控 | prom-client (Prometheus) + pino | 15.1 / 9.3 |
| 反向代理 | Caddy (HTTPS 自动证书 + 静态文件服务) | - |
| 外部服务 | 飞书多维表格 API、阿里云 OSS、身份证验证 (阿里云市场) | - |

## 服务器信息

| 项目 | 值 |
|------|-----|
| 服务器 IP | 121.40.214.5 (生产 + preview 共用) |
| SSH 别名 | `aliyun-prod-real` |
| 主机名 | iZbp1dsk453uiw7uof8i1dZ |
| 系统 | Ubuntu Linux 6.8.0-100-generic |
| 内存 | 7.1 GB |
| 磁盘 | 40 GB |

> 注意：`aliyun-prod` 别名指向另一台服务器 (112.124.103.65)，不是本项目的服务器。操作本项目服务器必须使用 `aliyun-prod-real`。

## 部署架构

同一台服务器 (121.40.214.5) 运行生产和 preview 两套环境。当前架构中 **Caddy 负责 HTTPS 与静态文件**，生产 API 通过 **主机 Nginx（非容器）** 转发：

```
生产环境:
  [客户端] → Caddy (HTTPS, fbif2026ticket.foodtalks.cn)
               ├─ /assets/* → 静态文件 (/var/www/fbif-form) [30天缓存]
               ├─ /* → 静态文件 (SPA fallback) [no-store]
               └─ /api/*, /health → reverse_proxy localhost:3001
                                     └─ Nginx (host service, port 3001)
                                          └─ /api/* → active slot (blue=8080, green=18080)
                                               └─ Docker API 容器 (蓝绿部署)
                                                    ├─→ [PostgreSQL 16]
                                                    └─→ [Redis 7]

Preview 环境:
  [开发者] → Caddy (HTTPS, fbif2026ticket2.foodtalks.cn / :3003)
               ├─ /assets/* → 静态文件 (/var/www/fbif-form-staging) [30天缓存]
               ├─ /* → 静态文件 (SPA fallback) [no-store]
               └─ /api/* → reverse_proxy localhost:8083
                             └─ Docker API 容器 (fbif-form-staging-api-1)
                                  ├─→ [PostgreSQL 16] (独立实例)
                                  └─→ [Redis 7] (独立实例)
```

### 前端部署
- **无 NGINX 容器** — Caddy 直接服务静态文件（Nginx 为主机服务，仅用于生产 API 网关）
- 静态文件目录: `/var/www/fbif-form` (生产) / `/var/www/fbif-form-staging` (preview)
- 缓存: `/assets/` 30 天 immutable, `/` no-store
- 生产域名: `fbif2026ticket.foodtalks.cn`
- Preview 域名: `fbif2026ticket2.foodtalks.cn` (也可通过 `:3003` 直连)

### 后端部署
- 生产容器: `fbif-form-api-blue` / `fbif-form-api-green` (蓝绿部署)
- Preview 容器: `fbif-form-staging-api-1`
- 蓝绿端口: blue=8080, green=18080
- 入口: `/entrypoint.sh` (自动执行 Prisma 迁移 + 启动 Worker)
- Docker: node:20-bookworm (Prisma 需要 OpenSSL)
- 健康检查: HTTP GET `/health`

### 数据库
- 生产: `fbif-form-postgres-1`, 用户 `fbif`, 数据库 `fbif_form`
- Preview: `fbif-form-staging-postgres-1`, 数据库 `fbif_form_staging`
- Redis: 各自独立实例, AOF 持久化

## 关键文件

| 文件 | 用途 |
|------|------|
| `apps/web/src/App.tsx` | 主表单组件 (~2,760 行, 单组件包含全部表单逻辑) |
| `apps/web/src/styles.css` | 样式文件 (~3,666 行) |
| `apps/api/src/server.ts` | Express 服务器 (路由注册 + 中间件) |
| `apps/api/src/config/env.ts` | 环境变量配置 |
| `apps/api/src/routes/submissions.ts` | 表单提交路由 |
| `apps/api/src/routes/csrf.ts` | CSRF token 路由 |
| `apps/api/src/routes/oss.ts` | OSS 上传签名路由 |
| `apps/api/src/routes/idVerify.ts` | 身份证验证路由 |
| `apps/api/src/worker.ts` | BullMQ 任务处理 (飞书同步 + 重试) |
| `apps/api/src/services/feishuService.ts` | 飞书多维表格 API 集成 |
| `apps/api/src/services/submissionService.ts` | 表单提交 CRUD + 加密 |
| `apps/api/src/services/ossPolicyService.ts` | 阿里云 OSS 上传签名 |
| `apps/api/src/services/idVerifyService.ts` | 身份证实名验证 |
| `apps/api/src/services/alertService.ts` | 飞书机器人告警 |
| `apps/api/src/services/bitableSelect.ts` | 多维表格字段映射 |
| `apps/api/src/queue/backpressure.ts` | 队列背压监控 |
| `apps/api/src/utils/crypto.ts` | AES-256 加密/解密 |
| `apps/api/src/utils/logger.ts` | 日志 (pino) |
| `apps/api/src/utils/retry.ts` | 重试工具 |
| `apps/api/src/middleware/rateLimit.ts` | 限流 (Redis 存储) |
| `apps/api/src/validation/submission.ts` | Zod 表单校验 |
| `apps/api/prisma/schema.prisma` | 数据模型 |
| `scripts/remote-deploy.sh` | 蓝绿部署脚本 (preflight/prepare/promote/rollback) |

## API 端点

| 端点 | 方法 | 用途 | 限流 |
|------|------|------|------|
| `/health` | GET | 健康检查 | 无 |
| `/metrics` | GET | Prometheus 指标 | 无 |
| `/api/csrf` | GET | 获取 CSRF token | 1200/min |
| `/api/submissions` | POST | 创建表单提交 | CSRF + 20/min burst |
| `/api/submissions/:id/status` | GET | 轮询提交状态 | 无 |
| `/api/oss/policy` | POST | 获取 OSS 上传策略 | CSRF + burst |
| `/api/id-verify` | POST | 身份证验证 | CSRF + burst |

## 数据模型 (Prisma)

**Submission** 模型:
- 身份: `role` (industry/consumer), `idType` (7 种证件类型)
- 表单: name, title, company, phoneEnc(加密), phoneHash, idEnc(加密), idHash, businessType, department
- 归因追踪: `clickId`, `clickIdSourceKey`, `trackingParams`, `trackingId`, `trackingIdType`
- 附件: `proofUrls` (JSONB 数组)
- 同步: `syncStatus` (PENDING->PROCESSING->RETRYING->SUCCESS/FAILED), syncAttempts, syncError, feishuRecordId
- 幂等: `clientRequestId` (唯一)
- 追踪: traceId, clientIp, userAgent

**索引**: clickId, clickIdSourceKey, phoneHash, idHash, (syncStatus+createdAt), nextAttemptAt

## 数据同步流程

```
用户提交表单
    |
POST /api/submissions (HTTP 202)
    |
PostgreSQL 存储 (syncStatus: PENDING)
    |
BullMQ 异步任务入队
    |
Worker 同步到飞书多维表格
    |
更新 syncStatus: SUCCESS/FAILED
```

### 可靠性保障
1. **数据库先写入** - 提交先存 PostgreSQL, 再异步同步
2. **幂等性** - `clientRequestId` 防止重复提交
3. **重试机制** - 失败最多重试 8 次，指数退避 + 队列背压感知
4. **孤儿扫描** - 定期检查遗漏任务 (SWEEP_PENDING_INTERVAL_MS)
5. **加密存储** - 手机号、身份证 AES-256 加密, 哈希索引用于去重
6. **告警通知** - 8 次重试仍失败时飞书机器人告警

## 前端架构

- **单页面应用**: 无路由库, 纯状态驱动 UI 切换
- **表单流程**: 角色选择 -> 条件表单 -> 附件上传 (OSS) -> 可选身份验证 -> 提交 -> 成功页
- **草稿保存**: localStorage (`fbif_form_draft_v2`) 自动保存
- **角色区分**: 行业观众 (10 种业务类型, 7 种部门) / 消费者
- **证件类型**: 身份证、港澳居民来往内地通行证、台湾居民来往大陆通行证、护照、外国人永久居留身份证、港澳台居住证、其他
- **手机号**: 支持 88 个国家/地区区号
- **广告归因**: 支持腾讯广告等渠道的 click_id 追踪

## CI/CD

### Preview 部署 (`.github/workflows/deploy-preview.yml`)
- 触发: **push to main 自动触发** + 手动 dispatch
- 目标: 121.40.214.5
- 静态文件: `/var/www/fbif-form-staging`
- API: `fbif-form-staging` Docker 项目, 端口 8083
- 预览蓝绿临时槽位: API `28080/28081`, Nginx `3101/3102`（仅部署过程使用，避免与生产冲突）
- 数据库: `fbif_form_staging`
- 飞书来源标记: "测试环境"
- Preview 地址: `https://fbif2026ticket2.foodtalks.cn` 或 `http://121.40.214.5:3003`

### 生产部署 (`.github/workflows/deploy-aliyun.yml`)
- 触发: **手动 workflow_dispatch** (需输入 "deploy" 确认, 支持 dry-run 模式)
- 目标: 121.40.214.5
- 静态文件: `/var/www/fbif-form`
- API: 蓝绿部署 (blue=8080, green=18080), 通过 `remote-deploy.sh` 管理
- 部署流程: preflight -> prepare -> promote (含自动回滚窗口 180s)
- 回滚条件: 连续 3 次健康检查失败 / 5xx > 6 / 超时 > 6 / 提交成功率 < 85%
- 域名: `https://fbif2026ticket.foodtalks.cn`
- 发布前门禁: 远程 preflight 会阻止 staging 占用 `8080/18080`、阻止 staging nginx 站点混入、校验生产 Caddy 上游固定为 `localhost:3001`

### 端口隔离门禁（必须通过）

1. 生产域名 API 必须经 `localhost:3001`，禁止直连 `localhost:8080`
2. `fbif-form-staging-api-(blue|green)` 禁止绑定 `127.0.0.1:8080/18080`
3. `/etc/nginx/sites-enabled` 禁止出现 `fbif-form-staging*`
4. 生产发布前必须跑：

```bash
ssh aliyun-prod-real \
  'APP_DIR=/opt/web-fbif-form STATIC_DIR=/var/www/fbif-form API_PORT=8080 PRIMARY_WEB_PORT=3001 CANDIDATE_WEB_PORT=3002 NGINX_SITE_NAME=fbif-form COMPOSE_PROJECT_NAME=fbif-form BLUE_API_PORT=8080 GREEN_API_PORT=18080 bash -s -- preflight' \
  < scripts/remote-deploy.sh
```

### 串线应急（止血）

当出现“生产域名命中测试 API（例如 CORS 为 `http://121.40.214.5:3003`）”时：

1. 先快照 `/etc/caddy/Caddyfile`、`/etc/nginx/sites-enabled`、`docker ps` 到时间戳目录
2. 确保生产数据面：拉起 `fbif-form-postgres-1` 与 `fbif-form-redis-1`
3. 释放生产端口：移除 `fbif-form-staging-api-blue/green`
4. 生产 API 回归：`fbif-form-api-*` 绑定 `127.0.0.1:8080/18080`
5. 按生产蓝绿流程重新执行 `preflight -> prepare -> promote`

完整步骤见 `docs/production-port-isolation-runbook.md`

### 其他 Workflow
- `backfill-feishu-metadata.yml` - 飞书元数据回填 (手动, 支持 dry-run)
- `install-nginx.yml` - 生产服务器 Nginx 安装 (手动)

## 环境变量

### 前端 (`apps/web/.env`)
| 变量 | 说明 |
|------|------|
| `VITE_API_URL` | API 地址 (默认 http://localhost:8080) |
| `VITE_SYNC_TIMEOUT_MS` | 同步超时 (默认 30000) |

### 后端关键变量 (`apps/api/.env`)
| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | PostgreSQL 连接串 |
| `REDIS_URL` | Redis 连接串 |
| `DATA_KEY` | AES-256 加密密钥 (32 字节 base64) |
| `DATA_HASH_SALT` | 哈希盐值 |
| `FEISHU_APP_ID` / `FEISHU_APP_SECRET` | 飞书应用凭证 |
| `FEISHU_APP_TOKEN` / `FEISHU_TABLE_ID` | 多维表格标识 |
| `FEISHU_ALERT_WEBHOOK` | 告警 Webhook |
| `FEISHU_ALERT_ENABLED` | 是否启用告警 |
| `FEISHU_FIELD_SOURCE` | 飞书"数据来源"列名 |
| `FEISHU_SUBMISSION_SOURCE` | 来源标记值 (生产 "正式环境" / 测试 "测试环境") |
| `FEISHU_FIELD_CLICK_ID` | 飞书 click_id 列名 |
| `FEISHU_FIELD_TRACKING_*` | 广告归因追踪字段映射 |
| `OSS_ACCESS_KEY_ID` / `OSS_BUCKET` / `OSS_REGION` | 阿里云 OSS |
| `ID_VERIFY_ENABLED` / `ID_VERIFY_APPCODE` | 身份证验证 |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | 限流配置 |
| `FEISHU_SYNC_ATTEMPTS` | 同步最大重试次数 (默认 8) |
| `FEISHU_WORKER_CONCURRENCY` / `FEISHU_WORKER_QPS` | Worker 并发配置 |
| `RUN_DB_MIGRATE` / `RUN_WORKER` | Docker 入口开关 |

完整列表见 `apps/api/.env.example`

## 常用命令

```bash
# === 本地开发 ===
cd apps/web && npm run dev          # 前端开发服务器 (:5173)
cd apps/api && npm run dev          # 后端开发服务器
docker compose up -d                # 启动本地 Postgres + Redis

# === 构建 ===
cd apps/web && npm run build        # 构建前端
cd apps/api && npm run build        # 构建后端

# === 测试 ===
cd apps/web && npm test             # 前端测试 (vitest)
cd apps/api && npm test             # 后端测试 (node:test + supertest)

# === SSH 连接 (注意用 aliyun-prod-real) ===
ssh aliyun-prod-real

# === 生产日志 ===
ssh aliyun-prod-real "docker logs fbif-form-api-blue --tail 100"
ssh aliyun-prod-real "docker logs fbif-form-api-blue --tail 100 2>&1 | grep -i error"

# === Preview 日志 ===
ssh aliyun-prod-real "docker logs fbif-form-staging-api-1 --tail 100"

# === 数据库 ===
ssh aliyun-prod-real "docker exec -it fbif-form-postgres-1 psql -U fbif -d fbif_form"

# === 查看容器状态 ===
ssh aliyun-prod-real "docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'"
```

## 文档索引 (`docs/`)

| 文档 | 内容 |
|------|------|
| `deploy-guide.md` | 部署指南 |
| `release-flow.md` | 发布流程 |
| `repo-deploy-truth-map.md` | 仓库部署真相图 |
| `repo-environment-model.md` | 环境模型 |
| `preview-spec.md` | Preview 环境规范 |
| `github-actions-deploy.md` | CI/CD 自动部署 |
| `production-port-isolation-runbook.md` | 端口隔离与串线止血手册 |
| `local-dev-environment.md` | 本地开发环境搭建 |
| `api.md` | API 接口规范 |
| `feishu-setup.md` | 飞书集成配置 |
| `aliyun-id-verify-integration.md` | 身份证验证接入 |
| `tencent-ads-attribution-spec.md` | 腾讯广告归因规范 |
| `runbook.md` | 运维操作手册 |
| `stability-assessment.md` | 系统稳定性评估 |
| `extreme-performance-report-2026-02-11.md` | 负载测试报告 (120 RPS 常规, 180 峰值) |
| `user-manual.md` | 用户使用手册 |

## 飞书告警系统

同步失败 (8 次重试后) 自动发送飞书机器人告警。

**配置:** `FEISHU_ALERT_WEBHOOK` + `FEISHU_ALERT_ENABLED=true`

**相关文件:** `apps/api/src/services/alertService.ts`, `apps/api/src/worker.ts`

## 两套环境对比

| 项目 | 生产 | Preview |
|------|------|---------|
| 域名 | `fbif2026ticket.foodtalks.cn` | `fbif2026ticket2.foodtalks.cn` / `:3003` |
| 静态文件 | `/var/www/fbif-form` | `/var/www/fbif-form-staging` |
| API 端口 | 8080 (蓝绿: 8080/18080) | 8083 |
| 蓝绿临时端口 | Nginx 3001/3002 | Nginx 3101/3102, API 28080/28081 |
| Docker 项目名 | `fbif-form` | `fbif-form-staging` |
| 服务器路径 | `/opt/web-fbif-form/` | `/opt/web-fbif-form-staging/` |
| 数据库 | `fbif_form` | `fbif_form_staging` |
| 飞书来源 | "正式环境" | "测试环境" |
| 部署方式 | 手动 dispatch + 蓝绿发布 | push to main 自动 |

两套环境完全隔离，共用同一张飞书表 `tbl0CQ74guMS1IDd`，依赖 `FEISHU_SUBMISSION_SOURCE` 区分来源。

## 开发工作流规范（必须遵守）

**只维护 `main` 分支。Push to main 自动部署到 preview 环境，用户确认后手动触发生产部署。**

### 标准流程

```
1. 在功能分支上开发/修改代码 (feat/xxx 或 fix/xxx)
2. 创建 PR 合并到 main 分支
3. 合并后自动触发 preview 部署
4. 将预览链接返回给用户，等待用户确认
   - Preview: https://fbif2026ticket2.foodtalks.cn
5. 用户确认后，在 GitHub Actions 手动触发 Deploy To Aliyun 部署生产
6. 确认生产部署成功: https://fbif2026ticket.foodtalks.cn
```

### 规则

1. **push to main 自动触发 preview 部署** — 每次合并后自动预览
2. **每次 preview 部署后必须返回预览链接** — `https://fbif2026ticket2.foodtalks.cn`
3. **必须等待用户明确同意后才触发生产部署** — 不要自行决定
4. **生产部署需手动触发** — 在 GitHub Actions 页面运行 Deploy To Aliyun

### 常用 Git 操作

```bash
# 创建功能分支开发
git checkout -b feat/xxx

# 提交并推送功能分支
git add . && git commit -m "feat: 描述" && git push origin feat/xxx

# 创建 PR 合并到 main（合并后自动触发 preview 部署）

# 用户确认后，在 GitHub Actions 手动触发生产部署
```

## 服务器迁移

迁移到新服务器只需 5 步:

```bash
# 1. 初始化新服务器 (安装 Docker + Caddy)
ssh root@new-server 'bash -s' < scripts/bootstrap-server.sh

# 2. 复制密钥
scp old-server:/opt/web-fbif-form/shared/backend.env new-server:/opt/web-fbif-form/shared/backend.env

# 3. 配置 Caddy HTTPS
ssh new-server "cp deploy/Caddyfile.template /etc/caddy/Caddyfile && systemctl restart caddy"

# 4. 更新 GitHub Secrets: ALIYUN_HOST, ALIYUN_SSH_KEY

# 5. 推送代码触发 CI 自动部署
```

## 数据库迁移规则

**正式环境的 Prisma 迁移必须是向后兼容的**：
- 只加列（带默认值）、只加表、只加索引
- 破坏性变更（删列、重命名、改类型）必须在单独维护窗口执行，与应用部署解耦
- 部署脚本在容器启动时自动执行 `prisma migrate deploy`，不兼容的迁移会导致旧代码报错

## 待办事项

- [x] 增加数据同步失败告警 (飞书机器人通知)
- [x] 添加 preview 预览环境
- [x] 部署安全加固（蓝绿发布 + 自动回滚 + 健康检查）
- [x] 腾讯广告归因追踪
- [ ] 添加管理后台查看失败记录
- [ ] 定期数据对账脚本
