# 部署与配置说明（现有 NGINX + 后端容器隔离）

## 目标架构
```text
[客户前端] -> NGINX（静态文件） -> [后端 API 容器]
                                 |
                                 +-> [PostgreSQL:16 容器，仅后端访问]
                                 +-> [Redis:7 容器，仅后端访问]
```

关键原则：
- 前端只发布静态文件，不在服务器运行 React 开发服务器。
- 后端运行在单一 Docker 容器，容器内包含 Node.js 与 Prisma 依赖。
- PostgreSQL/Redis 采用专用容器并放在私有网络，不对宿主机暴露端口。

## 1) 前端发布（静态文件）
前端在 CI 或本地构建后上传到现有 NGINX 目录，服务器无需安装 Node.js：

```bash
cd apps/web
npm ci
VITE_API_URL=https://form.example.com npm run build
```

将 `apps/web/dist/` 同步到线上目录（示例）：

```bash
rsync -av --delete apps/web/dist/ deploy@server:/var/www/fbif-form/
```

## 2) 后端容器启动
1. 准备环境变量文件：
```bash
cp backend.env.example backend.env
```
2. 按真实值填写 `backend.env`（尤其是 Feishu 凭据与密钥）。
3. 启动容器：
```bash
docker compose --env-file backend.env -f docker-compose.backend.yml up -d --build
```

说明：
- `docker-compose.backend.yml` 会同时启动 `api + postgres:16 + redis:7`。
- 默认只对外暴露 `API_PORT`（默认 `18080`）。
- `postgres/redis` 仅连入内部网络 `private`，不会占用宿主机 `5432/6379`。
- `api` 容器会在启动时自动执行 `prisma migrate deploy`，并在同容器内启动 Worker。

## 3) 现有 NGINX 配置示例
将静态目录与 API 反向代理配置在同一个 server 块：

```nginx
server {
  listen 443 ssl http2;
  server_name form.example.com;

  ssl_certificate /etc/nginx/certs/fullchain.pem;
  ssl_certificate_key /etc/nginx/certs/privkey.pem;

  root /var/www/fbif-form;
  index index.html;

  location / {
    try_files $uri /index.html;
  }

  location /api/ {
    proxy_pass http://127.0.0.1:18080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location = /health {
    proxy_pass http://127.0.0.1:18080/health;
  }
}
```

## 4) 验证与运维
查看容器状态：
```bash
docker compose --env-file backend.env -f docker-compose.backend.yml ps
```

查看日志：
```bash
docker compose --env-file backend.env -f docker-compose.backend.yml logs -f api
```

健康检查：
```bash
curl -i http://127.0.0.1:18080/health
```

停止栈：
```bash
docker compose --env-file backend.env -f docker-compose.backend.yml down
```

## 5) 关键环境变量（后端）
- `WEB_ORIGIN`：前端正式域名（用于 CORS）
- `DATA_KEY`：32 字节 base64 密钥
- `DATA_HASH_SALT`：敏感字段哈希盐
- `FEISHU_APP_ID` / `FEISHU_APP_SECRET`
- `FEISHU_APP_TOKEN` / `FEISHU_TABLE_ID`
- `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB`

## 6) 安全建议
- 强制 HTTPS 并开启 HSTS。
- 不要把 `backend.env` 提交到仓库。
- 给 `POSTGRES_PASSWORD`、`DATA_KEY`、`FEISHU_APP_SECRET` 使用高强度随机值。
- API 对外只暴露一个端口；数据库与 Redis 保持私网可见。
