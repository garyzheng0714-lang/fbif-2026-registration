# FBIF 2026 性能优化：单机配置调优 + 阿里云 CDN 部署

## TL;DR

> **Quick Summary**: 在不加机器的前提下，通过两个方向把 FBIF 2026 注册系统的性能提升 3-4 倍：Route A 解锁服务器闲置算力（PM2 集群 + Docker 资源放开 + 限流放宽），Route B 用阿里云 CDN 让前端完全不走源站。
> 
> **Deliverables**:
> - PM2 集群模式运行 API（3 进程）+ Worker（1 进程）
> - Docker 容器资源从 1 核/512MB 提升到 3 核/2GB
> - 速率限制放宽 5 倍
> - 阿里云 CDN 全站加速配置（静态缓存 + API 回源）
> - Caddy 适配 CDN 回源模式
> - K6 压测对比报告（优化前 vs 优化后）
> 
> **Estimated Effort**: Medium（2-3 天）
> **Parallel Execution**: YES - 4 waves
> **Critical Path**: Task 1(baseline) → Task 5(deploy A) → Task 6(verify A) → Task 10(deploy B) → Task 11(verify B)

---

## Context

### Original Request
用户担心 FBIF 展会现场大流量冲击，服务器 4 核 8GB 但 Docker 只用了 1 核 512MB。希望了解性能瓶颈并优化，同时对 CDN 原理有困惑（已解释清楚）。

### Interview Summary
**Key Discussions**:
- 服务器硬件够用，但 Docker 配置极度保守（1 核 / 512MB），浪费 75% 算力
- 负载测试数据：60 req/s 稳定，100+ req/s 开始失败（2 核 2GB 环境下）
- CDN 原理已讲清：CDN 发前端文件，JS 里的 API 地址直连服务器，CDN 不需要"连"后端
- 前端天然 CDN 就绪：相对路径 `/api/*`、哈希文件名、~250KB 总体积
- 用户选择：A（单机调优）+ B（阿里云 CDN）一起做

**Research Findings**:
- API + Worker 共享同一个 1 核 512MB 容器，互相竞争资源
- 速率限制过于保守：2 req/s 持续 + 20 req/s 突发
- CSRF 端点是首个瓶颈（高并发下 token 生成超时）
- Prometheus 指标已接入（/metrics），K6 测试脚本已有
- 蓝绿部署已就位，不需要改动

### Metis Review
**Identified Gaps** (addressed):
- **`trust proxy` 需更新**：当前设为 `1`（信任 1 跳 Nginx），加 CDN 后链路变为 CDN→Caddy→Nginx→API（Express 前有 3 层代理），需设为 `3`。否则 rate limiter 会把 CDN 的 IP 当成客户端 IP，导致所有用户共享一个限流桶 → 必须修复，通过环境变量 `TRUST_PROXY_HOPS` 配置
- **PM2 与 entrypoint.sh 冲突**：现有 entrypoint.sh 自己管理子进程生命周期，PM2 也管理进程，两套监控会冲突 → 需要用 PM2 ecosystem config 替换 entrypoint.sh
- **Prisma 连接池在集群模式下翻倍**：3 API 进程 × 默认 10 连接 + 1 Worker × 10 = 40 连接，需显式设置每进程连接数
- **Caddy ACME 证书续期可能被 CDN 拦截**：CDN 会拦截 `/.well-known/acme-challenge` 路径 → 需配置 CDN 回源该路径或切换验证方式
- **内存分配需保守**：7.1GB 总内存，API 给 3-4GB 会挤压 PG/Redis/OS → 建议 API 2GB
- **需要回滚方案**：保留旧 entrypoint.sh 作为备份

---

## Work Objectives

### Core Objective
在 4 核 8GB 单机上，通过配置调优 + CDN 部署，将系统承载能力从 ~60 req/s 提升到 ~200 req/s（3x+），同时让前端加载完全不占用源站资源。

### Concrete Deliverables
- `apps/api/ecosystem.config.cjs` — PM2 集群配置文件
- `apps/api/Dockerfile` — 更新入口点为 entrypoint-pm2.sh
- `apps/api/docker/entrypoint-pm2.sh` — 新入口点（migration + PM2）
- `apps/api/docker/entrypoint.sh` — 保留不动（回滚用）
- `docker-compose.production.yml` — 更新资源限制和环境变量
- `apps/api/src/server.ts` — 更新 trust proxy 设置
- `deploy/Caddyfile.template` — 适配 CDN 回源
- `docs/cdn-setup-guide.md` — 阿里云 CDN 配置指南
- K6 压测对比报告（.sisyphus/evidence/）

### Definition of Done
- [ ] `docker exec <container> pm2 list` 显示 3 个 API 实例 + 1 个 Worker
- [ ] K6 `submit-step-ramp` 在 200 RPS 时失败率 < 2%
- [ ] K6 `submit-soak` 在 100 RPS × 5 分钟时失败率 < 1%，P95 < 1500ms
- [ ] 动态发现当前 JS asset 文件名后，`curl -I https://fbif2026ticket.foodtalks.cn/assets/<discovered-filename>` 返回 CDN 缓存命中头
- [ ] `curl -v https://fbif2026ticket.foodtalks.cn/api/csrf` 返回 CSRF token + Set-Cookie 完整

### Must Have
- PM2 集群模式 3 API 进程 + 1 Worker 进程
- Docker API 容器：3 核 / 2GB
- 速率限制放宽 5 倍
- DB 连接池每进程 15（总 60）
- 阿里云 CDN 全站加速（静态缓存 + API 回源）
- trust proxy 适配 CDN 代理链
- Caddy 适配 CDN 回源（ACME 挑战通过）
- K6 对比压测验证

### Must NOT Have (Guardrails)
- **不改** `remote-deploy.sh` 蓝绿部署流程逻辑（preflight/prepare/promote/rollback 流程），**但允许**在 `docker run` 命令中添加 `--cpus` 和 `--memory` 资源限制参数（最小改动，不影响部署流程）
- **不改** Nginx 配置（`write_nginx_site()` 函数）
- **不改** `App.tsx` 前端代码（2760 行，不碰）
- **不改** Vite 构建配置
- **不改** CSRF cookie 设置（`sameSite: 'strict'` 在 CDN CNAME 下不受影响）
- **不改** `VITE_API_URL` 或前端 API URL 逻辑（相对路径已兼容 CDN）
- **不改** 飞书同步逻辑、背压阈值、重试策略
- **不改** preview/staging 专有配置（docker-compose 文件中 preview 的端口、项目名等），但 **允许** 通过 `docker-compose.production.yml` 调整 preview 共享的资源限制和环境变量（用于验证生产配置变更）
- **不加** Grafana/监控面板（scope creep）
- **不加** PgBouncer 外部连接池（scope creep）
- **不加** 除 PM2 外的新 npm 依赖
- **不移** OSS banner URL 到环境变量（装饰性改动，非性能相关）
- **不拆** API 和 Worker 到独立容器（留给未来优化）

---

## Verification Strategy

> **Agent-Executed Verification** — 所有代码修改、部署、QA 验证由 Agent 执行。
> **External Prerequisite**: 阿里云 CDN 控制台配置需要用户手动完成（Task 10 提供指南，Task 11 验证生效）。
> 执行边界：Agent 生成配置指南 → **用户在阿里云控制台操作** → Agent 验证 CDN 生效。
> 代码层面的验收标准不允许要求"用户手动测试代码"。

### Test Decision
- **Infrastructure exists**: YES（K6 测试脚本、Prometheus 指标已就位）
- **Automated tests**: Tests-after（基础设施配置变更，用 K6 压测验证效果）
- **Framework**: K6 (load testing) + curl (functional verification) + docker inspect (config verification)

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Config verification**: Use Bash (docker inspect, docker exec, curl) — 检查资源限制、进程数、环境变量
- **Load testing**: Use Bash (K6) — 压测对比
- **CDN verification**: Use Bash (curl -I) — 检查缓存头、CSRF cookie 传递
- **API verification**: Use Bash (curl -v) — 检查 API 响应、rate limit 行为

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — all code changes in parallel):
├── Task 1: Capture performance baseline (K6 + docker stats) [quick]
├── Task 2: PM2 cluster mode setup (ecosystem config + Dockerfile) [unspecified-high]
├── Task 3: Docker resource limits tuning [quick]
└── Task 4: Performance env vars tuning (rate limits, DB pool, worker) [quick]

Wave 2 (After Wave 1 — Route A deploy + verify):
├── Task 5: Create Route A PR, merge, verify preview (depends: 2,3,4) [unspecified-high]
└── Task 6: K6 load test comparison (depends: 1,5) [deep]

Wave 3 (After Wave 2 verified — CDN prep, parallel):
├── Task 7: Update trust proxy for CDN proxy chain (depends: 6) [quick]
├── Task 8: Update Caddyfile for CDN origin mode (depends: 6) [quick]
└── Task 9: Write Alibaba Cloud CDN setup guide (depends: 6) [writing]

Wave 4 (After Wave 3 — CDN deploy + verify):
├── Task 10: Create Route B PR, deploy + CDN console setup guide (depends: 7,8,9) [unspecified-high]
├── Task 11: Verify CDN end-to-end (depends: 10) [deep]
└── Task 12: Final K6 load test + update AGENTS.md (depends: 11) [deep]

Wave FINAL (After ALL tasks — independent review, 4 parallel):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)

Critical Path: Task 1 → Task 5 → Task 6 → Task 10 → Task 11 → Task 12 → F1-F4
Parallel Speedup: ~50% faster than sequential
Max Concurrent: 4 (Wave 1)
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|-----------|--------|------|
| 1 | — | 6 | 1 |
| 2 | — | 5 | 1 |
| 3 | — | 5 | 1 |
| 4 | — | 5 | 1 |
| 5 | 2, 3, 4 | 6, 7, 8, 9 | 2 |
| 6 | 1, 5 | 7, 8, 9 | 2 |
| 7 | 6 | 10 | 3 |
| 8 | 6 | 10 | 3 |
| 9 | 6 | 10 | 3 |
| 10 | 7, 8, 9 | 11 | 4 |
| 11 | 10 | 12 | 4 |
| 12 | 11 | F1-F4 | 4 |

### Agent Dispatch Summary

- **Wave 1**: 4 tasks — T1 `quick`, T2 `unspecified-high`, T3 `quick`, T4 `quick`
- **Wave 2**: 2 tasks — T5 `unspecified-high`, T6 `deep`
- **Wave 3**: 3 tasks — T7 `quick`, T8 `quick`, T9 `writing`
- **Wave 4**: 3 tasks — T10 `unspecified-high`, T11 `deep`, T12 `deep`
- **FINAL**: 4 tasks — F1 `oracle`, F2 `unspecified-high`, F3 `unspecified-high`, F4 `deep`

---

## TODOs

- [x] 1. Capture Current Performance Baseline

  **What to do**:
  - SSH 到服务器，获取当前系统状态快照：`docker stats --no-stream`，`docker inspect` 资源限制，`pm2 list`（如果有的话）
  - 获取当前 API 容器的 Prometheus 指标：`docker exec fbif-form-api-blue curl -s localhost:8080/metrics` → 保存到证据文件
  - 获取 PostgreSQL 连接数：`docker exec fbif-form-postgres-1 psql -U fbif -d fbif_form -c 'SHOW max_connections'`
  - 验证服务器实际核心数和内存：`ssh aliyun-prod-real 'nproc && free -h'`
  - 如果 preview 环境可用，运行 K6 基线测试：`k6 run --env MAX_RATE=200 tests/k6/submit-step-ramp.js`（目标是记录当前失败率，作为优化后的对比基线）
  - 将所有输出保存为 baseline 证据文件

  **Must NOT do**:
  - 不修改任何文件，只读取和记录
  - 不在生产环境运行 K6（用 preview 或跳过）

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 纯数据采集任务，不涉及代码修改
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `playwright-interactive`: 不涉及浏览器操作

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3, 4)
  - **Blocks**: Task 6 (load test comparison needs baseline)
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `tests/k6/submit-step-ramp.js` — K6 阶梯压测脚本，用 `MAX_RATE` 环境变量控制峰值 RPS
  - `tests/k6/submit-soak.js` — K6 持续压测脚本，用 `SOAK_RPS` 和 `SOAK_MINUTES` 控制
  - `docs/extreme-performance-report-2026-02-11.md` — 历史压测报告，包含基线数据格式参考

  **API/Type References**:
  - `apps/api/src/metrics.ts` — Prometheus 指标定义，了解有哪些指标可采集

  **External References**:
  - K6 官方文档: https://k6.io/docs/

  **WHY Each Reference Matters**:
  - K6 脚本用于运行基线测试，report 文档用于了解输出格式
  - metrics.ts 了解有哪些 Prometheus 指标可作为 baseline 数据

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Capture server hardware specs
    Tool: Bash (ssh)
    Preconditions: SSH access to aliyun-prod-real
    Steps:
      1. ssh aliyun-prod-real 'nproc' → 记录 CPU 核心数
      2. ssh aliyun-prod-real 'free -h' → 记录总内存和可用内存
      3. ssh aliyun-prod-real 'docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}"' → 记录容器资源使用
    Expected Result: 核心数 = 4, 总内存 ≈ 7.1 GB, 容器状态正常
    Failure Indicators: SSH 连接失败, docker 命令报错
    Evidence: .sisyphus/evidence/task-1-server-specs.txt

  Scenario: Capture current Docker resource limits
    Tool: Bash (ssh + docker inspect)
    Preconditions: SSH access, API container running
    Steps:
      1. ssh aliyun-prod-real "docker inspect --format='CPUs: {{.HostConfig.NanoCpus}} Memory: {{.HostConfig.Memory}}' fbif-form-api-blue" → 记录 CPU 和内存限制
      2. ssh aliyun-prod-real "docker inspect --format='CPUs: {{.HostConfig.NanoCpus}} Memory: {{.HostConfig.Memory}}' fbif-form-api-green" → 如果 green 也在运行
    Expected Result: NanoCpus = 1000000000 (1 core), Memory = 536870912 (512MB)
    Failure Indicators: 容器不存在或未运行
    Evidence: .sisyphus/evidence/task-1-docker-limits.txt

  Scenario: Capture Prometheus metrics snapshot
    Tool: Bash (ssh + curl)
    Preconditions: API container running with /metrics endpoint
    Steps:
      1. 确定活跃的 API 容器（blue 或 green）
      2. ssh aliyun-prod-real "docker exec <active-container> curl -s localhost:8080/metrics" → 保存完整指标
    Expected Result: 输出包含 fbif_http_requests_total, fbif_submissions_accepted_total 等指标
    Failure Indicators: curl 返回空或连接拒绝
    Evidence: .sisyphus/evidence/task-1-prometheus-baseline.txt
  ```

  **Evidence to Capture:**
  - [ ] task-1-server-specs.txt — 服务器硬件信息
  - [ ] task-1-docker-limits.txt — 当前 Docker 资源限制
  - [ ] task-1-prometheus-baseline.txt — Prometheus 指标快照
  - [ ] task-1-k6-baseline.txt — K6 基线测试结果（如果 preview 可用）

  **Commit**: NO (只采集数据，不修改代码)

- [x] 2. PM2 Cluster Mode Setup

  **What to do**:
  - 在 `apps/api/` 目录下创建 `ecosystem.config.cjs`，配置：
    - API 进程：cluster 模式, 3 个实例, 入口 `dist/index.js`
    - Worker 进程：fork 模式, 1 个实例, 入口 `dist/worker.js`（仅当 `RUN_WORKER=true` 时启用）
    - 环境变量从 `process.env` 透传
    - 优雅关闭：`kill_timeout: 15000`（匹配 Docker stop_grace_period）
    - 日志：输出到 stdout/stderr（Docker 日志收集）
  - 创建 `apps/api/docker/entrypoint-pm2.sh`（新文件，不覆盖旧 entrypoint）：
    ```sh
    #!/bin/sh
    set -eu
    # 第一步：运行数据库迁移（与旧 entrypoint.sh 一致）
    if [ "${RUN_DB_MIGRATE:-true}" = "true" ]; then
      echo "[entrypoint] Running prisma migrate deploy..."
      npx prisma migrate deploy
    fi
    # 第二步：启动 PM2（前台模式，管理 API cluster + Worker）
    echo "[entrypoint] Starting PM2 runtime..."
    exec pm2-runtime ecosystem.config.cjs
    ```
    关键点：先运行 `prisma migrate deploy`（阻塞式），成功后再 `exec pm2-runtime`。`exec` 确保 PM2 成为 PID 1，正确接收 Docker SIGTERM。
  - 更新 `apps/api/Dockerfile` runtime 阶段：
    - 添加 `RUN npm install -g pm2` 到 runtime 阶段（非 build 阶段，因为 pm2 是运行时依赖）
    - 添加 `COPY --from=build /app/ecosystem.config.cjs ./ecosystem.config.cjs`
    - 添加 `COPY apps/api/docker/entrypoint-pm2.sh /entrypoint-pm2.sh` 和 `RUN chmod +x /entrypoint-pm2.sh`
    - 修改 `ENTRYPOINT ["/entrypoint-pm2.sh"]`（替换 `ENTRYPOINT ["/entrypoint.sh"]`）
    - 保留旧的 `COPY apps/api/docker/entrypoint.sh /entrypoint.sh` 和 `RUN chmod +x /entrypoint.sh`（回滚用）
  - **不删除、不重命名** `apps/api/docker/entrypoint.sh`（保持原样作为回滚方案）
  - 回滚方式：将 Dockerfile 的 ENTRYPOINT 改回 `["/entrypoint.sh"]` 即可恢复旧行为
  - 注意：`pm2-runtime` 是 PM2 提供的 Docker 专用命令，保持前台运行
  - 注意：不要使用 `pm2 start` + `pm2 logs`（会在后台运行，Docker 会立即退出）

  **Must NOT do**:
  - 不拆分 API 和 Worker 到独立容器（保持现有单容器架构）
  - 不添加除 pm2 外的新依赖
  - 不修改 API 或 Worker 的业务逻辑代码
  - 不修改 remote-deploy.sh

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 涉及多文件修改（新建 ecosystem config + 修改 Dockerfile + 备份 entrypoint），需要理解 PM2 和 Docker 的交互
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `deploy`: 不涉及部署操作，只是代码修改

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3, 4)
  - **Blocks**: Task 5 (Route A PR creation)
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `apps/api/docker/entrypoint.sh:1-50` — 当前入口点脚本，了解 API 和 Worker 是如何一起启动的（两个 `node` 进程 + PID 监控 + trap 信号处理）
  - `apps/api/Dockerfile:1-30` — 当前 Dockerfile，了解构建流程（多阶段构建，node:20-bookworm 基础镜像）
  - `apps/api/src/worker.ts:220-230` — Worker 的优雅关闭逻辑（12s 超时），PM2 的 kill_timeout 需要覆盖这个时间

  **API/Type References**:
  - `apps/api/src/config/env.ts` — 所有环境变量定义，ecosystem.config.cjs 不需要重复定义，只需透传 process.env

  **External References**:
  - PM2 ecosystem 文件文档: https://pm2.keymetrics.io/docs/usage/application-declaration/
  - PM2 Docker 集成: https://pm2.keymetrics.io/docs/usage/docker-pm2-nodejs/

  **WHY Each Reference Matters**:
  - entrypoint.sh 展示了当前 API+Worker 共存的方式（双进程 + PID 监控），PM2 ecosystem config 需要等价替换这个逻辑
  - Dockerfile 展示了构建流程，需要在正确位置插入 pm2 安装
  - worker.ts 的 shutdown 超时决定了 PM2 kill_timeout 的最小值

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: PM2 ecosystem config is valid
    Tool: Bash (node)
    Preconditions: ecosystem.config.cjs 已创建
    Steps:
      1. cd apps/api && node -e "const c = require('./ecosystem.config.cjs'); console.log(JSON.stringify(c, null, 2))"
      2. 验证输出包含两个 app 配置：一个 cluster 模式（instances: 3），一个 fork 模式（instances: 1）
      3. 验证 cluster 模式 app 的 script 指向 dist/index.js
      4. 验证 fork 模式 app 的 script 指向 dist/worker.js
    Expected Result: JSON 输出包含 2 个 apps，API 为 cluster/3 实例，Worker 为 fork/1 实例
    Failure Indicators: require() 报错，apps 数量不对，模式或路径错误
    Evidence: .sisyphus/evidence/task-2-ecosystem-config.txt

  Scenario: Dockerfile builds successfully with PM2
    Tool: Bash (docker build)
    Preconditions: Dockerfile 已更新，从仓库根目录运行（Dockerfile 使用 COPY apps/api/... 需要根上下文）
    Steps:
      1. docker build -f apps/api/Dockerfile -t fbif-api-test --build-arg VITE_API_URL="" . （从仓库根目录运行）
      2. docker run --rm --entrypoint pm2 fbif-api-test --version → 验证 PM2 已安装（需 --entrypoint 覆盖默认入口点）
      3. docker run --rm --entrypoint ls fbif-api-test ecosystem.config.cjs → 验证配置文件存在
      4. docker run --rm --entrypoint cat fbif-api-test /entrypoint-pm2.sh → 验证新入口点包含 prisma migrate + pm2-runtime
    Expected Result: 构建成功，PM2 版本号输出，配置文件和入口点均存在
    Failure Indicators: docker build 失败（上下文路径错误），pm2 命令不存在
    Evidence: .sisyphus/evidence/task-2-docker-build.txt

  Scenario: New entrypoint-pm2.sh created and old entrypoint preserved
    Tool: Bash (ls + cat)
    Preconditions: 新入口点已创建
    Steps:
      1. ls -la apps/api/docker/entrypoint-pm2.sh → 验证新入口点存在
      2. ls -la apps/api/docker/entrypoint.sh → 验证旧入口点仍存在（未删除）
      3. grep "prisma migrate deploy" apps/api/docker/entrypoint-pm2.sh → 验证包含迁移步骤
      4. grep "pm2-runtime" apps/api/docker/entrypoint-pm2.sh → 验证使用 pm2-runtime
      5. grep "exec pm2-runtime" apps/api/docker/entrypoint-pm2.sh → 验证使用 exec（PID 1）
    Expected Result: 新入口点包含 migration + pm2-runtime with exec，旧入口点保留
    Failure Indicators: 文件不存在，缺少 migration 或 pm2-runtime
    Evidence: .sisyphus/evidence/task-2-entrypoint-pm2.txt
  ```

  **Evidence to Capture:**
  - [ ] task-2-ecosystem-config.txt — ecosystem.config.cjs 验证输出
  - [ ] task-2-docker-build.txt — Docker 构建验证
  - [ ] task-2-entrypoint-pm2.txt — 新入口点验证

  **Commit**: YES (groups with Task 3, 4)
  - Message: `feat(api): add PM2 cluster mode with ecosystem config`
  - Files: `apps/api/ecosystem.config.cjs`, `apps/api/Dockerfile`, `apps/api/docker/entrypoint-pm2.sh`
  - Pre-commit: `cd apps/api && node -e "require('./ecosystem.config.cjs')"`

- [x] 3. Docker Resource Limits Tuning (Production + Preview)

  **What to do**:
  - **关键背景**：生产环境的 API 蓝绿容器由 `scripts/remote-deploy.sh` 通过 `docker run` 启动（第 539 行），而非 `docker compose up`。因此资源限制必须同时修改两个位置：
  
  - **A) 修改 `scripts/remote-deploy.sh`**（生产环境生效）：
    - 在 `docker run` 命令（第 539-550 行）中添加资源限制参数：
      ```diff
      docker run -d \
        --name "${container_name}" \
        --restart unless-stopped \
      + --cpus 3 \
      + --memory 2g \
        --network "${COMPOSE_PROJECT_NAME}_private" \
      ```
    - 只改这两行，不动其他部署逻辑
  
  - **B) 修改 `docker-compose.production.yml`**（Preview 环境生效）：
    - API 容器的 `cpus`: `"1.00"` → `"3.00"`
    - API 容器的 `mem_limit`: `512m` → `2g`
    - 为 PostgreSQL 容器添加 `mem_limit: 2g`
    - 为 Redis 容器添加 `mem_limit: 512m`
  
  - 验证 `stop_grace_period` 设置为至少 `20s`

  **Must NOT do**:
  - 不修改 remote-deploy.sh 的蓝绿部署流程逻辑（preflight/prepare/promote/rollback 函数），只在 docker run 命令添加 --cpus 和 --memory
  - 不修改端口映射、网络配置、volume 挂载

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 两个文件的小改动（加两个 docker run 参数 + 改几个数字）
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 4)
  - **Blocks**: Task 5
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `scripts/remote-deploy.sh:539-550` — 生产 API 容器的 `docker run` 命令，需要在此添加 `--cpus 3 --memory 2g`
  - `docker-compose.production.yml:85-92` — Preview API 容器的资源限制（当前 cpus: "1.00", mem_limit: 512m）
  - `docker-compose.production.yml:96-125` — PG 和 Redis 容器定义（当前无限制）

  **WHY Each Reference Matters**:
  - remote-deploy.sh 的 docker run 是生产容器的实际启动路径，docker-compose 只影响 preview
  - 必须两处都改，否则生产/preview 行为不一致

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: remote-deploy.sh includes resource limits
    Tool: Bash (grep)
    Preconditions: remote-deploy.sh 已修改
    Steps:
      1. grep "\-\-cpus" scripts/remote-deploy.sh → 应包含 --cpus 3
      2. grep "\-\-memory" scripts/remote-deploy.sh → 应包含 --memory 2g
      3. 验证 --cpus 和 --memory 在 docker run 命令块内（第 539-550 行区域）
    Expected Result: docker run 包含 --cpus 3 --memory 2g
    Failure Indicators: grep 无结果，或参数位置错误
    Evidence: .sisyphus/evidence/task-3-remote-deploy-limits.txt

  Scenario: Docker compose config is valid for preview
    Tool: Bash (docker compose)
    Preconditions: docker-compose.production.yml 已修改
    Steps:
      1. docker compose -f docker-compose.production.yml config --quiet → YAML 语法正确
      2. docker compose -f docker-compose.production.yml config | grep "mem_limit" → 验证内存设置
    Expected Result: Preview 配置 API cpus=3.00, mem_limit=2g
    Evidence: .sisyphus/evidence/task-3-docker-compose-config.txt

  Scenario: Total resource allocation within server capacity
    Tool: Bash (calculation)
    Steps:
      1. API(2g) + PG(2g) + Redis(512m) = 4.5GB（服务器 7.1GB，留 2.6GB）
      2. API(3 cores)（服务器 4 cores，留 1 core）
    Expected Result: 内存 < 65%，CPU < 75% 服务器容量
    Evidence: .sisyphus/evidence/task-3-resource-calculation.txt
  ```

  **Commit**: YES (groups with Task 2, 4)
  - Message: `feat(infra): add resource limits to production docker run and preview compose`
  - Files: `scripts/remote-deploy.sh`, `docker-compose.production.yml`

- [x] 4. Performance Environment Variables Tuning (Production + Preview)

  **What to do**:
  - **关键背景**：生产环境的 API env vars 通过 `--env-file "${BACKEND_ENV_STAGED}"` 传入（来源 `/opt/web-fbif-form/shared/backend.env`，由 `scripts/update-backend-env.sh` 管理）。Preview 环境通过 `docker-compose.production.yml` 传入。
  
  - **A) 修改 `scripts/update-backend-env.sh`**（影响生产 backend.env）：
    - 确保以下变量在 `REQUIRED_KEYS` 或默认值中：
      - `RATE_LIMIT_MAX=600`（从 120 增加到 600，5x）
      - `RATE_LIMIT_BURST=100`（从 20 增加到 100，5x）
      - `CSRF_RATE_LIMIT_MAX=6000`（从 2400 增加到 6000，2.5x）
      - `DB_POOL_CONNECTION_LIMIT=15`（新增，每进程 15 连接）
      - `DB_POOL_TIMEOUT_S=30`（新增）
      - `FEISHU_WORKER_CONCURRENCY=20`（从 10 增加到 20）
      - `FEISHU_WORKER_QPS=20`（从 10 增加到 20）
    - 注意：update-backend-env.sh 的逻辑是合并 CI secrets 到 backend.env。这些变量需要在 GitHub Actions secrets 或脚本默认值中设置
  
  - **B) 修改 `docker-compose.production.yml`**（影响 Preview）：
    - 更新上述变量的默认值（格式 `${VAR:-default}`）
  
  - **C) 更新 `.env.example`**（文档目的）：
    - 在 `apps/api/.env.example` 中添加新变量的说明

  **Must NOT do**:
  - 不修改 `apps/api/src/config/env.ts`（保持代码层默认值不变）
  - 不修改飞书同步逻辑或背压阈值
  - 不修改 CSRF cookie 设置

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 多文件但都是改数值
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 3)
  - **Blocks**: Task 5
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `scripts/update-backend-env.sh` — 生产 env 管理脚本，了解如何添加/更新变量
  - `docker-compose.production.yml:50-80` — Preview env 默认值格式
  - `apps/api/src/config/env.ts:20-50` — Zod schema 确认变量名和类型正确
  - `apps/api/src/middleware/rateLimit.ts` — 限流中间件使用这些变量
  - `apps/api/src/utils/db.ts:9-14` — 连接池参数如何拼接到 DATABASE_URL

  **WHY Each Reference Matters**:
  - update-backend-env.sh 是生产环境的 env 入口，docker-compose 只影响 preview
  - env.ts 确认变量名和类型，rateLimit.ts/db.ts 确认使用方式

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Env vars updated in both production and preview paths
    Tool: Bash (grep)
    Steps:
      1. grep "RATE_LIMIT_MAX" scripts/update-backend-env.sh → 应有 600 或对应的默认值
      2. docker compose -f docker-compose.production.yml config | grep RATE_LIMIT_MAX → Preview 应显示 600
      3. grep "DB_POOL_CONNECTION_LIMIT" docker-compose.production.yml → 应显示 15
      4. grep "FEISHU_WORKER_CONCURRENCY" docker-compose.production.yml → 应显示 20
    Expected Result: 生产和 preview 两个路径的 env vars 都已更新
    Evidence: .sisyphus/evidence/task-4-env-vars.txt

  Scenario: Connection pool math is correct
    Tool: Bash (calculation)
    Steps:
      1. 3 API workers × 15 + 1 Worker × 15 = 60 总连接
      2. PostgreSQL max_connections 默认 100 > 60
    Expected Result: 总连接 60 < PostgreSQL max 100，headroom 40%
    Evidence: .sisyphus/evidence/task-4-pool-calculation.txt
  ```

  **Commit**: YES (groups with Task 2, 3)
  - Message: `feat(infra): tune rate limits, DB pool, and worker concurrency for production and preview`
  - Files: `scripts/update-backend-env.sh`, `docker-compose.production.yml`, `apps/api/.env.example`

- [x] 5. Deploy Route A — PR, Merge, Verify Preview

  **What to do**:
  - 创建功能分支 `feat/performance-route-a`
  - 将 Task 2, 3, 4 的修改提交到分支
  - 创建 PR 合并到 main，标题：`feat: performance optimization Route A - PM2 cluster + resource tuning`
  - PR 描述包含：变更摘要、预期效果（3-4x 吞吐量提升）、回滚方案（将 Dockerfile ENTRYPOINT 改回 `/entrypoint.sh`，旧入口点保留在 `apps/api/docker/entrypoint.sh` 未动）
  - 合并后等待自动 preview 部署完成
  - SSH 到服务器验证 preview 环境：
    - `docker exec fbif-form-staging-api-1 pm2 list` → 确认 PM2 集群模式运行
    - `docker stats fbif-form-staging-api-1 --no-stream` → 确认资源限制生效
    - `curl -sf http://121.40.214.5:3003/health` → 确认服务正常
    - `curl -sf http://121.40.214.5:3003/api/csrf` → 确认 CSRF token 可获取
  - 注意：preview 使用 `fbif-form-staging` 项目名，API 端口 8083，容器名 `fbif-form-staging-api-1`

  **Must NOT do**:
  - 不直接 push 到 main（走 PR 流程）
  - 不部署到生产（等用户确认）
  - 不修改 preview 的 docker-compose 配置

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 需要 Git 操作 + SSH 验证 + 多步骤确认
  - **Skills**: [`git-master`]
    - `git-master`: PR 创建和 Git 操作

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2 (sequential after Wave 1)
  - **Blocks**: Tasks 6, 7, 8, 9
  - **Blocked By**: Tasks 2, 3, 4

  **References**:

  **Pattern References**:
  - `.github/workflows/deploy-preview.yml` — Preview 部署 workflow，了解 push to main 触发的部署流程
  - `AGENTS.md` 的"开发工作流规范"部分 — PR 和部署流程说明

  **WHY Each Reference Matters**:
  - deploy-preview.yml 了解部署流程和目标路径，用于验证部署是否成功
  - AGENTS.md 确认工作流规范（PR → merge → auto preview → 用户确认 → 生产）

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: PM2 cluster running on preview
    Tool: Bash (ssh)
    Preconditions: PR 已合并，preview 部署完成
    Steps:
      1. 等待 preview 部署完成（检查 GitHub Actions 状态或等待 2 分钟）
      2. ssh aliyun-prod-real "docker exec fbif-form-staging-api-1 pm2 list" → 验证 3 个 API 实例 + 1 个 Worker 实例
      3. ssh aliyun-prod-real "docker stats fbif-form-staging-api-1 --no-stream" → 验证资源使用合理
    Expected Result: pm2 list 显示 4 个进程（3 API cluster + 1 Worker fork），全部 online 状态
    Failure Indicators: pm2 命令不存在，进程数不对，有 errored 状态
    Evidence: .sisyphus/evidence/task-5-pm2-list.txt

  Scenario: Preview API functional
    Tool: Bash (curl)
    Preconditions: Preview 部署完成
    Steps:
      1. curl -sf http://121.40.214.5:3003/health → 应返回 {"ok":true} 或类似
      2. curl -sf http://121.40.214.5:3003/api/csrf → 应返回 JSON 包含 csrfToken
      3. curl -I http://121.40.214.5:3003/ → 应返回 200 + HTML
    Expected Result: 所有端点正常响应
    Failure Indicators: 502/503 错误，连接拒绝
    Evidence: .sisyphus/evidence/task-5-preview-functional.txt
  ```

  **Commit**: YES
  - Message: PR via `gh pr create`
  - Pre-commit: `cd apps/api && tsc --noEmit`

- [ ] 6. K6 Load Test Comparison — Route A Effectiveness

  **What to do**:
  - 在 preview 环境运行 K6 阶梯压测，与 Task 1 的 baseline 对比：
    - `k6 run --env MAX_RATE=300 --env TARGET_URL=http://121.40.214.5:3003 tests/k6/submit-step-ramp.js`
    - 或者如果 K6 脚本不支持 TARGET_URL，检查脚本并调整目标地址
  - 记录关键指标：
    - 各 RPS 级别的失败率
    - P95 和 P99 延迟
    - 200/202 vs 429/500 响应比例
  - 同时运行 `docker stats` 监控资源使用
  - 对比 baseline：目标是 200 RPS 时失败率 < 2%
  - 如果不满足目标，分析瓶颈并记录（可能需要微调 PM2 实例数或连接池）
  - 将对比报告保存到证据文件

  **Must NOT do**:
  - 不在生产环境运行压测
  - 不修改 K6 测试脚本逻辑（只调参数）
  - 如果 preview 不适合压测（资源配置不同），记录原因并跳过，改用理论分析

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 需要分析压测结果、对比 baseline、可能需要诊断瓶颈
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2 (sequential, after Task 5)
  - **Blocks**: Tasks 7, 8, 9
  - **Blocked By**: Tasks 1 (baseline), 5 (deploy)

  **References**:

  **Pattern References**:
  - `tests/k6/submit-step-ramp.js` — 阶梯压测脚本，查看支持的环境变量和目标 URL 配置
  - `tests/k6/submit-soak.js` — 持续压测脚本，可作为补充测试
  - `docs/extreme-performance-report-2026-02-11.md` — 历史报告格式，对比数据参考

  **WHY Each Reference Matters**:
  - K6 脚本是实际运行的测试，需要了解参数和目标 URL 如何配置
  - 历史报告提供对比基准（60 req/s stable on 2 core/2GB）

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: K6 step ramp shows improvement
    Tool: Bash (k6)
    Preconditions: Preview deployed with Route A changes, Task 1 baseline available
    Steps:
      1. 运行 K6 阶梯压测（目标 preview 环境）
      2. 记录每个 RPS 级别的失败率
      3. 对比 Task 1 baseline
    Expected Result: 200 RPS 时失败率 < 2%（baseline 预期 100 RPS 就开始失败）
    Failure Indicators: 失败率未改善或恶化
    Evidence: .sisyphus/evidence/task-6-k6-route-a.txt

  Scenario: Resource utilization during load
    Tool: Bash (ssh + docker stats)
    Preconditions: K6 测试正在运行
    Steps:
      1. 在 K6 运行期间：ssh aliyun-prod-real "docker stats fbif-form-staging-api-1 --no-stream"
      2. 多次采样（每 30 秒一次）
      3. 记录 CPU% 和 Memory 使用
    Expected Result: CPU 使用在峰值时 < 250%（3 核上限 300%），内存 < 1.5GB（2GB 上限）
    Failure Indicators: CPU 持续 300%（满载），内存接近 2GB（OOM 风险）
    Evidence: .sisyphus/evidence/task-6-resource-usage.txt
  ```

  **Commit**: NO (测试报告，不修改代码)

- [ ] 7. Update Trust Proxy for CDN Proxy Chain

  **What to do**:
  - 修改 `apps/api/src/server.ts` 中的 `trust proxy` 设置：
    - 当前：`app.set('trust proxy', 1)` — 只信任 1 跳（Nginx），不适用于 CDN 架构
    - 代理链分析：`Client → CDN → Caddy → Nginx → Express`（Express 前面有 3 层代理）
      - Nginx `$proxy_add_x_forwarded_for` 会追加 IP 到 XFF
      - Caddy 默认追加 IP 到 XFF
      - CDN 设置 XFF 为客户端真实 IP
      - 最终 XFF 到达 Express 时包含 3 个 IP：`"client-ip, cdn-ip, caddy-ip"`
      - `remoteAddress` = Nginx IP (127.0.0.1)
      - trust proxy = 3 → Express 信任 3 跳 → `req.ip` = client-ip ✅
    - 改为通过环境变量配置：
      ```typescript
      app.set('trust proxy', parseInt(process.env.TRUST_PROXY_HOPS || '3', 10))
      ```
    - 默认值 `3` 适用于 CDN 架构。如果暂时不上 CDN，可通过环境变量设为 `2`
  - 在 `apps/api/src/config/env.ts` 中添加 `TRUST_PROXY_HOPS` 环境变量（遵循现有 Zod schema 模式）：
    - 类型：`z.coerce.number().int().min(1).max(5).default(3)`
  - 在 `docker-compose.production.yml` 中为 API 容器添加：`TRUST_PROXY_HOPS=${TRUST_PROXY_HOPS:-3}`
  - 这个改动确保：
    - Rate limiter 使用真实客户端 IP（而不是 CDN 节点 IP）
    - 日志记录真实客户端 IP
    - `req.ip` 返回正确值

  **Must NOT do**:
  - 不修改 rate limiter 逻辑本身
  - 不修改 CORS 配置
  - 不修改 CSRF 设置

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 改一行代码（trust proxy 值），可选加一个环境变量
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 8, 9)
  - **Blocks**: Task 10
  - **Blocked By**: Task 6

  **References**:

  **Pattern References**:
  - `apps/api/src/server.ts:39` — 当前 `app.set('trust proxy', 1)` 位置
  - `apps/api/src/config/env.ts` — 环境变量 Zod schema 模式，用于添加 TRUST_PROXY_HOPS
  - `apps/api/src/middleware/rateLimit.ts` — 使用 `req.ip` 做限流，trust proxy 直接影响这个值

  **WHY Each Reference Matters**:
  - server.ts 是修改目标，rateLimit.ts 是受影响的下游
  - env.ts 是添加环境变量的模式参考

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Trust proxy setting updated
    Tool: Bash (grep)
    Preconditions: server.ts 已修改
    Steps:
      1. grep "trust proxy\|TRUST_PROXY" apps/api/src/server.ts → 应显示从环境变量读取，默认值为 3
      2. grep "TRUST_PROXY_HOPS" apps/api/src/config/env.ts → 应显示 Zod schema 定义，default(3)
      3. cd apps/api && npx tsc --noEmit → TypeScript 编译无错误
    Expected Result: trust proxy 通过 TRUST_PROXY_HOPS 环境变量配置，默认值 3，TypeScript 编译通过
    Failure Indicators: 值仍硬编码为 1，缺少环境变量定义，TypeScript 报错
    Evidence: .sisyphus/evidence/task-7-trust-proxy.txt

  Scenario: Rate limiter will use correct IP after CDN
    Tool: Bash (curl + log inspection)
    Preconditions: 部署到 preview 后
    Steps:
      1. curl -H "X-Forwarded-For: 1.2.3.4, 10.0.0.1" http://121.40.214.5:3003/api/csrf
      2. 检查 API 日志中记录的客户端 IP 是否为 1.2.3.4（而非 10.0.0.1）
    Expected Result: API 日志显示客户端 IP 为 X-Forwarded-For 链的正确位置
    Evidence: .sisyphus/evidence/task-7-ip-verification.txt
  ```

  **Commit**: YES
  - Message: `feat(api): update trust proxy for CDN proxy chain`
  - Files: `apps/api/src/server.ts`, optionally `apps/api/src/config/env.ts`
  - Pre-commit: `cd apps/api && npx tsc --noEmit`

- [ ] 8. Update Caddyfile for CDN Origin Mode

  **What to do**:
  - 修改 `deploy/Caddyfile.template` 以适配 CDN 回源模式：
    - 添加 `/.well-known/acme-challenge/*` 路径的直接处理（不被 CDN 缓存拦截）
    - 添加 `trusted_proxies` 配置信任 CDN 节点 IP 段（阿里云 CDN IP 段或使用通配符）
    - 确保 `X-Forwarded-For` 头正确透传
    - 添加注释说明 CDN 回源架构
  - 验证 Caddy 配置语法正确
  - 注意：Caddy 作为回源服务器，CDN 节点会作为 client 连接 Caddy。Caddy 需要信任 CDN 传来的 `X-Forwarded-For` 头

  **Must NOT do**:
  - 不修改 Nginx 配置（remote-deploy.sh 中的 write_nginx_site）
  - 不修改端口映射
  - 不移除现有的静态文件服务配置（CDN 回源时仍需要 Caddy 返回文件）

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 单文件修改，添加几行 Caddy 配置
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 7, 9)
  - **Blocks**: Task 10
  - **Blocked By**: Task 6

  **References**:

  **Pattern References**:
  - `deploy/Caddyfile.template` — 当前 Caddy 配置，了解现有结构（HTTPS、静态文件、API 反向代理）

  **External References**:
  - Caddy trusted_proxies 文档: https://caddyserver.com/docs/caddyfile/options#trusted-proxies
  - 阿里云 CDN 回源 IP: https://help.aliyun.com/document_detail/27152.html

  **WHY Each Reference Matters**:
  - Caddyfile.template 是修改目标，需了解现有配置结构
  - trusted_proxies 是确保 X-Forwarded-For 正确的关键配置

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Caddyfile template syntax valid via remote Caddy
    Tool: Bash (ssh + caddy validate)
    Preconditions: Caddyfile.template 已修改，服务器上已安装 Caddy
    Steps:
      1. 将修改后的 Caddyfile.template 复制到服务器临时路径：scp deploy/Caddyfile.template aliyun-prod-real:/tmp/Caddyfile.test
      2. 在服务器上用 sed 替换模板变量为实际值：ssh aliyun-prod-real "sed -i 's/{$DOMAIN}/fbif2026ticket.foodtalks.cn/g; s/{$API_UPSTREAM}/localhost:3001/g' /tmp/Caddyfile.test"
      3. ssh aliyun-prod-real "caddy validate --config /tmp/Caddyfile.test" → 验证语法正确
      4. ssh aliyun-prod-real "rm /tmp/Caddyfile.test" → 清理临时文件
    Expected Result: caddy validate 返回 "Valid configuration"，退出码 0
    Failure Indicators: caddy validate 报错，退出码非 0
    Evidence: .sisyphus/evidence/task-8-caddy-validate.txt

  Scenario: ACME challenge and trusted proxies configured
    Tool: Bash (grep)
    Preconditions: Caddyfile.template 已修改
    Steps:
      1. grep -c "well-known\|acme" deploy/Caddyfile.template → 应返回 ≥1（有 ACME 相关配置）
      2. grep -c "trusted_proxies\|trusted_proxy" deploy/Caddyfile.template → 应返回 ≥1（有信任代理配置）
      3. grep -c "X-Forwarded-For\|header_up" deploy/Caddyfile.template → 应返回 ≥1（有头转发配置）
    Expected Result: 三项配置均存在
    Failure Indicators: 任一 grep 返回 0
    Evidence: .sisyphus/evidence/task-8-caddy-config-check.txt
  ```

  **Commit**: YES
  - Message: `feat(infra): update Caddyfile for CDN origin mode`
  - Files: `deploy/Caddyfile.template`

- [ ] 9. Write Alibaba Cloud CDN Setup Guide

  **What to do**:
  - 创建 `docs/cdn-setup-guide.md`，包含完整的阿里云 CDN 配置步骤：
    1. **前提条件**：域名已备案、阿里云账号已实名
    2. **开通 CDN**：在阿里云控制台开通 CDN 服务
    3. **添加加速域名**：
       - 加速域名：`fbif2026ticket.foodtalks.cn`
       - 业务类型：全站加速（DCDN）
       - 源站：`121.40.214.5`，端口 443（HTTPS 回源）
    4. **缓存规则配置**：
       - `/assets/*` → 缓存 30 天
       - `/api/*` → 不缓存，直接回源
       - `/health` → 不缓存
       - `/metrics` → 不缓存
       - `/.well-known/*` → 不缓存，直接回源（ACME 证书续期）
       - `/*`（其他） → 不缓存（SPA index.html）
    5. **HTTPS 配置**：上传或申请 SSL 证书
    6. **DNS 切换**：修改域名 CNAME 指向 CDN 分配的域名
    7. **验证清单**：逐项验证 CDN 功能
    8. **回退方案**：如何快速切回直连源站（改 DNS CNAME）
    9. **DNS TTL 注意**：切换前降低 TTL 到 60s，切换后恢复
  - 文档风格：步骤清晰，每步有截图位置说明（用文字描述界面位置）

  **Must NOT do**:
  - 不实际操作 CDN 控制台（只写文档）
  - 不修改代码

  **Recommended Agent Profile**:
  - **Category**: `writing`
    - Reason: 纯文档编写任务
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 7, 8)
  - **Blocks**: Task 10
  - **Blocked By**: Task 6

  **References**:

  **Pattern References**:
  - `docs/deploy-guide.md` — 现有部署文档风格参考
  - `deploy/Caddyfile.template` — 了解当前域名和端口配置
  - `AGENTS.md` 的"部署架构"部分 — 了解完整的架构图

  **External References**:
  - 阿里云 CDN 快速入门: https://help.aliyun.com/document_detail/27112.html
  - 阿里云 DCDN 全站加速: https://help.aliyun.com/document_detail/64836.html

  **WHY Each Reference Matters**:
  - 现有文档风格确保一致性
  - Caddyfile 和 AGENTS.md 提供准确的架构信息

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Guide completeness check
    Tool: Bash (grep)
    Preconditions: docs/cdn-setup-guide.md 已创建
    Steps:
      1. 验证文档包含所有必要章节：前提条件、开通、域名配置、缓存规则、HTTPS、DNS、验证、回退
      2. grep "CNAME" docs/cdn-setup-guide.md → 应包含 DNS CNAME 切换说明
      3. grep "cache\|缓存" docs/cdn-setup-guide.md → 应包含缓存规则
      4. grep "回源\|origin" docs/cdn-setup-guide.md → 应包含回源配置
      5. grep "回退\|rollback" docs/cdn-setup-guide.md → 应包含回退方案
    Expected Result: 所有关键章节和关键词存在
    Failure Indicators: 缺少关键章节
    Evidence: .sisyphus/evidence/task-9-guide-check.txt
  ```

  **Commit**: YES
  - Message: `docs: add Alibaba Cloud CDN setup guide`
  - Files: `docs/cdn-setup-guide.md`

- [ ] 10. Deploy Route B — PR, Merge + Production Caddy/CDN Setup (Requires User Approval)

  **What to do**:
  - 创建功能分支 `feat/performance-route-b`
  - 将 Task 7, 8, 9 的修改提交到分支
  - 创建 PR 合并到 main，标题：`feat: CDN support - trust proxy, Caddyfile, setup guide`
  - PR 描述包含：变更摘要、CDN 配置引导（指向 docs/cdn-setup-guide.md）
  - 合并后等待自动 preview 部署
  - 验证 preview 环境 trust proxy 和 Caddy 配置正常
  - 提示用户：接下来有两个需要用户批准/手动执行的生产变更：
    1. **应用 Caddyfile 到生产服务器**（需用户批准，因为是生产变更）：
       - 命令序列（用户批准后 Agent 执行）：
         ```
         scp deploy/Caddyfile.template aliyun-prod-real:/tmp/Caddyfile.new
         ssh aliyun-prod-real "cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak.$(date +%Y%m%d)"
         # 替换模板变量并验证
         ssh aliyun-prod-real "caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy"
         ```
       - 验证：`curl -sf https://fbif2026ticket.foodtalks.cn/health`
    2. **在阿里云控制台配置 CDN**（按照 docs/cdn-setup-guide.md）
  - 注意：这两步都是生产变更，需在用户明确批准后执行

  **Must NOT do**:
  - 不在未经用户明确批准的情况下执行生产变更（Caddyfile 应用、CDN 配置）
  - 不代替用户操作阿里云控制台

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Git 操作 + SSH 验证
  - **Skills**: [`git-master`]

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4 (sequential)
  - **Blocks**: Task 11
  - **Blocked By**: Tasks 7, 8, 9

  **References**:

  **Pattern References**:
  - `.github/workflows/deploy-preview.yml` — 了解 push to main 触发的部署流程

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Route B PR merged and preview deployed
    Tool: Bash (gh + ssh)
    Preconditions: PR 已创建
    Steps:
      1. gh pr create + gh pr merge
      2. 等待 preview 部署（检查 GitHub Actions 或等待 2 分钟）
      3. curl -sf http://121.40.214.5:3003/health → 确认服务正常
      4. ssh aliyun-prod-real "docker exec fbif-form-staging-api-1 node -e \"const app = require('express')(); console.log('ok')\"" → 确认容器正常（简化验证）
    Expected Result: PR 合并成功，preview 正常运行
    Evidence: .sisyphus/evidence/task-10-route-b-deploy.txt
  ```

  **Commit**: YES (PR via `gh pr create`)

- [ ] 11. Verify CDN End-to-End Functionality (External Prerequisite: 用户已完成 CDN 控制台配置)

  **What to do**:
  - **前提条件**：用户已按 `docs/cdn-setup-guide.md` 完成阿里云 CDN 控制台配置（加速域名、缓存规则、HTTPS、DNS CNAME）
  - 这个任务在用户确认 CDN 配置完成后执行
  - 执行全面的 CDN 功能验证：
    1. **静态资源缓存**：`curl -I https://fbif2026ticket.foodtalks.cn/assets/<hash>.js` → 检查 CDN 缓存头（`X-Cache: HIT`，`Via` 头包含 CDN 信息）
    2. **HTML 不缓存**：`curl -I https://fbif2026ticket.foodtalks.cn/` → 检查 `Cache-Control: no-store`
    3. **API 回源**：`curl -v https://fbif2026ticket.foodtalks.cn/api/csrf` → 验证返回 CSRF token + Set-Cookie 完整
    4. **CSRF 完整流程**：
       - `curl -c cookies.txt https://fbif2026ticket.foodtalks.cn/api/csrf` → 获取 token + cookie
       - `curl -b cookies.txt -H "X-CSRF-Token: <token>" -X POST https://fbif2026ticket.foodtalks.cn/api/submissions -d '...'` → 验证 CSRF 验证通过
    5. **HTTPS 证书**：`curl -vI https://fbif2026ticket.foodtalks.cn 2>&1 | grep "SSL certificate\|issuer"` → 验证证书有效
    6. **Health check**：`curl -sf https://fbif2026ticket.foodtalks.cn/health` → 验证健康检查正常
    7. **Rate limit IP 正确性**：发送请求后检查 API 日志，确认记录的是客户端 IP 而非 CDN IP

  **Must NOT do**:
  - 不操作 CDN 控制台
  - 不修改任何代码

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 多步骤验证，需要分析 HTTP 头和日志
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4 (after Task 10 + user CDN setup)
  - **Blocks**: Task 12
  - **Blocked By**: Task 10 + user manual CDN config

  **References**:

  **Pattern References**:
  - `docs/cdn-setup-guide.md` — CDN 配置指南中的验证清单
  - `apps/api/src/routes/csrf.ts` — CSRF token 生成逻辑，了解 cookie 设置

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: CDN caches static assets
    Tool: Bash (curl + ssh)
    Preconditions: CDN 已配置并生效
    Steps:
      1. 动态发现当前 JS asset 文件名：ssh aliyun-prod-real "ls /var/www/fbif-form/assets/index-*.js" → 得到实际哈希文件名（如 index-AbC123.js）
      2. curl -I https://fbif2026ticket.foodtalks.cn/assets/<discovered-filename> → 第一次可能 MISS
      3. curl -I https://fbif2026ticket.foodtalks.cn/assets/<discovered-filename> → 第二次应 HIT
    Expected Result: 第二次请求 X-Cache 头显示 HIT（或 Via 头包含 CDN 信息）
    Failure Indicators: 始终 MISS，没有 CDN 相关头
    Evidence: .sisyphus/evidence/task-11-cdn-cache.txt

  Scenario: API works through CDN
    Tool: Bash (curl)
    Preconditions: CDN 已配置
    Steps:
      1. curl -v https://fbif2026ticket.foodtalks.cn/api/csrf 2>&1 → 检查 200 + csrfToken + Set-Cookie
      2. 保存 cookie，用获取的 token 发起 POST 请求
    Expected Result: CSRF token 获取成功，cookie 完整传递
    Failure Indicators: 502 错误，cookie 丢失，CSRF 验证失败
    Evidence: .sisyphus/evidence/task-11-cdn-api.txt

  Scenario: HTTPS certificate valid
    Tool: Bash (curl)
    Preconditions: CDN HTTPS 已配置
    Steps:
      1. curl -vI https://fbif2026ticket.foodtalks.cn 2>&1 | grep -E "SSL certificate|issuer|subject"
    Expected Result: 证书有效，域名匹配 fbif2026ticket.foodtalks.cn
    Failure Indicators: 证书错误，域名不匹配
    Evidence: .sisyphus/evidence/task-11-https-cert.txt
  ```

  **Commit**: NO (验证任务，不修改代码)

- [ ] 12. Final K6 Load Test + Update AGENTS.md

  **What to do**:
  - 运行最终的 K6 压测（Route A + Route B 全部就位后）：
    - 阶梯测试：`k6 run --env MAX_RATE=300 tests/k6/submit-step-ramp.js` → 目标 200 RPS < 2% 失败率
    - 持续测试：`k6 run --env SOAK_RPS=100 --env SOAK_MINUTES=5 tests/k6/submit-soak.js` → 目标 < 1% 失败率，P95 < 1500ms
  - 记录结果，与 Task 1 baseline 和 Task 6 Route A 结果三方对比
  - 更新 `AGENTS.md` 的部署架构部分，反映 CDN 架构变更：
    - 添加 CDN 层到架构图
    - 更新"前端部署"部分说明 CDN
    - 添加 CDN 相关环境变量说明
  - 生成最终性能优化报告，保存到证据文件

  **Must NOT do**:
  - 不修改业务代码
  - 不修改 K6 脚本逻辑

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 压测分析 + 文档更新
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4 (after Task 11)
  - **Blocks**: F1-F4
  - **Blocked By**: Task 11

  **References**:

  **Pattern References**:
  - `AGENTS.md` — 需要更新的项目文档，特别是"部署架构"和"前端部署"部分
  - `docs/extreme-performance-report-2026-02-11.md` — 历史报告格式，用于对比

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: K6 step ramp meets target
    Tool: Bash (k6)
    Preconditions: Route A + B 全部就位
    Steps:
      1. 运行 K6 阶梯压测
      2. 记录 200 RPS 时的失败率
    Expected Result: 200 RPS 时失败率 < 2%
    Failure Indicators: 失败率 > 2%
    Evidence: .sisyphus/evidence/task-12-k6-final-ramp.txt

  Scenario: K6 soak test meets target
    Tool: Bash (k6)
    Preconditions: Route A + B 全部就位
    Steps:
      1. 运行 K6 持续压测（100 RPS × 5 分钟）
      2. 记录失败率和 P95 延迟
    Expected Result: 失败率 < 1%，P95 < 1500ms
    Failure Indicators: 失败率 > 1% 或 P95 > 1500ms
    Evidence: .sisyphus/evidence/task-12-k6-final-soak.txt

  Scenario: AGENTS.md updated with CDN architecture
    Tool: Bash (grep)
    Steps:
      1. grep "CDN" AGENTS.md → 应包含 CDN 架构说明
      2. grep "trust proxy\|trusted_proxies" AGENTS.md → 应反映代理链变更
    Expected Result: 架构文档反映 CDN 层
    Evidence: .sisyphus/evidence/task-12-agents-md-update.txt
  ```

  **Commit**: YES
  - Message: `docs: update AGENTS.md with CDN architecture and performance results`
  - Files: `AGENTS.md`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Rejection → fix → re-run.

- [ ] F1. **Plan Compliance Audit** — `oracle`

  Read the plan end-to-end. For each "Must Have": verify implementation exists. For each "Must NOT Have": search codebase for forbidden changes.

  ```
  Scenario: Must Have verification
    Tool: Bash (ssh + docker + curl)
    Steps:
      1. ssh aliyun-prod-real "docker exec <active-api-container> pm2 list" → 验证 3 API + 1 Worker
      2. ssh aliyun-prod-real "docker inspect --format='{{.HostConfig.NanoCpus}} {{.HostConfig.Memory}}' <active-api-container>" → 验证 3000000000 (3核) 2147483648 (2GB)
      3. curl -sf https://fbif2026ticket.foodtalks.cn/health → 验证健康检查
      4. 动态发现 JS asset：ssh aliyun-prod-real "ls /var/www/fbif-form/assets/index-*.js" → 用实际文件名 curl -I 验证 CDN 缓存头
      5. ls .sisyphus/evidence/task-*.txt → 验证每个任务的证据文件存在
    Expected Result: 所有 Must Have 条目均有对应实现，证据文件齐全
    Evidence: .sisyphus/evidence/final-qa/f1-compliance-audit.txt

  Scenario: Must NOT Have verification
    Tool: Bash (git diff + grep)
    Steps:
      1. git diff origin/main...HEAD -- apps/web/src/App.tsx → 应为空（未改动）
      2. git diff origin/main...HEAD -- scripts/remote-deploy.sh → 应只包含 --cpus 和 --memory 两行添加，无其他部署逻辑变更
      3. git diff origin/main...HEAD -- apps/api/src/routes/csrf.ts → 应为空（CSRF 设置未改）
      4. grep -r "sameSite" apps/api/src/routes/csrf.ts → 应仍为 'strict'
      5. git diff origin/main...HEAD -- apps/api/src/worker.ts → 应为空（Worker 逻辑未改）
    Expected Result: App.tsx/csrf.ts/worker.ts 无变更，remote-deploy.sh 仅有资源限制参数添加
    Evidence: .sisyphus/evidence/final-qa/f1-must-not-have.txt
  ```
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`

  Run build and lint checks. Review all changed files for quality issues.

  ```
  Scenario: Build and lint verification
    Tool: Bash (tsc + docker compose)
    Steps:
      1. cd apps/api && npx tsc --noEmit → TypeScript 编译无错误
      2. docker compose -f docker-compose.production.yml config --quiet → Docker 配置语法有效
      3. cd apps/api && node -e "require('./ecosystem.config.cjs')" → PM2 配置可加载
    Expected Result: 所有命令返回 0 退出码，无错误输出
    Evidence: .sisyphus/evidence/final-qa/f2-build-check.txt

  Scenario: Code quality scan
    Tool: Bash (grep)
    Steps:
      1. grep -rn "as any\|@ts-ignore" apps/api/src/server.ts → 应无结果
      2. grep -rn "console\.log" apps/api/ecosystem.config.cjs → 应无 debug log
      3. grep -rn "TODO\|FIXME\|HACK" apps/api/ecosystem.config.cjs apps/api/docker/entrypoint-pm2.sh → 应无遗留标记
    Expected Result: 无代码质量问题
    Evidence: .sisyphus/evidence/final-qa/f2-quality-scan.txt
  ```
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Docker Config [VALID/INVALID] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high`

  Start from clean state. Verify the full system works end-to-end.

  ```
  Scenario: PM2 cluster and resources
    Tool: Bash (ssh)
    Steps:
      1. ssh aliyun-prod-real "docker exec <active-api-container> pm2 list" → 4 进程全部 online
      2. ssh aliyun-prod-real "docker stats <active-api-container> --no-stream" → CPU < 10%, Mem < 500MB（空载）
      3. ssh aliyun-prod-real "docker exec <active-api-container> pm2 show 0" → 确认 cluster 模式
    Expected Result: PM2 运行正常，资源在空载范围内
    Evidence: .sisyphus/evidence/final-qa/f3-pm2-status.txt

  Scenario: Full registration flow through CDN
    Tool: Bash (curl)
    Steps:
      1. curl -c cookies.txt -sf https://fbif2026ticket.foodtalks.cn/api/csrf → 获取 CSRF token
      2. 从响应中提取 csrfToken 值
      3. curl -b cookies.txt -H "X-CSRF-Token: <token>" -H "Content-Type: application/json" -X POST https://fbif2026ticket.foodtalks.cn/api/submissions -d '{"role":"consumer","name":"QA测试用户","phone":"13800138000","idType":"cn_id","idNumber":"110101199001011234","title":"测试职位","company":"QA测试公司","clientRequestId":"test-final-qa-'$(date +%s)'"}' → 应返回 202（包含 submissionSchema 所有必填字段：role, name, phone, idType, idNumber, title, company）
    Expected Result: 提交成功（HTTP 202），CSRF 验证通过
    Evidence: .sisyphus/evidence/final-qa/f3-registration-flow.txt

  Scenario: CDN caching behavior
    Tool: Bash (curl -I)
    Steps:
      1. curl -I https://fbif2026ticket.foodtalks.cn/ → Cache-Control 应含 no-store
      2. 动态发现 JS asset：ssh aliyun-prod-real "ls /var/www/fbif-form/assets/index-*.js" → 用实际文件名 curl -I → 应有 CDN 缓存命中头
      3. curl -I https://fbif2026ticket.foodtalks.cn/api/csrf → 不应有缓存头（动态请求）
    Expected Result: 静态资源有缓存命中，HTML 和 API 无缓存
    Evidence: .sisyphus/evidence/final-qa/f3-cdn-caching.txt
  ```
  Output: `PM2 [OK/FAIL] | Resources [OK/FAIL] | Registration Flow [OK/FAIL] | CDN [OK/FAIL] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`

  Verify 1:1 correspondence between plan and implementation. No scope creep.

  ```
  Scenario: Diff analysis for scope compliance
    Tool: Bash (git)
    Steps:
      1. git log --oneline origin/main...HEAD → 列出所有新提交
      2. git diff --stat origin/main...HEAD → 列出所有变更文件
      3. 对照计划 Deliverables 列表，逐一确认：
         - ecosystem.config.cjs ✓/✗
         - Dockerfile ✓/✗
         - entrypoint-pm2.sh ✓/✗
         - docker-compose.production.yml ✓/✗
         - server.ts (trust proxy) ✓/✗
         - Caddyfile.template ✓/✗
         - docs/cdn-setup-guide.md ✓/✗
         - AGENTS.md ✓/✗
      4. 检查是否有计划外的文件变更
    Expected Result: 所有计划内文件已变更，无计划外变更
    Evidence: .sisyphus/evidence/final-qa/f4-scope-diff.txt

  Scenario: Must NOT Do compliance
    Tool: Bash (git diff)
    Steps:
      1. git diff origin/main...HEAD -- apps/web/ → 应为空（前端未动）
      2. git diff origin/main...HEAD -- scripts/remote-deploy.sh | wc -l → 应 < 10 行（仅 --cpus 和 --memory 添加）
      3. git diff origin/main...HEAD -- apps/api/src/worker.ts → 应为空（Worker 逻辑未改）
      4. git diff origin/main...HEAD -- apps/api/src/queue/ → 应为空（背压逻辑未改）
    Expected Result: 前端和 Worker/Queue 逻辑无变更，remote-deploy.sh 仅有最小资源限制改动
    Evidence: .sisyphus/evidence/final-qa/f4-must-not-do.txt
  ```
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

**Phase 1 — Route A (1 PR):**
- `feat(api): add PM2 cluster mode with ecosystem config` — ecosystem.config.cjs, Dockerfile, entrypoint-pm2.sh
- `feat(infra): increase Docker resource limits and performance tuning` — scripts/remote-deploy.sh, docker-compose.production.yml, scripts/update-backend-env.sh

**Phase 2 — Route B (1 PR):**
- `feat(api): update trust proxy for CDN proxy chain` — server.ts
- `feat(infra): update Caddyfile for CDN origin mode` — Caddyfile.template
- `docs: add Alibaba Cloud CDN setup guide` — docs/cdn-setup-guide.md

---

## Success Criteria

### Verification Commands
```bash
# PM2 cluster running
ssh aliyun-prod-real "docker exec fbif-form-api-blue pm2 list"
# Expected: 3 API instances (online) + 1 Worker instance (online)

# Resource limits applied
ssh aliyun-prod-real "docker inspect --format='{{.HostConfig.NanoCpus}} {{.HostConfig.Memory}}' fbif-form-api-blue"
# Expected: 3000000000 (3 cores) 2147483648 (2GB)

# CDN cache hit
# 动态发现 asset 文件名后测试
ASSET=$(ssh aliyun-prod-real "ls /var/www/fbif-form/assets/index-*.js | head -1 | xargs basename")
curl -I "https://fbif2026ticket.foodtalks.cn/assets/$ASSET"
# Expected: X-Cache: HIT (or similar CDN cache header)

# API through CDN
curl -v https://fbif2026ticket.foodtalks.cn/api/csrf
# Expected: 200 OK with csrfToken + Set-Cookie header intact

# Health check
curl -sf https://fbif2026ticket.foodtalks.cn/health
# Expected: {"ok":true}

# K6 load test (Route A target)
k6 run --env MAX_RATE=300 tests/k6/submit-step-ramp.js
# Expected: <2% failure rate at 200 RPS

# K6 soak test
k6 run --env SOAK_RPS=100 --env SOAK_MINUTES=5 tests/k6/submit-soak.js
# Expected: <1% failure rate, P95 < 1500ms
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] PM2 cluster mode: 3 API + 1 Worker
- [ ] Docker limits: 3 cores / 2GB
- [ ] Rate limits: 5x increase applied
- [ ] CDN: static assets cached, API pass-through working
- [ ] CSRF: full round-trip through CDN verified
- [ ] K6: 200 RPS < 2% failure
- [ ] Rollback: 旧 entrypoint.sh 保留未动（Dockerfile 改回 ENTRYPOINT ["/entrypoint.sh"] 即可回滚）
