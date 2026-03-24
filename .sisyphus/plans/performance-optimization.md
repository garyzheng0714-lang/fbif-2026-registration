# FBIF 2026 性能优化：单机配置调优 + 阿里云 CDN 部署

## Progress Status
Tasks 1-6 completed (Wave 1 + Wave 2). Now in Wave 3.

## Current State (2026-03-16)
- PR #28 merged to main ✅
- Preview deployed successfully ✅ 
- PM2 cluster: 3 API workers + 1 Worker, all online ✅
- K6 test verified: PM2 stable under 120 req/s ✅

## TODOs

- [x] 1. Capture Current Performance Baseline
- [x] 2. PM2 Cluster Mode Setup
- [x] 3. Docker Resource Limits Tuning (Production + Preview)
- [x] 4. Performance Environment Variables Tuning (Production + Preview)
- [x] 5. Deploy Route A — PR, Merge, Verify Preview
- [x] 6. K6 Load Test Comparison — Route A Effectiveness

- [x] 7. Update Trust Proxy for CDN Proxy Chain

  **What to do**:
  - Modify `apps/api/src/server.ts`: change `app.set('trust proxy', 1)` to use env var `TRUST_PROXY_HOPS` (default 3)
  - Add `TRUST_PROXY_HOPS` to `apps/api/src/config/env.ts` as Zod schema: `z.coerce.number().int().min(1).max(5).default(3)`
  - `docker-compose.production.yml` already has `TRUST_PROXY_HOPS: ${TRUST_PROXY_HOPS:-3}` (done in Task 4)
  - Proxy chain: CDN→Caddy→Nginx→Express = 3 hops before Express
  - trust proxy = 3 → req.ip = real client IP

  **Must NOT do**: Not modify rate limiter logic, CORS config, CSRF settings

  **Category**: quick
  **Blocks**: Task 10
  **Blocked By**: Task 6 (done ✅)

  **Verification**:
  - `grep "TRUST_PROXY\|trust proxy" apps/api/src/server.ts` → env var with default 3
  - `grep "TRUST_PROXY_HOPS" apps/api/src/config/env.ts` → Zod schema default(3)
  - `cd apps/api && npx tsc --noEmit` → TypeScript clean

  **Evidence**: `.sisyphus/evidence/task-7-trust-proxy.txt`
  **Commit**: `feat(api): update trust proxy for CDN proxy chain`
  **Files**: `apps/api/src/server.ts`, `apps/api/src/config/env.ts`

- [x] 8. Update Caddyfile for CDN Origin Mode

  **What to do**:
  - Modify `deploy/Caddyfile.template`:
    - Add `trusted_proxies` config (trust CDN IPs for X-Forwarded-For)
    - Add `/.well-known/acme-challenge/*` explicit handling (not cached by CDN)
    - Add header forwarding config (X-Forwarded-For)
    - Add comments explaining CDN origin architecture
  - Validate syntax via `scp` to server + `caddy validate`

  **Must NOT do**: Not modify Nginx config (write_nginx_site), not remove static file serving

  **Category**: quick
  **Blocks**: Task 10
  **Blocked By**: Task 6 (done ✅)

  **Verification**:
  - `grep -c "well-known\|acme" deploy/Caddyfile.template` ≥1
  - `grep -c "trusted_proxies" deploy/Caddyfile.template` ≥1
  - Remote caddy validate via ssh

  **Evidence**: `.sisyphus/evidence/task-8-caddy-validate.txt`, `.sisyphus/evidence/task-8-caddy-config-check.txt`
  **Commit**: `feat(infra): update Caddyfile for CDN origin mode`
  **Files**: `deploy/Caddyfile.template`

- [x] 9. Write Alibaba Cloud CDN Setup Guide

  **What to do**:
  - Create `docs/cdn-setup-guide.md` with full Alibaba Cloud CDN configuration:
    1. Prerequisites (domain registered, Aliyun account)
    2. Enable CDN service
    3. Add accelerated domain: `fbif2026ticket.foodtalks.cn`, DCDN, origin: 121.40.214.5:443
    4. Cache rules: `/assets/*` → 30 days; `/api/*`, `/health`, `/metrics`, `/.well-known/*`, `/*` → no-cache
    5. HTTPS configuration
    6. DNS CNAME switch
    7. Verification checklist
    8. Rollback plan (revert DNS CNAME)
    9. DNS TTL considerations (lower to 60s before switch)

  **Must NOT do**: Not actually operate CDN console, not modify code

  **Category**: writing
  **Blocks**: Task 10
  **Blocked By**: Task 6 (done ✅)

  **Verification**:
  - `grep "CNAME" docs/cdn-setup-guide.md` → exists
  - `grep "cache\|缓存" docs/cdn-setup-guide.md` → exists
  - `grep "回源\|origin" docs/cdn-setup-guide.md` → exists
  - `grep "回退\|rollback" docs/cdn-setup-guide.md` → exists

  **Evidence**: `.sisyphus/evidence/task-9-guide-check.txt`
  **Commit**: `docs: add Alibaba Cloud CDN setup guide`
  **Files**: `docs/cdn-setup-guide.md`

- [x] 10. Deploy Route B — PR, Merge + Production Caddy/CDN Setup (Requires User Approval)

  **What to do**:
  - Create branch `feat/performance-route-b` from main (after Task 7/8/9 are merged via worktree)
  - Create PR with Tasks 7, 8, 9 changes
  - Merge to main → preview auto-deploys
  - Verify preview trust proxy behavior
  - Prompt user for approval to apply Caddyfile to production and configure CDN console

  **Must NOT do**: Not apply production Caddyfile without user approval, not operate CDN console

  **Category**: unspecified-high, skills: git-master

- [ ] 11. Verify CDN End-to-End Functionality (External Prerequisite: user completed CDN console config)

  **What to do**:
  - Prerequisite: user completed Alibaba Cloud CDN console setup per `docs/cdn-setup-guide.md`
  - Dynamic discover JS asset: `ssh aliyun-prod-real "ls /var/www/fbif-form/assets/index-*.js"`
  - `curl -I https://fbif2026ticket.foodtalks.cn/assets/<discovered-filename>` → X-Cache: HIT
  - `curl -I https://fbif2026ticket.foodtalks.cn/` → no-store
  - `curl -v https://fbif2026ticket.foodtalks.cn/api/csrf` → 200 + Set-Cookie
  - CSRF round-trip test
  - HTTPS cert valid
  - Health check passes

  **Category**: deep

- [ ] 12. Final K6 Load Test + Update AGENTS.md

  **What to do**:
  - Run K6 step ramp: MAX_RATE=300, target 200 RPS < 2% failure (with production traffic, not single-IP test)
  - Run K6 soak: 100 RPS × 5 min, P95 < 1500ms
  - Update `AGENTS.md` with CDN architecture
  - Generate final performance comparison report

  **Category**: deep

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Verify all Must Have items implemented, Must NOT Have items absent.
  Must Have: PM2 cluster, 3 cores/2GB, 5x rate limits, DB pool 15/process, CDN, trust proxy 3, Caddy CDN mode, K6 verified
  Must NOT Have: App.tsx unchanged, remote-deploy.sh only has --cpus/--memory additions, CSRF settings unchanged

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `cd apps/api && npx tsc --noEmit`
  Check `docker compose -f docker-compose.production.yml config --quiet`
  Check `node -e "require('./apps/api/ecosystem.config.cjs')"`

- [ ] F3. **Real Manual QA** — `unspecified-high`
  SSH verify PM2 running, docker stats healthy, full registration flow through CDN

- [ ] F4. **Scope Fidelity Check** — `deep`
  `git diff origin/main...HEAD --stat` — verify only planned files changed

---

## Success Criteria

- [ ] `docker exec <container> pm2 list` shows 3 API cluster + 1 Worker (done ✅)
- [ ] K6 step ramp: 200 RPS < 2% failure (pending CDN setup)
- [ ] Dynamic asset discovery → CDN cache HIT (pending CDN setup)
- [ ] `curl -v https://fbif2026ticket.foodtalks.cn/api/csrf` → CSRF token + Set-Cookie intact
- [ ] Health check passes

## Evidence Files (completed)
- task-1-server-specs.txt ✅
- task-1-docker-limits.txt ✅
- task-1-prometheus-baseline.txt ✅
- task-1-summary.md ✅
- task-2-ecosystem-config.txt ✅
- task-2-docker-build.txt ✅
- task-2-entrypoint-pm2.txt ✅
- task-5-pm2-list.txt ✅
- task-5-preview-functional.txt ✅
- task-6-k6-route-a.txt ✅
