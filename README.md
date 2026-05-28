# fbif-2026-registration

![类型](https://img.shields.io/badge/%E7%B1%BB%E5%9E%8B-FBIF%20%E5%B7%A5%E5%85%B7-ef4444)
![技术栈](https://img.shields.io/badge/%E6%8A%80%E6%9C%AF%E6%A0%88-React%20%2B%20Express%20%2B%20Prisma-2563eb)
![状态](https://img.shields.io/badge/%E7%8A%B6%E6%80%81-%E7%94%9F%E4%BA%A7%E8%A1%A8%E5%8D%95-16a34a)
![README](https://img.shields.io/badge/README-%E4%B8%AD%E6%96%87-111827)

FBIF 食品创新展 2026 观众注册表单系统，负责前端报名采集、后端校验、异步入库和飞书多维表格同步。

## 仓库定位

- 分类：FBIF 工具 / 活动报名系统 / 表单采集与飞书同步。
- 服务对象：FBIF 2026 观众注册、身份信息采集、报名数据入库和运营同步流程。
- 与表格工具的区别：本仓库不是通用表格处理工具，而是围绕活动报名业务的完整 Web 表单、API、队列、数据库和飞书同步系统。

## 功能概览

- React + Vite 观众报名前端。
- Express API 接收报名、校验字段、处理 CSRF 与限流。
- Prisma 管理报名数据库 schema 与迁移。
- BullMQ + Redis 异步同步飞书多维表格。
- 支持证件/证明材料上传策略与 OSS 相关配置。
- 支持飞书字段映射、同步重试、失败告警和补偿脚本。
- 提供 Mock API、本地联调脚本、k6 压测脚本和部署文档。
- 支持 Preview 与生产环境的 Docker/Nginx/Caddy 部署说明。

## 技术栈

- 前端：React 18、TypeScript、Vite、Vitest。
- 后端：Node.js、Express 4、TypeScript、Prisma、Zod、Pino。
- 队列与存储：PostgreSQL、Redis、BullMQ。
- 集成：飞书开放平台、多维表格、可选 OSS、可选阿里云身份证二要素验证。
- 部署与验证：Docker Compose、Nginx、Caddy、GitHub Actions、k6。

## 快速开始

启动基础依赖：

```bash
docker compose up -d
```

启动 API：

```bash
cd apps/api
cp .env.example .env
npm ci
npm run prisma:migrate
npm run dev
```

启动前端：

```bash
cd apps/web
cp .env.example .env
npm ci
npm run dev
```

## 本地联调

仓库提供本地栈管理脚本，用于同时启动前端预览和模拟后端：

```bash
node scripts/local-stack.mjs start
node scripts/local-stack.mjs status
```

更多说明见 `docs/local-dev-environment.md`。

## 项目结构

```text
.
├── apps/
│   ├── web/                 # React 报名前端
│   ├── api/                 # Express + Prisma API 与 worker
│   └── mock-api/            # 本地开发用 Mock API
├── docs/                    # 部署、API、测试、运维和业务说明
├── deploy/                  # Caddy/Nginx 部署模板
├── scripts/                 # 本地联调、部署、回滚和验证脚本
├── tests/
│   ├── k6/                  # k6 压测脚本
│   └── load/                # Shell 压测脚本
├── docker-compose.yml
├── docker-compose.production.yml
└── backend.env.example
```

## 常用脚本

| 位置 | 命令 | 说明 |
| --- | --- | --- |
| `apps/api` | `npm run dev` | 启动 API 开发服务 |
| `apps/api` | `npm run build` | 编译 TypeScript |
| `apps/api` | `npm start` | 启动编译后的 API |
| `apps/api` | `npm run worker` | 启动编译后的同步 worker |
| `apps/api` | `npm test` | 运行 API 测试 |
| `apps/api` | `npm run prisma:migrate` | 执行 Prisma 迁移 |
| `apps/web` | `npm run dev` | 启动前端开发服务 |
| `apps/web` | `npm run build` | 构建前端 |
| `apps/web` | `npm test` | 运行前端测试 |
| `apps/mock-api` | `npm run dev` | 启动 Mock API |

## 关键配置

API 配置模板位于 `apps/api/.env.example`，前端配置模板位于 `apps/web/.env.example`。

| 变量 | 说明 |
| --- | --- |
| `DATABASE_URL` | PostgreSQL 连接字符串 |
| `REDIS_URL` | Redis/BullMQ 连接字符串 |
| `DATA_KEY` | 32 字节 base64 加密密钥 |
| `DATA_HASH_SALT` | 哈希盐值 |
| `FEISHU_APP_ID` | 飞书应用 ID |
| `FEISHU_APP_SECRET` | 飞书应用密钥 |
| `FEISHU_APP_TOKEN` | 飞书多维表格 App Token |
| `FEISHU_TABLE_ID` | 飞书多维表格 Table ID |
| `VITE_API_URL` | 前端访问 API 的地址 |

## 部署与运维资料

- `docs/github-actions-deploy.md`：GitHub Actions 部署说明。
- `docs/release-flow.md`：发布流程。
- `docs/production-port-isolation-runbook.md`：生产端口隔离与防串线手册。
- `docs/deployment.md`、`docs/deployment-nginx-docker.md`：部署说明。
- `docs/api.md`：API 文档。
- `docs/performance-test.md`：性能测试说明。

## 注意事项

- 敏感配置必须通过环境变量或部署密钥注入，不要提交真实密钥。
- 生产和 Preview 环境使用不同 Docker 项目名、端口和数据库，应保持隔离。
- 飞书字段名可通过 `FEISHU_FIELD_*` 变量覆盖，适合多维表格列名调整后的兼容。
