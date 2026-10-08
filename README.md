# FBIF 2026 观众注册系统

FBIF 食品创新展 2026 的观众注册站：React 表单负责采集，Express API 先把提交写入 PostgreSQL，再由 BullMQ worker 异步同步到飞书多维表格。附件通过阿里云 OSS 直传。

本目录是本地唯一现役副本；`归档/fbif-2026-registration` 与 `归档/web-fbif-form` 只是旧快照，不参与开发或部署。仓库、分支和环境的权威对应关系见 [docs/repo-deploy-truth-map.md](docs/repo-deploy-truth-map.md)。

## 目录

- `apps/web/`：React + TypeScript + Vite 前端
- `apps/api/`：Express + Prisma + BullMQ 后端
- `apps/mock-api/`：本地联调用模拟 API
- `scripts/`：本地联调、蓝绿发布、回滚与漂移检查
- `deploy/`：Caddy 模板
- `tests/`：k6 与 OSS 混合链路压测
- `docs/`：现行接入、部署与运维文档；先看 [docs/README.md](docs/README.md)

## 本地开发

先启动 PostgreSQL 与 Redis：

```bash
docker compose up -d
```

后端：

```bash
cd apps/api
cp .env.example .env
npm ci
npm run prisma:migrate
npm run dev
```

前端：

```bash
cd apps/web
cp .env.example .env
npm ci
npm run dev
```

也可以用仓库脚本同时启动前端预览和模拟 API：

```bash
node scripts/local-stack.mjs start
node scripts/local-stack.mjs status
```

具体限制见 [docs/local-dev-environment.md](docs/local-dev-environment.md)。

## 验证

```bash
cd apps/api && npm test && npm run build
cd apps/web && npm test && npm run build
docker compose -f docker-compose.production.yml config --quiet
```

测试会写临时数据库时，只能使用测试配置；不得把生产凭据或真实报名数据带入本地测试。

## 部署边界

- `main` 推送自动部署 Preview；生产只能由人工确认后手动触发 `Deploy To Aliyun`。
- Production 与 Preview 共用服务器，但端口、Docker 项目名和数据库必须隔离。
- 生产域名流量必须经 Caddy → 主机 Nginx → 当前蓝绿 API 槽位；不得让 Preview 占用生产端口。
- API 容器以 PM2 启动 3 个 API worker；BullMQ worker 是否启动由 `RUN_WORKER` 控制。
- 真实密钥只允许放在环境文件或 GitHub Secrets；不要写入 Markdown、源码、截图或日志。

发布前读 [docs/release-flow.md](docs/release-flow.md)，故障处理读 [docs/runbook.md](docs/runbook.md) 和 [docs/production-port-isolation-runbook.md](docs/production-port-isolation-runbook.md)。

## 核心接口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/health` | 健康检查 |
| `GET` | `/metrics` | Prometheus 指标 |
| `GET` | `/api/csrf` | 获取 CSRF token |
| `POST` | `/api/oss/policy` | 获取 OSS 直传策略 |
| `POST` | `/api/id-verify` | 可选身份证二要素校验 |
| `POST` | `/api/submissions` | 受理报名，成功返回 `202` |
| `GET` | `/api/submissions/:id/status` | 查询飞书同步状态 |

完整请求约定见 [docs/api.md](docs/api.md)。
