# FBIF 2026 观众注册系统

## 项目概述

FBIF 食品创新展 2026 观众注册表单系统，包含前端和后端。

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 18 + TypeScript + Vite |
| 后端 | Express + Prisma ORM + BullMQ |
| 数据库 | PostgreSQL 16 |
| 队列 | Redis 7 + BullMQ |
| 外部服务 | 飞书多维表格 API、阿里云 OSS、身份证验证 |

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
[客户前端] → Caddy (HTTPS) → NGINX (静态文件) → [后端 Docker 容器]
                                              │
                                              ├─→ [PostgreSQL 16] (Docker)
                                              └─→ [Redis 7] (Docker)
```

### 前端部署
- 路径: `/opt/web-fbif-form/web-current` (symlink)
- 实际目录: `/opt/web-fbif-form/web-releases/<timestamp>/`
- 服务: NGINX at port 3001
- 域名: `fbif2026ticket.foodtalks.cn`

### 后端部署
- 容器: `fbif-form-backend-api-1`
- 端口: 127.0.0.1:8080
- 工作目录: `/app`

### 数据库
- PostgreSQL: `fbif-form-backend-postgres-1` (Docker)
- Redis: `fbif-form-backend-redis-1` (Docker)

## 关键文件

| 文件 | 用途 |
|------|------|
| `apps/web/src/App.tsx` | 主表单组件 (2,460 行) |
| `apps/web/src/styles.css` | 样式文件 (3,000+ 行) |
| `apps/api/src/server.ts` | Express 服务器 |
| `apps/api/src/worker.ts` | BullMQ 任务处理 |
| `apps/api/src/services/feishuService.ts` | 飞书 API 集成 |
| `apps/api/prisma/schema.prisma` | 数据模型 |

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
1. **数据库先写入** - 提交先存 PostgreSQL
2. **幂等性** - `clientRequestId` 防止重复提交
3. **重试机制** - 失败最多重试 8 次，指数退避
4. **孤儿扫描** - 每 15 秒检查遗漏任务
5. **加密存储** - 手机号、身份证 AES-256 加密

## 常用命令

```bash
# SSH 连接服务器
ssh aliyun-prod

# 查看后端日志
ssh aliyun-prod "docker logs fbif-form-backend-api-1 --tail 100"

# 查看数据库
ssh aliyun-prod "docker exec -it fbif-form-backend-postgres-1 psql -U postgres -d fbif_form"

# 本地构建前端
cd apps/web && npm run build

# 部署前端
TIMESTAMP=$(date +%Y%m%d%H%M%S) && \
scp -r dist aliyun-prod:/opt/web-fbif-form/web-releases/${TIMESTAMP} && \
ssh aliyun-prod "cd /opt/web-fbif-form && rm -f web-current && ln -s /opt/web-fbif-form/web-releases/${TIMESTAMP} web-current"
```

## 飞书告警系统

当数据同步到飞书多维表格失败（8次重试后仍失败）时，自动发送飞书机器人告警。

**配置环境变量:**
```bash
FEISHU_ALERT_WEBHOOK=https://open.feishu.cn/open-apis/bot/v2/hook/xxx
FEISHU_ALERT_ENABLED=true
```

**告警触发条件:**
- 同步任务重试 8 次后仍失败
- 调用 `markSubmissionFailed` 时自动触发

**相关文件:**
- `apps/api/src/services/alertService.ts` - 告警服务
- `apps/api/src/worker.ts` - 调用告警的位置

## 测试环境 (Staging)

### 架构

| 项目 | 生产 (main) | 测试 (staging) |
|------|------------|---------------|
| 前端 NGINX | 3001 | 3003 |
| 后端 API | 8080 | 8083 |
| Docker 项目名 | `fbif-form-backend` | `fbif-form-staging` |
| 服务器路径 | `/opt/web-fbif-form/` | `/opt/web-fbif-form-staging/` |
| 数据库 | `fbif_form` | `fbif_form_staging` |
| NGINX 配置 | `fbif-form.conf` | `fbif-form-staging.conf` |

测试环境使用独立的 PostgreSQL 和 Redis 容器（独立 Docker volumes），完全隔离不影响生产数据。

### 工作流

```
推送到 staging 分支 → GitHub Actions 部署到测试环境
  → 访问 http://112.124.103.65:3003 预览
  → 确认没问题后合并 staging → main
  → GitHub Actions 部署到生产环境
```

### 关键文件

| 文件 | 用途 |
|------|------|
| `docker-compose.staging.yml` | 测试环境 Docker Compose |
| `.github/workflows/deploy-staging.yml` | 测试环境部署工作流 |
| `.github/workflows/deploy-aliyun.yml` | 生产环境部署工作流 |

### 数据来源字段

飞书同步支持写入"数据来源"字段，用于区分生产/测试数据：
- `FEISHU_FIELD_SOURCE` - 飞书表格中的列名（如 "数据来源"）
- `FEISHU_SUBMISSION_SOURCE` - 写入值（生产默认 "正式环境"，测试默认 "测试环境"）

前提：需在飞书多维表格中手动添加"数据来源"列。

## 待办事项

- [x] 增加数据同步失败告警 (飞书机器人通知)
- [x] 添加 staging 测试环境
- [ ] 添加管理后台查看失败记录
- [ ] 定期数据对账脚本
