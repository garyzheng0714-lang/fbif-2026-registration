# FBIF 2026 观众注册系统

## 项目概述

FBIF 食品创新展 2026 观众注册表单系统。单页表单应用，支持行业观众和消费者两种角色注册，数据异步同步到飞书多维表格。

## 项目结构

```
web-fbif-form/
├── apps/
│   ├── web/          # React 前端 (Vite + TypeScript)
│   ├── api/          # Express 后端 (Prisma + BullMQ)
│   └── mock-api/     # Mock API (本地开发用)
├── docs/             # 部署/运维/性能文档
├── tests/            # K6 负载测试脚本
├── scripts/          # 工具脚本 (local-stack, preview-manager)
├── docker-compose.yml           # 本地开发 (Postgres + Redis)
├── docker-compose.backend.yml   # 生产后端 (API + Postgres + Redis)
└── .github/workflows/deploy-aliyun.yml  # CI/CD
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
| 外部服务 | 飞书多维表格 API、阿里云 OSS、身份证验证 (阿里云市场) | - |

## 服务器信息

| 项目 | 值 |
|------|-----|
| 阿里云公网 IP | 112.124.103.65 |
| SSH 别名 | `aliyun-prod` |
| 主机名 | iZbp17qedrmdkhpr80coo4Z |
| 系统 | Ubuntu Linux 6.8.0-78-generic |
| 内存 | 3.4 GB |
| 磁盘 | 40 GB |

## 部署架构

```
[客户端] → Caddy (HTTPS) → NGINX (静态文件, :3001) → [后端 Docker 容器, :8080]
                                                    │
                                                    ├─→ [PostgreSQL 16] (Docker)
                                                    └─→ [Redis 7] (Docker)
```

### 前端部署
- 路径: `/opt/web-fbif-form/web-current` (symlink → `/opt/web-fbif-form/web-releases/<timestamp>/`)
- 服务: NGINX at port 3001, SPA 路由 (所有请求 → index.html)
- 缓存: `/assets/` 30 天 immutable, `/` no-store
- 域名: `fbif2026ticket.foodtalks.cn`
- Docker: nginx:1.27-alpine, 健康检查 `/healthz`

### 后端部署
- 容器: `fbif-form-backend-api-1`
- 端口: 127.0.0.1:8080
- 网络: `edge` (对外) + `private` (内部)
- 入口: `/entrypoint.sh` (自动执行 Prisma 迁移 + 启动 Worker)
- Docker: node:20-bookworm (全镜像, Prisma 需要 OpenSSL)
- 健康检查: HTTP GET `/health`

### 数据库
- PostgreSQL: `fbif-form-backend-postgres-1`, 用户 `fbif`, 数据库 `fbif_form`
- Redis: `fbif-form-backend-redis-1`, AOF 持久化

## 关键文件

| 文件 | 用途 |
|------|------|
| `apps/web/src/App.tsx` | 主表单组件 (~2,460 行, 单组件包含全部表单逻辑) |
| `apps/web/src/styles.css` | 样式文件 (~3,020 行) |
| `apps/api/src/server.ts` | Express 服务器 (路由 + 中间件) |
| `apps/api/src/worker.ts` | BullMQ 任务处理 (飞书同步 + 重试) |
| `apps/api/src/services/feishuService.ts` | 飞书多维表格 API 集成 |
| `apps/api/src/services/submissionService.ts` | 表单提交 CRUD + 加密 |
| `apps/api/src/services/ossPolicyService.ts` | 阿里云 OSS 上传签名 |
| `apps/api/src/services/idVerifyService.ts` | 身份证实名验证 |
| `apps/api/src/services/alertService.ts` | 飞书机器人告警 |
| `apps/api/src/services/bitableSelect.ts` | 多维表格字段映射 |
| `apps/api/src/queue/backpressure.ts` | 队列背压监控 |
| `apps/api/src/utils/crypto.ts` | AES-256 加密/解密 |
| `apps/api/src/middleware/rateLimit.ts` | 限流 (Redis 存储) |
| `apps/api/src/validation/submission.ts` | Zod 表单校验 |
| `apps/api/prisma/schema.prisma` | 数据模型 |
| `apps/api/docker/entrypoint.sh` | Docker 入口脚本 |

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
- 表单: name, title, company, phone, idNumber(加密), businessType, department
- 附件: `proofUrls` (JSON 数组)
- 同步: `syncStatus` (PENDING→PROCESSING→RETRYING→SUCCESS/FAILED), syncAttempts, feishuRecordId
- 幂等: `clientRequestId` (唯一)
- 追踪: traceId, clientIp, userAgent

**索引**: phoneHash, idHash, (syncStatus+createdAt), nextAttemptAt

## 数据同步流程

```
用户提交表单
    ↓
POST /api/submissions (HTTP 202)
    ↓
PostgreSQL 存储 (syncStatus: PENDING)
    ↓
BullMQ 异步任务入队
    ↓
Worker 同步到飞书多维表格
    ↓
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
- **表单流程**: 角色选择 → 条件表单 → 附件上传 (OSS) → 可选身份验证 → 提交 → 成功页
- **草稿保存**: localStorage (`fbif_form_draft_v2`) 自动保存
- **角色区分**: 行业观众 (10 种业务类型, 7 种部门) / 消费者
- **证件类型**: 身份证、港澳居民来往内地通行证、台湾居民来往大陆通行证、护照、外国人永久居留身份证、港澳台居住证、其他
- **手机号**: 支持 88 个国家/地区区号

## CI/CD

**GitHub Actions** (`.github/workflows/deploy-aliyun.yml`):
- 触发: push to `main` / 手动 dispatch
- 并发: 单实例部署 (取消进行中的)
- 测试: PostgreSQL 16 + Redis 7 服务容器
- 步骤: Node 20 → Prisma 迁移 → API 测试 → Web 构建 → 打包 → SSH 部署到阿里云
- 超时: 45 分钟

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
| `OSS_ACCESS_KEY_ID` / `OSS_BUCKET` / `OSS_REGION` | 阿里云 OSS |
| `ID_VERIFY_ENABLED` / `ID_VERIFY_APPCODE` | 身份证验证 |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | 限流配置 |
| `FEISHU_SYNC_ATTEMPTS` | 同步最大重试次数 (默认 8) |
| `FEISHU_WORKER_CONCURRENCY` / `FEISHU_WORKER_QPS` | Worker 并发配置 |
| `RUN_DB_MIGRATE` / `RUN_WORKER` | Docker 入口开关 |

完整列表见 `apps/api/.env.example` (76+ 变量)

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

# === SSH 连接 ===
ssh aliyun-prod

# === 生产日志 ===
ssh aliyun-prod "docker logs fbif-form-backend-api-1 --tail 100"
ssh aliyun-prod "docker logs fbif-form-backend-api-1 --tail 100 2>&1 | grep -i error"

# === 数据库 ===
ssh aliyun-prod "docker exec -it fbif-form-backend-postgres-1 psql -U fbif -d fbif_form"

# === 前端部署 (手动) ===
cd apps/web && npm run build && \
TIMESTAMP=$(date +%Y%m%d%H%M%S) && \
scp -r dist aliyun-prod:/opt/web-fbif-form/web-releases/${TIMESTAMP} && \
ssh aliyun-prod "cd /opt/web-fbif-form && rm -f web-current && ln -s /opt/web-fbif-form/web-releases/${TIMESTAMP} web-current"

# === 后端部署 (Docker) ===
ssh aliyun-prod "cd /opt/web-fbif-form/backend && docker compose -f docker-compose.backend.yml up -d --build"
```

## 文档索引 (`docs/`)

| 文档 | 内容 |
|------|------|
| `deployment.md` | 完整生产部署指南 |
| `deployment-nginx-docker.md` | Nginx + Docker 部署 |
| `github-actions-deploy.md` | CI/CD 自动部署 |
| `local-dev-environment.md` | 本地开发环境搭建 |
| `api.md` | API 接口规范 |
| `feishu-setup.md` | 飞书集成配置 |
| `aliyun-id-verify-integration.md` | 身份证验证接入 |
| `runbook.md` | 运维操作手册 |
| `stability-assessment.md` | 系统稳定性评估 |
| `extreme-performance-report-2026-02-11.md` | 负载测试报告 (120 RPS 常规, 180 峰值) |
| `user-manual.md` | 用户使用手册 |

## 飞书告警系统

同步失败 (8 次重试后) 自动发送飞书机器人告警。

**配置:** `FEISHU_ALERT_WEBHOOK` + `FEISHU_ALERT_ENABLED=true`

**相关文件:** `apps/api/src/services/alertService.ts`, `apps/api/src/worker.ts`

## 待办事项

- [x] 增加数据同步失败告警 (飞书机器人通知)
- [ ] 添加管理后台查看失败记录
- [ ] 定期数据对账脚本
