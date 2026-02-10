# 稳定性评估（目标：99.9% “受理即可靠”）

## 1. 目标口径（SLO）
- **受理成功率**：`POST /api/submissions` 返回 `202` 的比例 ≥ 99.9%（7 天窗口）
- **受理时延**：`POST /api/submissions` P95 < 2s（不含附件上传；附件直传 OSS）
- **最终一致**：99% 的 submission 在 10 分钟内同步到飞书多维表格

## 2. 当前架构满足点
- 大文件不经过应用服务器：浏览器直传 OSS，API 只签名（降低 OOM/带宽瓶颈）
- API 与飞书写入解耦：API 受理后落库 + 入队，worker 异步写飞书
- 失败可重试：BullMQ attempts + exponential backoff
- 可观测：`traceId` 贯穿日志，`/metrics` 提供核心计数与系统指标

## 3. 主要风险（现实约束）
即使代码层面实现“受理即可靠”，**单机单点**仍然限制真实可用性上限：
- ECS/磁盘/网络异常会造成整体不可用
- Redis/PostgreSQL 若同机部署，仍是单点

若目标为“接近平台级 99.9%”，建议：
- RDS PostgreSQL（托管）
- 云 Redis（托管）
- API/Worker 分离（至少 2 实例）+ 负载均衡
- 静态资源上 CDN/OSS

## 4. 观测与告警（最小可用）
### 4.1 指标
从 `/metrics` 关注：
- `fbif_submissions_accepted_total`：受理计数（按 role）
- `fbif_feishu_sync_jobs_total{result="success|retry|failed"}`：飞书同步结果
- `fbif_feishu_api_errors_total{retryable="true|false"}`：飞书错误分类
- 默认系统指标：进程内存、CPU、event loop

### 4.2 建议告警
- 受理成功率（202）< 99.9%（5 分钟窗口）
- `result="failed"` 持续增长
- `result="retry"` 突增且持续（飞书限流风险）
- 进程内存持续上升（泄漏/堆积）

## 5. 容量压测建议（分层）
### 5.1 API 受理压测（不含附件）
- 只压 `GET /api/csrf` + `POST /api/submissions`
- 目标：验证 DB/Redis/入口限流的吞吐上限与 P95

### 5.2 附件真实压测（含 20-50MB）
- 重点验证：OSS policy、直传成功率、用户端超时/重试体验
- 注意：单台压测机出口带宽可能成为瓶颈，报告需标注压测机带宽

## 6. 验收清单（上线前）
- [ ] API/Worker 都能启动并通过 `/health`
- [ ] `POST /api/oss/policy` 正常签名，OSS CORS/ACL 配置正确
- [ ] 行业用户提交后，飞书表格字段（业务类型/部门/附件链接）正确落库
- [ ] Worker 重试与状态机正确：`PENDING -> PROCESSING -> (RETRYING)* -> SUCCESS/FAILED`
- [ ] `/metrics` 可访问并持续上报
- [ ] 压测报告与稳定性评估报告已填入真实数据（见 `docs/performance-report.md`）

