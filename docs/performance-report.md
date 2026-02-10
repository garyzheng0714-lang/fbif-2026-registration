# 性能测试报告

## 测试环境
- 测试日期：2026-02-10
- 目标 API：生产 `http://112.124.103.65:8080`（`apps/api`：`/api/oss/policy` + `/api/submissions`）
- 压测机：本地（Mac mini，出口带宽未知）

## 测试方法
### 1) OSS 附件真实压测（推荐）
脚本：`tests/load/mixed_oss_100.sh`

- 并发：100（60 行业 + 40 消费者）
- 行业用户：先 `/api/oss/policy`，再直传 OSS，最后携带 `proofUrls` 调用 `/api/submissions`
- 消费者：直接调用 `/api/submissions`

> 注意：脚本里的 `apiMs` 是“整条链路耗时”（包含 CSRF、policy、OSS 上传、submit），不是纯 API 受理耗时。

## 结果摘要
### A. 100 并发（每个行业用户 1 个 20MB 附件）
- 总请求：100
- 成功：100/100（行业 60/60；消费者 40/40）
- OSS 上传 HTTP：`200` x 60
- 链路耗时（包含 OSS 上传）：P50 101s；P95 271s

### B. 100 并发（每个行业用户 3 个 20MB 附件）
- 总请求：100
- 成功：100/100（行业 60/60；消费者 40/40）
- OSS 上传 HTTP：`200` x 180
- 链路耗时（包含 OSS 上传）：P50 401s；P95 803s

## 结论
- 100 并发场景下，OSS 直传与提交链路整体稳定（无超时/无失败）。
- 上传耗时主要由压测机出口带宽与用户侧网络决定；后端不承载附件流量。
- 若需评估纯 API 受理吞吐（不含 OSS 上传），应使用 k6 脚本 `tests/k6/form-submit.js` 单独压测 `/api/csrf` + `/api/submissions`。
