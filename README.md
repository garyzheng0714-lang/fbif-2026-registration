# FBIF Form

高并发表单采集 + 飞书多维表格同步示例（前后端分离）。

## 目录结构
- `apps/web`: React 表单前端
- `apps/api`: Express + Prisma 后端（含飞书 Node SDK）
- `docs`: 部署、API、测试与使用文档
- `tests/k6`: 压测脚本

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
cd ../web
cp .env.example .env
npm ci
npm run dev
```

## 稳定预览（推荐）
```bash
cd apps/web
npm run preview:start
npm run preview:status
```

详细流程见 `docs/preview-spec.md`。

## 本地前后端联调（推荐）
```bash
node scripts/local-stack.mjs start
node scripts/local-stack.mjs status
```

该模式会同时启动：
- 前端预览：`http://localhost:4173`
- 模拟后端：`http://localhost:8080`

完整说明与测试用例见 `docs/local-dev-environment.md`。

## 生产部署（现有 NGINX + 后端容器隔离）
目标架构：
- 前端：`apps/web` 在 CI/本机构建后，发布静态文件到现有 NGINX。
- 后端：单一 API 容器（内部同时运行 API + Worker）。
- 数据层：专用 `postgres:16` + `redis:7`，仅供该 API 容器访问。

1. 构建前端静态资源（不在服务器运行 Node）：
```bash
cd apps/web
npm ci
VITE_API_URL=https://form.example.com npm run build
```

2. 将 `apps/web/dist/` 同步到现有 NGINX 站点目录（如 `/var/www/fbif-form`），由 NGINX 直接托管。

3. 启动后端隔离容器栈：
```bash
cp backend.env.example backend.env
docker compose --env-file backend.env -f docker-compose.backend.yml up -d --build
```

4. 验证：
```bash
docker compose --env-file backend.env -f docker-compose.backend.yml ps
curl -i http://127.0.0.1:18080/health
```

完整步骤与 NGINX 反向代理示例见 `docs/deployment.md`。

## 重要配置
- `FEISHU_APP_SECRET` 必须从环境变量注入
- `FEISHU_TABLE_ID` 需填写多维表格的 Table ID
- `DATA_KEY` 使用 32 字节 base64 密钥

更多内容见 `docs/`。

## CI/CD 自动部署
已支持 GitHub Actions 自动部署到阿里云（推送 `main` 自动触发）。

说明文档：`docs/github-actions-deploy.md`
