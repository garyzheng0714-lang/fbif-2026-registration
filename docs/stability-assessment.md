# 稳定性评估（2026-02-11）

## 评估口径
- `受理成功`：`POST /api/submissions` 返回 `202`，且数据已落库并入队。
- `最终一致`：Worker 异步写入飞书可延迟，不计入前台受理 SLA。

## 当前结论（2GB 单机）
- 在 `60 req/s`、10 分钟持续负载下，受理链路稳定（`http_req_failed=0%`，`submit 202` 全通过）。
- 在突发/高并发 (`~100+ req/s`) 时，系统进入“部分可用”状态：
  - 主要失败点在 `/api/csrf` 获取阶段超时；
  - 已拿到 token 的提交通常仍可返回 `202`。
- 已上线 CSRF 优化（CSRF 独立限流 + 前端 token 去重/自动刷新重试）后，`spike 180` 场景总失败率从 `35.69%` 下降到 `24.01%`（同为 `HTTP_TIMEOUT=5s` 口径）。
- 开启 Worker 的端到端回归（`2 rps, 1m`）结果：
  - `submit 202`: `121/121`
  - 异步同步状态：`SUCCESS=121`, `FAILED=0`
  - 同步耗时：平均 `1233ms`，p95 `1834ms`
- 综合评估：
  - 可达到“中等并发稳定受理”；
  - 尚未达到“高突发场景下 99.9% 稳定受理”的目标。

## 风险项
1. 单点风险：API 单实例，进程故障即服务抖动。
2. 资源风险：存在历史 OOM（2026-02-10）记录，2GB 冗余不足。
3. 入口风险：CSRF 端点在高会话 churn 下成为首个瓶颈。

## 达成 99.9% 的最小改造
1. API 至少双实例 + 负载均衡。
2. 预取并缓存 CSRF，减少高峰期 token 新建压力。
3. 持续监控并告警：`/api/csrf` p95、`submit 202` 成功率、可用内存、队列堆积。
4. Worker 与 API 分离部署，防止资源竞争放大抖动。

## 本轮数据来源
- 报告：`/Users/simba/local_vibecoding/web-fbif-form/docs/extreme-performance-report-2026-02-11.md`
- 原始压测产物：`/Users/simba/local_vibecoding/web-fbif-form/docs/perf/2026-02-11/20260211-104354/20260211-104354`
- 跟进压测产物：`/Users/simba/local_vibecoding/web-fbif-form/docs/perf/2026-02-11/csrf-worker-followup/20260211-122631`
- 跟进压测产物：`/Users/simba/local_vibecoding/web-fbif-form/docs/perf/2026-02-11/csrf-worker-followup/20260211-123731`
