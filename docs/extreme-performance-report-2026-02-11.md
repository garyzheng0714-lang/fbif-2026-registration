# 极限压测报告（2026-02-11）

> 说明：本次压测直接对生产 ECS（`112.124.103.65`）执行，目的是测出“稳定性边界/失效模式”。测试过程中为避免污染飞书数据，已在压测前停止 `fbif-worker`（Feishu 同步进程）。
>
> 重要：压测为触底测试，确实可能导致短时不可用。本报告记录了已发生的失效，并给出恢复与后续更安全的压测方式。

## 1. 被测环境

- ECS：2 vCPU / 2 GB（可用内存约 1.6 GB），Swap 2 GB
- 进程：
  - `fbif-web`：PM2 静态服务 `:3001`
  - `fbif-api`：PM2 Node 服务 `:8080`
  - `fbif-worker`：PM2 Worker（压测时停止）
- 依赖（Docker）：
  - Postgres 16（`127.0.0.1:5432`）
  - Redis 7（`127.0.0.1:6379`）
- 关键接口：
  - `GET /api/csrf`
  - `POST /api/submissions`（202 accepted）
  - `POST /api/oss/policy`
  - `GET /metrics`

## 2. 压测目标与口径

### 2.1 目标

- 找到系统在高并发下的极限吞吐、延迟拐点、错误率拐点
- 定位瓶颈类型（CPU / 内存 / DB / 连接数 / 限流）
- 明确“失效模式”（超时、拒绝服务、OOM、进程崩溃、整机卡死）

### 2.2 口径（本次执行）

- **提交链路**（每个 iteration）：
  1. `GET /api/csrf`
  2. `POST /api/submissions`（consumer）
- 负载生成器：k6（Docker：`grafana/k6`，使用 `--network host` 直连本机 `127.0.0.1:8080`）
- 并发模型：`ramping-arrival-rate`（逐级提高 iterations/s）

> 注意：提交 iteration 包含 2 次 HTTP 请求，因此 “100 iterations/s” 约等于 “200 req/s”（不含内部 DB/Redis/Feishu 调用）。

## 3. 执行过的测试

### 3.1 渐进加压（Ramping Arrival Rate）

- 脚本：`tests/k6/submit-ramp-arrival.js`
- 目标：从 10 iters/s 逐步爬升到 300 iters/s（每档 30-60 秒）
- 为了观测真实边界，压测前临时提高了 API 限流阈值（`RATE_LIMIT_MAX/BURST`）以避免被 429 提前截断。

#### 观察到的现象（关键）

1. 在中等负载区间（约 50-120 iters/s）：
   - API 与 DB/Redis CPU 持续上升，但仍能维持 `202` 返回。
2. 进入高负载区间后：
   - API 端出现请求超时（k6 报 `dial: i/o timeout`）。
   - `curl http://127.0.0.1:8080/health` 开始超时，说明 **对内健康检查已不可用**。
   - 整机可用内存显著下降（可用内存降到 ~150MB 量级），疑似出现大量 in-flight 请求/连接堆积与 GC 压力。
3. 最终失效模式：
   - **API 端口与 Web 端口均对外不可用（请求超时，无返回）**。
   - **SSH 端口 TCP 可建立，但 sshd 无法及时发送 banner（`Connection timed out during banner exchange`）**，表现为整机极度卡顿/不可交互。

结论：在 2GB 内存、2 vCPU 单机单实例部署下，系统存在“触底式”失效模式：一旦超过某个吞吐门槛，会从“高延迟”迅速坠入“全站不可用 + 无法 SSH 排障”。

### 3.2 其他测试（计划但被阻塞）

由于 3.1 触发整机不可用，以下测试需在服务器恢复后继续执行：

- 峰值冲击（Spike）：`tests/k6/submit-spike.js`
- 长时间持续（Soak）：`tests/k6/submit-soak.js`
- OSS policy 签名吞吐：`tests/k6/oss-policy-ramp.js`
- 真实附件大小并发（60 行业/40 消费者，行业 3 附件，20-50MB）：`tests/load/mixed_oss_100.sh`

## 4. 当前瓶颈判断（基于已观测事实）

### 4.1 瓶颈类型

- **内存/连接堆积优先**：可用内存被快速吃光，随后出现健康检查超时、对外请求超时、sshd banner 无响应。
- CPU 并非唯一瓶颈：从观测点看，CPU 上升但并未达到“纯 CPU 100% 卡死”的典型特征（更像“内存 + IO + 连接排队”复合问题）。

### 4.2 触发原因（最可能）

- 入口限流被临时放开后，短时间大量请求导致：
  - Express/Node in-flight 请求增长，导致 RSS 增长与 GC 压力
  - Postgres/Redis 访问放大（每次提交写 DB + enqueue），导致排队
  - `/api/csrf` 本身也被放大（每 iteration 需要一次）
- 在 2GB 内存下，一旦进入排队，系统可能陷入“雪崩”：
  - 响应慢 -> 客户端重试/连接占用更久 -> in-flight 更多 -> 更慢

## 5. 恢复步骤（必须先恢复才能继续压测）

> 当前表现为：`3001/8080` 均超时，且无法 SSH 交互登录（banner exchange 超时）。这通常需要在阿里云控制台执行 **ECS 重启**。

1. 阿里云控制台对 ECS 执行重启（软重启不行就强制重启）。
2. 重启后检查：
   - `http://112.124.103.65:3001/` 能打开
   - `http://112.124.103.65:8080/health` 返回 `{"ok":true}`
   - `pm2 ls` 进程在线
3. 立刻恢复限流到生产安全值（避免真实流量被打挂）：
   - `RATE_LIMIT_WINDOW_MS=60000 RATE_LIMIT_MAX=120 RATE_LIMIT_BURST=20 pm2 restart fbif-api --update-env`
4. 需要飞书同步时再启动 worker：
   - `pm2 restart fbif-worker`

## 6. 后续压测建议（更安全、更接近真实）

### 6.1 把 CSRF 调用从压测迭代里移除（或降低频率）

真实浏览器不会每次提交都先打一次 `/api/csrf`（前端有缓存），建议压测也模拟缓存：

- 每个 VU 在 setup 阶段获取一次 CSRF，然后复用 1-3 分钟
- 这样更贴近真实，并能显著降低额外请求量

### 6.2 用“提交到 OSS + 再提交表单”的两段压测

展会高峰主要是：

- 静态资源：CDN/OSS 承担
- 大文件：用户直传 OSS（不占 API 带宽）
- API：只做 `policy` + `submission` 入库入队

因此需要拆成两类容量测试：

1. API 吞吐（不传大文件）：测 DB/Redis/受理延迟
2. OSS 上传（大文件）：测签名接口 + OSS 上传稳定性（重点关注超时与重试）

### 6.3 保留入口限流作为“抗雪崩护栏”

生产必须保留合理限流。压测可以临时提高阈值，但不建议完全放开到极高值，否则很容易触发整机卡死，且结果不代表“可运营容量”。

## 7. 优化建议（按优先级）

### P0（立刻做，避免整机卡死）

- API 增加全局并发保护（例如按连接/队列深度做软拒绝 503，而不是无限排队）
- 增加 server 级别超时与连接控制（Node `server.timeout/headersTimeout/keepAliveTimeout`）
- 给 API 进程设定内存上限与自愈（PM2 `--max-memory-restart`）
- Postgres `max_connections` 与 Prisma pool 做明确配置，避免连接风暴

### P1（提升容量上限）

- API 多进程（PM2 cluster `-i 2`），至少吃满 2 vCPU
- Postgres/Redis 与 API 解耦（云托管或独立主机），避免资源争抢

### P2（可观测与压测可复现）

- 将压测输出（k6 summary / 系统资源采样）落盘并纳入 `docs/` 固化
- 增加压测期间的采样脚本（每秒采集 CPU/RSS/连接数/队列长度）

