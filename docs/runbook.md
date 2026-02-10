# Runbook（生产排障手册）

本文面向“展会高峰期”值班排障，目标是用最短路径定位：**受理是否成功、异步队列是否堆积、飞书同步是否被限流/失败**。

## 1. 关键接口
- 受理接口：`POST /api/submissions`（期望 2s 内返回 `202`）
- 状态查询：`GET /api/submissions/:id/status`
- CSRF：`GET /api/csrf`
- 指标：`GET /metrics`
- 健康检查：`GET /health`

## 2. 关键字段
- `traceId`：API 每次请求都会在响应头返回 `X-Trace-Id`，同时写入结构化日志（pino）。
- `submissionId`：`POST /api/submissions` 成功返回的 `id`。
- `syncStatus`：
  - `PENDING`：已受理，等待 worker 同步飞书
  - `PROCESSING`：worker 正在处理
  - `RETRYING`：飞书调用失败且会重试（等待下一次尝试）
  - `SUCCESS`：已写入飞书
  - `FAILED`：最终失败（超过重试次数或不可重试错误）

## 3. 先看是否“受理成功”
1. 客户端是否收到 `202`？
2. 若无：看 PM2/API 日志是否出现 `403/429/5xx`。
3. 若有：用 `submissionId` 拉状态：
   - `GET /api/submissions/:id/status`

## 4. 飞书同步失败/延迟（worker）
### 4.1 常见现象
- 大量 `RETRYING`：通常是飞书限流（429）或网络抖动。
- 大量 `FAILED`：通常是字段映射问题（单选 optionId 不匹配、字段类型不一致、字段名变更）。

### 4.2 定位方式
1. 通过 `traceId` 在 worker 日志中检索对应任务失败原因。
2. 结合 `/metrics`：
   - `fbif_feishu_sync_jobs_total{result="retry"}` 是否快速增长（限流/抖动）
   - `fbif_feishu_sync_jobs_total{result="failed"}` 是否增长（不可重试错误）

### 4.3 快速缓解手段
- 降并发：调低 `FEISHU_WORKER_CONCURRENCY` 和 `FEISHU_WORKER_QPS`，减少 429。
- 加大退避：调大 `FEISHU_SYNC_BACKOFF_MAX_MS`。
- 字段变更：确认飞书多维表格字段名与单选选项是否变化（最常见原因）。

## 5. 上传失败（OSS）
### 5.1 现象
- `POST /api/oss/policy` 返回 `503 OSSUnavailable`：OSS 未配置或 env 缺失。
- policy 生成成功但 OSS 上传失败：检查 CORS、对象 ACL、大小限制、客户端带宽。

### 5.2 排障顺序
1. 看 API 日志中 `/api/oss/policy` 是否有 `ValidationError`（通常是超出大小限制）。
2. 验证 Bucket CORS（需要允许来自 WEB_ORIGIN 的 POST/OPTIONS）。
3. 检查 env：
   - `OSS_ACCESS_KEY_ID/OSS_ACCESS_KEY_SECRET/OSS_BUCKET/OSS_REGION(or OSS_HOST)`
   - `OSS_OBJECT_ACL`（若要 public 直链，建议 `public-read`）

## 6. 429/限流问题（入口）
### 现象
- API 返回 `429 Too many requests`

### 处理
- 临时放宽：
  - `RATE_LIMIT_MAX`（全局）
  - `RATE_LIMIT_BURST`（提交/签名接口的突发）
- 但要同步评估风控（防刷）与下游容量（DB/Redis/飞书限流）。

## 7. 最小回放（手工补偿）
当某条 `submissionId` 进入 `FAILED` 且你确认可以重试时，建议先修复根因（字段/权限/限流），再回放：
1. 在 Redis 中为队列 `feishu-sync` 重新添加 job（jobId=submissionId）。
2. 观察该 submission 的状态是否回到 `PROCESSING/RETRYING/SUCCESS`。

> 备注：后续可补一个受保护的管理接口（不对公网开放）来做“点选重试/批量重试”。

