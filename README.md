# FBIF 2026 Registration

FBIF 食品创新展 2026 观众注册表单系统，用于收集观众报名信息、校验提交数据，并异步同步到飞书多维表格。

## Overview

本仓库是一个前后端分离的注册系统。前端提供移动端优先的报名表单，后端负责表单校验、CSRF/rate limit 防护、数据落库、队列任务和飞书多维表格同步。系统还包含本地 mock API、部署脚本、压测记录和生产运维文档。

## Features

- 区分专业观众和普通观众的报名表单
- 手机号、证件类型、身份证二要素验证等校验流程
- 腾讯广告点击参数和访问跟踪字段采集
- 可选 OSS 附件上传策略接口
- Express API 接收提交并返回同步状态
- PostgreSQL 存储报名记录，Redis + BullMQ 异步同步飞书
- 飞书多维表格字段映射、选项映射和重试机制
- CSRF、限流、Helmet、结构化日志和 Prometheus 指标
- Preview 与生产环境的 Docker/GitHub Actions 部署文档

## Tech Stack

- Frontend: React 18, TypeScript, Vite, Vitest
- API: Node.js, Express, TypeScript, Prisma, Zod
- Queue: BullMQ, Redis
- Database: PostgreSQL
- Integrations: Feishu/Lark Bitable, Aliyun OSS, optional Aliyun ID verification
- Deployment: Docker Compose, Nginx/Caddy, GitHub Actions

## Project Structure

```text
.
├── apps/
│   ├── web/        # React registration form
│   ├── api/        # Express API, Prisma schema and worker
│   └── mock-api/   # Local mock server for frontend development
├── deploy/         # Caddy/Nginx deployment templates
├── docs/           # API, deployment, runbook and environment docs
├── scripts/        # Local stack, deploy, rollback and verification helpers
├── docker-compose.yml
└── docker-compose.production.yml
```

## Getting Started

Start local infrastructure:

```bash
docker compose up -d
```

Set up and run the API:

```bash
cd apps/api
cp .env.example .env
npm ci
npm run prisma:generate
npm run prisma:migrate
npm run dev
```

Set up and run the web app:

```bash
cd apps/web
cp .env.example .env
npm ci
npm run dev
```

For a frontend-only workflow, run the mock API:

```bash
cd apps/mock-api
cp .env.example .env
npm ci
npm run dev
```

## Useful Commands

API:

```bash
npm run dev
npm run build
npm run start
npm run worker:dev
npm run test
npm run prisma:migrate
```

Web:

```bash
npm run dev
npm run build
npm run preview
npm run test
npm run preview:start
npm run preview:status
npm run preview:stop
```

Mock API:

```bash
npm run dev
npm run start
npm run test
npm run smoke:feishu
```

Local full-stack helper:

```bash
node scripts/local-stack.mjs start
node scripts/local-stack.mjs status
node scripts/local-stack.mjs stop
```

## Configuration

Copy each app's `.env.example` before local development. Important backend settings include:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection used by Prisma |
| `REDIS_URL` | Redis connection used by BullMQ |
| `DATA_KEY` | 32-byte base64 encryption key |
| `DATA_HASH_SALT` | Salt for hashed sensitive fields |
| `FEISHU_APP_ID` / `FEISHU_APP_SECRET` | Feishu app credentials |
| `FEISHU_APP_TOKEN` / `FEISHU_TABLE_ID` | Target Bitable app and table |
| `FEISHU_FIELD_*` | Optional overrides for Bitable column names |
| `OSS_*` | Optional direct-to-OSS upload configuration |
| `ID_VERIFY_*` | Optional Aliyun ID verification configuration |

The frontend usually uses `VITE_API_URL` for local development. Production is expected to use same-origin `/api` routing through the reverse proxy.

## Deployment Notes

The repository includes GitHub Actions and server scripts for Preview and production deployment. Existing documentation describes:

- Preview deployment: `docs/github-actions-deploy.md`
- Production release flow: `docs/release-flow.md`
- Environment model: `docs/repo-environment-model.md`
- Runbook and incident response: `docs/runbook.md`
- Port isolation and rollback: `docs/production-port-isolation-runbook.md`

The existing README documented production at `https://fbif2026ticket.foodtalks.cn` and Preview at `http://121.40.214.5:3003`; verify current infrastructure before changing deployment settings.
