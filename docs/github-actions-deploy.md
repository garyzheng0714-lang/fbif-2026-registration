# GitHub Actions 自动部署（阿里云）

本仓库已配置工作流：`.github/workflows/deploy-aliyun.yml`  
触发条件：
- 推送到 `main`
- 手动触发 `workflow_dispatch`

## 一次性配置（GitHub Secrets）
在仓库 `Settings -> Secrets and variables -> Actions -> New repository secret` 新增：

- 必填：
  - `ALIYUN_SSH_KEY` 或 `ALIYUN_SSH_KEY_B64` 二选一
  - `ALIYUN_SSH_KEY`: 服务器 SSH 私钥全文（推荐）
  - `ALIYUN_SSH_KEY_B64`: 私钥文件的 base64 单行字符串（用于规避换行粘贴问题）

- 选填（不填会使用默认值）：
  - `ALIYUN_HOST`: 默认 `112.124.103.65`
  - `ALIYUN_USER`: 默认 `root`
  - `APP_DIR`: 默认 `/opt/web-fbif-form`
  - `WEB_ORIGIN`: 默认 `http://112.124.103.65:3001`
  - `VITE_API_URL`: 默认 `http://112.124.103.65:8080`
  - `FEISHU_APP_ID`: 默认 `cli_a9f7f8703778dcee`
  - `FEISHU_APP_TOKEN`: 默认 `<YOUR_FEISHU_APP_TOKEN>`
  - `FEISHU_TABLE_ID`: 默认 `tbl0CQ74guMS1IDd`
  - `FEISHU_APP_SECRET`: 仅在服务器不存在旧 `apps/api/.env` 时必填（首次冷启动）

- apps/api 首次冷启动必填（若服务器已存在旧 `apps/api/.env` 可不填）：
  - `DATABASE_URL`
  - `REDIS_URL`
  - `DATA_KEY`（32-byte base64）
  - `DATA_HASH_SALT`

- OSS 直传（可选，但若前端启用“上传即转链接”则必须配置）：
  - `OSS_ACCESS_KEY_ID`
  - `OSS_ACCESS_KEY_SECRET`
  - `OSS_BUCKET`
  - `OSS_REGION`（或 `OSS_HOST`）
  - `OSS_PUBLIC_BASE_URL`（可选，默认使用 host）
  - `OSS_UPLOAD_PREFIX`（可选，默认 `fbif-form/proof`）
  - `OSS_OBJECT_ACL`（可选，建议 `public-read`）

## 自动部署流程
每次推送 `main` 后，Action 会自动执行：

1. 安装依赖并执行 `apps/api` 测试（带 Postgres/Redis 服务）
2. 构建后端 `apps/api`
3. （可选）执行 `apps/mock-api` 测试
4. 构建前端 `apps/web`（注入 `VITE_API_URL`）
3. 打包代码并上传到阿里云 `/tmp/release.tgz`
4. 在服务器生成新版本目录：`/opt/web-fbif-form/releases/<commit_sha>`
5. 处理 `apps/api/.env`：
   - 如果服务器已有旧 `.env`，自动复用
   - 如果没有，按 Secrets/默认值生成
6. 执行数据库迁移：`prisma migrate deploy`
7. 切换软链到新版本：`/opt/web-fbif-form/current`
8. 用 `pm2` 重启服务：
   - `fbif-api`（端口 `8080`）
   - `fbif-worker`（无端口）
   - `fbif-web`（端口 `3001`）
8. 本机健康检查 + 清理旧版本（保留最近 5 个）

## 发布后检查
- 前端：`http://<ALIYUN_HOST>:3001`
- 后端健康：`http://<ALIYUN_HOST>:8080/health`
- GitHub Actions 日志：仓库 `Actions -> Deploy To Aliyun`
