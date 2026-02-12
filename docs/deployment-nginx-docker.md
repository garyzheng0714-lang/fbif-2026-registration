# NGINX Docker 部署（并行接入，不影响现有系统）

## 目标
- 将前端静态资源从 Node/PM2 `serve` 切换为 NGINX 容器，降低内存占用。
- 与现有系统并行部署，不直接替换现网端口。

## 文件
- `apps/web/Dockerfile`
- `apps/web/nginx/default.conf`
- `docker-compose.nginx.yml`

## 一键启动（并行）
```bash
docker compose -f docker-compose.nginx.yml up -d --build
```

默认映射：
- 前端容器：`13001 -> 80`
- 现有 `3001/8080` 不会被占用，不影响当前线上服务。

## 验证
```bash
curl -i http://127.0.0.1:13001/healthz
curl -i http://127.0.0.1:13001/
```

## 与已有 API 对接
- 该镜像默认使用前端运行时 fallback：`http://<当前域名>:8080`。
- 如果你已有独立 API 域名，可在构建时注入：
```bash
VITE_API_URL=https://api.your-domain.com docker compose -f docker-compose.nginx.yml up -d --build
```

## 灰度切流建议（不影响现网）
1. 保持现网 `3001` 不动，先用 `13001` 对外灰度测试。
2. 验证表单提交流程、身份证实名验证、附件上传全部正常。
3. 再由现有网关/Nginx 把正式域名流量转发到 `13001`。
4. 稳定后可下线 PM2 的 `fbif-web`，只保留 API/Worker。

## 回滚
```bash
docker compose -f docker-compose.nginx.yml down
```
- 回滚后，原 `3001` 服务仍可继续使用。
