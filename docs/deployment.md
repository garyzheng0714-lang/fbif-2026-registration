# 部署与配置说明

## 生产建议架构
- CDN：静态前端（`apps/web` 构建产物）接入 CDN
- 负载均衡：Nginx/ALB 将 API 请求分发到多实例
- API 多实例：`pm2` 或容器副本 + 自动扩缩
- Redis：用于限流与异步队列
- PostgreSQL：主库 + 只读副本（按需）

## 环境变量（API）
- `DATABASE_URL` PostgreSQL 连接串
- `REDIS_URL` Redis 连接串
- `DATA_KEY` 32 字节 base64 密钥
- `DATA_HASH_SALT` 哈希盐
- `FEISHU_APP_ID` / `FEISHU_APP_SECRET`
- `FEISHU_APP_TOKEN` 多维表格 app token（baseid）
- `FEISHU_TABLE_ID` 表格 table id

## Nginx 示例
```nginx
server {
  listen 443 ssl;
  server_name form.example.com;

  ssl_certificate /etc/ssl/certs/fullchain.pem;
  ssl_certificate_key /etc/ssl/private/privkey.pem;

  location / {
    root /var/www/web;
    try_files $uri /index.html;
  }

  location /api/ {
    proxy_pass http://api_upstream;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}

upstream api_upstream {
  server 10.0.0.2:8080;
  server 10.0.0.3:8080;
}
```

## HTTPS 与安全
- 生产必须开启 HTTPS（TLS 证书）
- 开启 HSTS（由 Nginx/网关配置）
- API 使用 `helmet` + CORS 限制域名

## 异步任务
- 单独运行 `npm run worker` 启动同步队列 Worker
- 每个 API 实例不要重复启动 Worker，避免任务抢占不均
