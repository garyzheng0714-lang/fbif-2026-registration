# FBIF Form

FBIF 食品创新展 2026 观众注册表单系统 — 高并发表单采集 + 飞书多维表格异步同步。

## 目录结构
- `apps/web`: React 表单前端 (Vite + TypeScript)
- `apps/api`: Express + Prisma 后端 (BullMQ 异步任务)
- `apps/mock-api`: Mock API (本地开发用)
- `docs/`: 部署、API、测试与使用文档
- `tests/k6`: K6 压测脚本

## 本地开发

1. 启动依赖
```bash
docker compose up -d
```

2. 后端
```bash
cd apps/api
cp .env.example .env
npm ci
npm run prisma:migrate
npm run dev
```

3. 前端
```bash
cd apps/web
cp .env.example .env
npm ci
npm run dev
```

## 本地前后端联调
```bash
node scripts/local-stack.mjs start
node scripts/local-stack.mjs status
```

同时启动前端预览 (`http://localhost:4173`) 和模拟后端 (`http://localhost:8080`)。

详见 `docs/local-dev-environment.md`。

## 部署架构

单服务器 (121.40.214.5) 双环境部署:

| 环境 | 前端 | API | 触发方式 |
|------|------|-----|----------|
| 生产 | `:3001` (Caddy HTTPS -> Nginx) | `:8080 / :18080` (blue/green) | 手动 GitHub Actions dispatch |
| Preview | `:3003` (HTTP) | `:8083` | push to main 自动触发 |

两套环境通过不同 Docker 项目名和数据库完全隔离。

生产稳定性基线（防串线）：
- 生产域名 API 必须经 `localhost:3001`，不允许直连 `localhost:8080`
- Preview 蓝绿槽位不得占用生产 API 端口 `8080/18080`
- `nginx sites-enabled` 不允许出现 `fbif-form-staging*` 条目

## CI/CD

- **Preview**: push to `main` → 自动部署到 `http://121.40.214.5:3003`
- **生产**: 手动触发 GitHub Actions `Deploy To Aliyun` → 部署到 `https://fbif2026ticket.foodtalks.cn`

说明文档: `docs/github-actions-deploy.md`
发布规则: `docs/release-flow.md`
应急与防复发手册: `docs/production-port-isolation-runbook.md`

## 重要配置

- `FEISHU_APP_SECRET` 必须从环境变量注入
- `FEISHU_TABLE_ID` 需填写多维表格的 Table ID
- `DATA_KEY` 使用 32 字节 base64 密钥

更多内容见 `docs/`。
