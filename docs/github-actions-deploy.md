# GitHub Actions 自动部署（阿里云）

本仓库配置了两个部署工作流，均部署到同一台服务器 `121.40.214.5`，通过不同端口隔离预览和生产环境。

| 工作流 | 文件 | 触发方式 | 环境 | 端口 |
|--------|------|---------|------|------|
| Deploy Preview | `deploy-preview.yml` | push 到 `main` 自动触发 | 预览 | Web 3003 / API 8083 |
| Deploy Production | `deploy-aliyun.yml` | 手动 `workflow_dispatch` | 生产 | Web 3001 / API 8080 |

飞书同步说明：
- 生产和预览共用飞书表 `tbl0CQ74guMS1IDd`
- 通过 `FEISHU_SUBMISSION_SOURCE` 区分 `正式环境` / `测试环境`

## 一次性配置（GitHub Secrets）

在仓库 `Settings -> Secrets and variables -> Actions -> New repository secret` 新增：

- 必填：
  - `ALIYUN_SSH_KEY` 或 `ALIYUN_SSH_KEY_B64` 二选一
  - `ALIYUN_SSH_KEY`: 服务器 SSH 私钥全文（推荐）
  - `ALIYUN_SSH_KEY_B64`: 私钥文件的 base64 单行字符串（用于规避换行粘贴问题）

- 选填（不填使用默认值）：
  - `ALIYUN_HOST`: 默认 `121.40.214.5`
  - `ALIYUN_USER`: 默认 `root`
  - `APP_DIR`: 默认 `/opt/web-fbif-form`
  - `WEB_ORIGIN`: 建议显式设置为生产域名 `https://fbif2026ticket.foodtalks.cn`
  - `VITE_API_URL`: 不填时构建默认使用 `/api`
  - `FEISHU_APP_ID`: 默认 `cli_a9f7f8703778dcee`
  - `FEISHU_APP_TOKEN`: 默认 `<YOUR_FEISHU_APP_TOKEN>`
  - `FEISHU_TABLE_ID`: 默认 `tbl0CQ74guMS1IDd`
  - `FEISHU_APP_SECRET`: 仅在服务器不存在旧 `apps/api/.env` 时必填（首次冷启动）

- 首次冷启动必填（若服务器已存在旧 `apps/api/.env` 可不填）：
  - `DATABASE_URL`
  - `REDIS_URL`
  - `DATA_KEY`（32-byte base64）
  - `DATA_HASH_SALT`

- OSS 直传（可选，前端启用上传功能时必须配置）：
  - `OSS_ACCESS_KEY_ID`
  - `OSS_ACCESS_KEY_SECRET`
  - `OSS_BUCKET`
  - `OSS_REGION`（或 `OSS_HOST`）
  - `OSS_PUBLIC_BASE_URL`（可选，默认使用 host）
  - `OSS_UPLOAD_PREFIX`（可选，默认 `fbif-form/proof`）
  - `OSS_OBJECT_ACL`（可选，建议 `public-read`）

## 部署流程

两个工作流共用相同的部署逻辑，每次执行以下步骤：

1. 安装依赖并执行 `apps/api` 测试（带 Postgres/Redis 服务容器）
2. 构建后端 `apps/api`
3. （可选）执行 `apps/mock-api` 测试
4. 构建前端 `apps/web`（注入 `VITE_API_URL`）
5. 打包代码并上传到服务器 `/tmp/release.tgz`
6. 在服务器生成新版本目录：`<APP_DIR>/releases/<commit_sha>`
7. 处理 `apps/api/.env`：
   - 如果服务器已有旧 `.env`，自动复用
   - 如果没有，按 Secrets/默认值生成
8. 执行数据库迁移：`prisma migrate deploy`
9. 切换软链到新版本：`<APP_DIR>/current`
10. 使用 `docker-compose.production.yml` 启动/更新容器并执行健康检查
11. 清理旧版本（保留最近 5 个）

## 预览环境参数

`deploy-preview.yml` 固定使用以下参数：

| 参数 | 值 |
|------|-----|
| 目标服务器 | `121.40.214.5` |
| 应用目录 | `/opt/web-fbif-form-staging` |
| Docker 项目名 | `fbif-form-staging` |
| 数据库 | `fbif_form_staging` |
| Web 端口 | `3003` |
| API 端口 | `8083` |
| 飞书表 | `tbl0CQ74guMS1IDd` |
| 数据来源 | `FEISHU_SUBMISSION_SOURCE=测试环境` |

## 发布后检查

| 检查项 | 地址 |
|--------|------|
| 预览前端 | `http://121.40.214.5:3003` |
| 预览后端健康 | `http://127.0.0.1:8083/health`（服务器内） |
| 生产前端 | `https://fbif2026ticket.foodtalks.cn` |
| 生产后端健康 | `http://127.0.0.1:8080/health`（服务器内） |
| Actions 日志 | 仓库 `Actions` 页面查看 `Deploy Preview` / `Deploy To Aliyun` |
