# 极限压测报告（2026-02-11）

## 1. 执行摘要
- 测试时间：2026-02-11（CST）
- 目标系统：`apps/api`（`/api/csrf` + `/api/submissions`），Worker 在压测期间停用以隔离“受理链路”能力。
- 服务器：阿里云 ECS（2 vCPU / 2GB RAM，Docker 自建 PostgreSQL + Redis，PM2 单实例 API）。
- 结论（当前 2GB 单机）：
  - 稳态可用区间：`60 req/s`（10 分钟）`0%` HTTP 失败，`p95=97ms`。
  - 软上限区间：当请求速率进入 `~100-127 req/s`，系统未崩溃，但出现明显超时与丢迭代，主要失效点在 `/api/csrf`。
  - 有效受理上限（`submit 202`）：约 `75-80 submissions/s`（约 `4500-4800/min`）。

## 2. 测试环境与前置状态
- API 地址：`http://112.124.103.65:8080`
- API 进程：`fbif-api`
- DB/Redis：本机 Docker，`127.0.0.1:5432`、`127.0.0.1:6379`
- 采样文件：`/Users/simba/local_vibecoding/web-fbif-form/docs/perf/2026-02-11/20260211-104354/20260211-104354/sampler.log`
- 关键历史事件：
  - `2026-02-10 06:36:02` 出现 OOM，`node` 进程被内核杀死（`dmesg` 记录）。

## 3. 测试矩阵与执行结果

### 3.1 渐增并发（直到明显失稳）
- 场景：`tests/k6/submit-step-ramp.js`
- 结果文件：`/Users/simba/local_vibecoding/web-fbif-form/docs/perf/2026-02-11/20260211-104354/20260211-104354/step-ramp-2.out`
- 配置：逐级升到 `200 iters/s`（每级 20s）
- 结果：
  - `http_req_failed=22.79%`
  - `http_req_duration p95=1.99s`
  - `http_reqs=98.31/s`
  - `iterations=97.63/s`
  - `csrf 200`: `145` 成功 / `3790` 失败
  - `submit 202`: `15914` 成功 / `952` 失败
- 结论：进入 `~100 req/s` 后明显失稳，主要由 CSRF 获取阶段超时触发。

### 3.2 峰值冲击
- 场景：`tests/k6/submit-spike.js`
- 结果文件：`/Users/simba/local_vibecoding/web-fbif-form/docs/perf/2026-02-11/20260211-104354/20260211-104354/spike-180.out`
- 配置：快速拉升并维持 `180 req/s`
- 结果：
  - `http_req_failed=35.69%`
  - `http_req_duration p95=4.99s`
  - `http_reqs=126.99/s`
  - `iterations=122.24/s`
  - `csrf 200`: `427` 成功 / `4080` 失败
  - `submit 202`: `6922` 成功 / `0` 失败
- 结论：突发流量下系统未崩溃，但 CSRF 入口成为首个瓶颈；受理成功率转为“有 token 的请求几乎都能 202”。

### 3.3 长时持续负载（Soak）
- 场景：`tests/k6/submit-soak.js`
- 结果文件：`/Users/simba/local_vibecoding/web-fbif-form/docs/perf/2026-02-11/20260211-104354/20260211-104354/soak-60rps-10m.out`
- 配置：`60 req/s` 持续 `10 分钟`
- 结果：
  - `http_req_failed=0.00%`
  - `http_req_duration p95=97.28ms`
  - `http_reqs=60.27/s`
  - `iterations=60.00/s`
  - `csrf 200`: `160` 成功 / `0` 失败
  - `submit 202`: `36000` 成功 / `0` 失败
- 结论：在 60 rps 稳态下，受理链路稳定。

### 3.4 资源耗尽场景（CPU / 内存 / 磁盘 I/O）
- 场景结果：
  - `resource-baseline-40rps-2m-summary.json`
  - `resource-cpu-40rps-2m-summary.json`
  - `resource-mem-40rps-2m-summary.json`
  - `resource-io-40rps-2m-summary.json`
- 统一配置：`40 req/s`，`2 分钟`
- 指标对比：
  - 基线：`p95=26.42ms`, `fail=0%`
  - CPU 压力：`p95=110.26ms`, `fail=0%`
  - 内存压力：`p95=20.89ms`, `fail=0%`
  - I/O 压力：`p95=44.01ms`, `fail=0%`
- 结论：40 rps 下资源扰动可承受，CPU 压力对延迟影响最大。

### 3.5 数据库连接池耗尽验证
- 场景：`dbpool-120rps-2m.out`（将 API 池限制到 `connection_limit=5`, `pool_timeout=5s`）
- 结果文件：`/Users/simba/local_vibecoding/web-fbif-form/docs/perf/2026-02-11/20260211-104354/20260211-104354/dbpool-120rps-2m.out`
- 结果：
  - `http_req_failed=34.98%`
  - `http_req_duration p95=5.00s`
  - `http_reqs=116.24/s`
  - `iterations=114.80/s`
  - `csrf 200`: `178` 成功 / `5013` 失败
  - `submit 202`: `9139` 成功 / `0` 失败
- 结论：连接池被压缩后，请求前置阶段更容易超时；但已拿到 token 的提交通路仍较稳。

## 4. 资源采样要点（sampler.log）
- `load1` 峰值：`7.39`
- API CPU 峰值：`100%`
- API RSS 峰值：`153 MB`
- 主机 `mem_used` 峰值：`1172 MB`
- 主机 `mem_avail` 最低：`440 MB`
- PostgreSQL 连接峰值：`17`
- Redis used_memory 峰值：`31.2 MB`

## 5. 最大承载能力与失效模式

### 5.1 当前 2GB 单机最大承载（本轮结论）
- 稳定承载：`60 req/s` 持续负载（10 分钟）无错误。
- 软上限：`~100 req/s` 开始出现明显失败（主要为 CSRF 阶段超时）。
- 峰值场景有效受理能力：`~75-80 submissions/s`（`submit 202` 维度）。

### 5.2 主要失效模式
1. `/api/csrf` 在高会话 churn 时超时，导致整体请求失败率被拉高。
2. 单机单进程模型对突发峰值不具备冗余，CPU 撑满后尾延迟恶化。
3. 2GB 内存历史上已出现 OOM 杀进程事件（2026-02-10），存在风险窗口。

## 6. 优化建议（按优先级）
1. 将 API 扩为至少 2 实例（同机 PM2 cluster 或双机）并在入口做负载均衡，先解决单点与突发吸收能力。
2. 优化 CSRF 获取链路：
   - 页面初始化时预取并缓存 token；
   - 减少重复获取频率；
   - 保持 `noCookiesReset` 等一致会话策略。
3. 维持“提交先 202、后端异步写飞书”模式，Worker 与 API 分离部署，避免互相抢资源。
4. 监控告警最小集：`/api/csrf` p95、`submit 202` 成功率、队列堆积、ECS 可用内存。
5. 如果要承接“1 分钟内 1000 人提交”的确定性 SLA，建议尽快升级到 4GB 并做双实例。

## 7. 回切与当前线上状态
- 已补充 CSRF 链路优化并发布：
  - 后端新增独立 CSRF 限流配置：`CSRF_RATE_LIMIT_MAX` / `CSRF_RATE_LIMIT_WINDOW_MS`，并将 `/api/csrf` 从通用 `/api` 限流链路中拆出。
  - 前端新增 CSRF token 并发去重、403 自动刷新后重试一次（提交与 OSS policy 场景）。
- 优化后对比压测（临时放开限流参数后测试）：
  - 场景：`spike 180`，`HTTP_TIMEOUT=5s`
  - 产物：`/Users/simba/local_vibecoding/web-fbif-form/docs/perf/2026-02-11/csrf-worker-followup/20260211-122631`
  - 结果：`http_req_failed=24.01%`，`submit 202=8492/8493`，较优化前 `35.69%` 总失败率有下降。
- Worker 端到端验证（开启 Worker）：
  - 场景：`soak 2 rps 1m`
  - 产物：`/Users/simba/local_vibecoding/web-fbif-form/docs/perf/2026-02-11/csrf-worker-followup/20260211-123731`
  - 结果：`submit 202=121/121`，DB `SUCCESS=121`，平均同步耗时 `1233ms`，p95 同步耗时 `1834ms`，队列 `wait=0/active=0/failed=0`。
- 已清理压测遗留垃圾数据（`clientRequestId like 'k6-%'`）及对应 BullMQ 队列键，避免继续污染飞书表与拖慢 Worker。
- 当前线上参数（已恢复）：
  - API：`DB_POOL_CONNECTION_LIMIT=30`、`DB_POOL_TIMEOUT_S=30`、`RATE_LIMIT_MAX=120`、`RATE_LIMIT_BURST=20`、`CSRF_RATE_LIMIT_MAX=2400`
  - Worker：`FEISHU_WORKER_CONCURRENCY=10`、`FEISHU_WORKER_QPS=10`
  - 已验证：`POST /api/submissions` 返回 `202` 正常。

## 8. 原始产物
- 全量压测产物目录：
  - `/Users/simba/local_vibecoding/web-fbif-form/docs/perf/2026-02-11/20260211-104354/20260211-104354`
  - `/Users/simba/local_vibecoding/web-fbif-form/docs/perf/2026-02-11/csrf-worker-followup/20260211-122631`
  - `/Users/simba/local_vibecoding/web-fbif-form/docs/perf/2026-02-11/csrf-worker-followup/20260211-123731`
