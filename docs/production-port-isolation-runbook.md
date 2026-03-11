# 生产端口隔离与止血 Runbook

更新时间：2026-03-11（Asia/Shanghai）

适用范围：
- 服务器：`121.40.214.5`
- 项目：`fbif-form`（生产）与 `fbif-form-staging`（预览）

## 1. 稳态基线（必须满足）

### 1.1 生产流量路径

- `https://fbif2026ticket.foodtalks.cn/api/*` 必须走：
  - `Caddy(443) -> localhost:3001(Nginx) -> active slot(8080/18080)`
- 生产 `Caddyfile` 的 `fbif2026ticket.foodtalks.cn` 块内应为：
  - `/api/* -> reverse_proxy localhost:3001`
  - `/health -> rewrite /healthz -> reverse_proxy localhost:3001`

### 1.2 端口隔离

- 生产保留端口：
  - `API slot`: `8080/18080`
  - `Nginx`: `3001/3002`
- 预览保留端口：
  - 外部稳定入口：`3003/8083`
  - 预览蓝绿部署临时端口：`3101/3102`（Nginx）、`28080/28081`（API）

### 1.3 禁止状态

- `fbif-form-staging-api-(blue|green)` 绑定 `127.0.0.1:8080` 或 `127.0.0.1:18080`
- `/etc/nginx/sites-enabled` 出现 `fbif-form-staging*`

## 2. 发布前 60 秒核对

```bash
# 1) 生产 preflight 必须通过
ssh aliyun-prod-real \
  'APP_DIR=/opt/web-fbif-form STATIC_DIR=/var/www/fbif-form API_PORT=8080 PRIMARY_WEB_PORT=3001 CANDIDATE_WEB_PORT=3002 NGINX_SITE_NAME=fbif-form COMPOSE_PROJECT_NAME=fbif-form BLUE_API_PORT=8080 GREEN_API_PORT=18080 bash -s -- preflight' \
  < scripts/remote-deploy.sh

# 2) 关键容器与端口归属
ssh aliyun-prod-real 'docker ps --format "table {{.Names}}\t{{.Ports}}"'
ssh aliyun-prod-real 'ss -ltnp | egrep ":3001|:3002|127.0.0.1:8080|127.0.0.1:18080|127.0.0.1:8083"'

# 3) 生产域名 API 头必须是生产 origin
ssh aliyun-prod-real \
  'curl -sS -m 8 -D /tmp/h -o /tmp/b https://fbif2026ticket.foodtalks.cn/api/csrf >/dev/null && grep -i "^access-control-allow-origin:" /tmp/h'
```

## 3. 串线止血步骤（不停机优先）

仅在出现“生产域名命中测试 API”时执行。

```bash
# A. 先做快照（用于秒级回滚）
ssh aliyun-prod-real 'TS=$(date +%Y%m%d-%H%M%S); D=/root/fbif-fix-snapshots/$TS; mkdir -p $D; cp /etc/caddy/Caddyfile $D/Caddyfile.before; cp -a /etc/nginx/sites-enabled $D/; docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" > $D/docker.before.txt; echo $D'

# B. 确保生产数据面在线
ssh aliyun-prod-real 'cd /opt/web-fbif-form/current && docker compose --env-file /opt/web-fbif-form/shared/backend.env -f docker-compose.production.yml up -d --no-build --no-recreate postgres redis'

# C. 释放生产 API 端口（移除预览 blue/green）
ssh aliyun-prod-real 'docker rm -f fbif-form-staging-api-blue fbif-form-staging-api-green || true; echo legacy > /opt/web-fbif-form-staging/shared/active_slot'

# D. 生产 API 重新绑定 127.0.0.1:8080（与当前 release 一致）
# 建议直接使用生产 deploy 流程（preflight -> prepare -> promote）完成切换
```

## 4. 发布后验收

```bash
# 生产健康
curl -sS https://fbif2026ticket.foodtalks.cn/health

# 生产 API CORS 必须是生产域名
curl -sS -D /tmp/h -o /tmp/b https://fbif2026ticket.foodtalks.cn/api/csrf >/dev/null
grep -i '^access-control-allow-origin:' /tmp/h

# 预览直连健康
curl -sS http://121.40.214.5:3003/health

# 容器请求归属（生产域名应只在 fbif-form-api-* 出现）
ssh aliyun-prod-real 'for c in fbif-form-api-blue fbif-form-api-green fbif-form-staging-api-1; do echo "--- $c"; docker logs --since 5m $c 2>&1 | grep -oE "\"host\":\"[^\"]+\"" | sed "s/\"host\":\"//;s/\"$//" | sort | uniq -c | sort -nr | head; done'
```

## 5. 关联文档

- `docs/github-actions-deploy.md`
- `docs/release-flow.md`
- `docs/repo-deploy-truth-map.md`
