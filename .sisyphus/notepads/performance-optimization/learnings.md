# Learnings

## [2026-03-16] Session start
- Worktree: /Users/simba/local_vibecoding/fbif-2026-registration-new/.claude/worktrees/performance-optimization
- Branch: feat/performance-optimization
- Plan: performance-optimization (0/12 tasks done)

## Key Architecture Facts
- Production API containers started by `scripts/remote-deploy.sh` via `docker run` (NOT docker compose)
- Preview containers started by `docker-compose.production.yml`
- Resource limits for PRODUCTION: must edit `scripts/remote-deploy.sh` line ~539
- Resource limits for PREVIEW: must edit `docker-compose.production.yml`
- Env vars for PRODUCTION: via `scripts/update-backend-env.sh` → `/opt/web-fbif-form/shared/backend.env`
- Env vars for PREVIEW: via `docker-compose.production.yml` defaults `${VAR:-default}`
- SSH alias for server: `aliyun-prod-real` (NOT `aliyun-prod`)
- Preview container name: `fbif-form-staging-api-1`
- Preview URL: http://121.40.214.5:3003
- Production domain: https://fbif2026ticket.foodtalks.cn

## CDN Architecture
- CDN CNAME keeps same domain (CSRF sameSite:strict safe)
- trust proxy must be 3 (CDN→Caddy→Nginx→Express = 3 hops before Express)
- Frontend uses relative /api/* paths - no code change needed for CDN
- Static files: /var/www/fbif-form (prod) and /var/www/fbif-form-staging (preview)

## PM2 Migration
- Old: entrypoint.sh manages 2 node processes + PID monitoring
- New: entrypoint-pm2.sh = prisma migrate deploy → exec pm2-runtime ecosystem.config.cjs
- Keep old entrypoint.sh (rollback: change Dockerfile ENTRYPOINT back)
- pm2-runtime is Docker-specific: stays in foreground

## [2026-03-16] Task 1 Baseline Findings
- Active production container: fbif-form-api-green
- NanoCpus=0, Memory=0 → NO explicit Docker resource limits on production containers!
  - Production containers are started via `docker run` WITHOUT --cpus/--memory flags
  - docker-compose.production.yml limits (cpus:1.00, mem:512m) only apply to PREVIEW
- Server: 4 CPU cores confirmed, 7.1 GiB RAM
- PostgreSQL max_connections: 100 (leaves ~40 headroom after 60 pool connections)
- Process RSS: ~110 MB (comfortable, far from any limit)
- Performance bottleneck is SINGLE-PROCESS Node.js, not Docker limits

IMPLICATION for Task 3:
- For production (remote-deploy.sh): Adding --cpus 3 --memory 2g will ADD new explicit limits
  (not removing restrictions - just adding reasonable caps to prevent starvation)
- For preview (docker-compose.production.yml): Must INCREASE from 1 core/512MB → 3 cores/2GB

Task 3 completed: docker resource limits tuned as per plan. Evidence attached in .sisyphus/evidence/task-3-*.txt.

## [2026-03-16] Task 5: Preview Deployment Findings
- PR #28 merged successfully to main → preview auto-deployed
- IMPORTANT: staging container name is NOT fbif-form-staging-api-1
  - Actual: fbif-form-staging-api-blue (and fbif-form-staging-api-green)
  - Preview uses blue-green too! (28080/28081 ports)
- PM2 cluster WORKS: 3 fbif-api cluster + 1 fbif-worker fork = all online
- Memory per worker: ~78MB (well within 2GB limit)
- Preview URL working: http://121.40.214.5:3003/health → "ok"
- CSRF endpoint working: returns valid token
- GitHub Actions deploy-preview took ~4.5 minutes total

