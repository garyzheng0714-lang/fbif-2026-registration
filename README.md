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
cd /Library/vibecoding_home/fbif_form
docker-compose up -d
```

2. 后端
```bash
cd /Library/vibecoding_home/fbif_form/apps/api
cp .env.example .env
npm install
npm run prisma:generate
npx prisma migrate dev --name init
npm run dev
```

3. 前端
```bash
cd /Library/vibecoding_home/fbif_form/apps/web
cp .env.example .env
npm install
npm run dev
```

## 稳定预览（推荐）
```bash
cd /Library/vibecoding_home/fbif_form/apps/web
npm run preview:start
npm run preview:status
```

详细流程见 `/Library/vibecoding_home/fbif_form/docs/preview-spec.md`。

## 本地前后端联调（推荐）
```bash
cd /Library/vibecoding_home/fbif_form
node scripts/local-stack.mjs start
node scripts/local-stack.mjs status
```

该模式会同时启动：
- 前端预览：`http://localhost:4173`
- 模拟后端：`http://localhost:8080`

完整说明与测试用例见 `/Library/vibecoding_home/fbif_form/docs/local-dev-environment.md`。

## 重要配置
- `FEISHU_APP_SECRET` 必须从环境变量注入
- `FEISHU_TABLE_ID` 需填写多维表格的 Table ID
- `DATA_KEY` 使用 32 字节 base64 密钥

更多内容见 `docs/`。

## CI/CD 自动部署
已支持 GitHub Actions 自动部署到阿里云（推送 `main` 自动触发）。

说明文档：`/Library/vibecoding_home/fbif_form/docs/github-actions-deploy.md`
