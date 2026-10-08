# HTTP API

实现真身是 `apps/api/src/server.ts`、`apps/api/src/routes/` 和 `apps/api/src/validation/submission.ts`。所有 `/api/*` 请求都受全局限流；写操作还要求 CSRF token，并可能受突发限流。

文档示例只使用占位符。不要把真实姓名、手机号、证件号、Cookie、token 或完整报名载荷写进命令历史和 Markdown。

## 通用约定

- JSON 请求设置 `Content-Type: application/json`。
- 写接口先调用 `GET /api/csrf`，保留响应 Cookie，并在后续请求发送 `X-CSRF-Token`。
- 响应会带链路 `traceId`；排障使用 `traceId` 和 `submissionId`，不要用证件号检索日志。
- 校验失败返回结构化错误；限流返回 `429`；未配置的可选能力通常返回 `503`。

## `GET /health`

返回服务状态、构建 SHA、环境和 uptime。容器健康检查直接访问 API；公网 `/health` 可能由网关改写为轻量 `/healthz`，两者用途不同。

## `GET /metrics`

返回 Prometheus 文本指标，并刷新队列指标。该端点不得暴露报名明文或凭据。

## `GET /api/csrf`

返回 CSRF token 并设置 Cookie。浏览器和脚本必须在同一会话中使用响应 token 与 Cookie。

```json
{ "csrfToken": "<CSRF_TOKEN>" }
```

## `POST /api/oss/policy`

获取浏览器直传 OSS 的短期策略。

```json
{
  "filename": "<SAFE_FILENAME>",
  "size": 12345
}
```

OSS 未配置时返回 `503 OSSUnavailable`；文件名、大小或策略约束不满足时返回 `400 ValidationError`。API 不接收大文件正文。

## `POST /api/id-verify`

可选身份证二要素验证，仅支持 `idType=cn_id`。成功验证时返回短期 `verificationToken`，启用实名门禁后必须把该 token 随报名提交。

```json
{
  "name": "<NAME>",
  "idType": "cn_id",
  "idNumber": "<ID_NUMBER>"
}
```

不得保存或记录这类请求体。服务未启用、上游失败、证件格式错误和信息不匹配是不同状态，调用方应按响应码与 `error` 字段处理。

## `POST /api/submissions`

校验并受理报名。核心字段：

| 字段 | 必填 | 约束 |
| --- | --- | --- |
| `role` | 是 | `industry` 或 `consumer` |
| `idType` | 是 | `cn_id` 或代码支持的其他证件枚举 |
| `idNumber` | 是 | 中国身份证校验，或 6–20 位其他证件格式 |
| `phone` | 是 | 中国大陆手机号或带 `+` 的国际号码 |
| `name`、`title`、`company` | 是 | 长度由 Zod schema 限制 |
| `businessType` | 行业观众必填 | 非空文本 |
| `department` | 否 | 部门文本 |
| `clientRequestId` | 建议 | 8–64 字符；服务端幂等键 |
| `idVerifyToken` | 条件必填 | 启用中国身份证实名验证时必填 |
| `proofUrls` | 否 | OSS URL 数组；当前行业证明材料未强制 |
| `clickId` / `clickIdSourceKey` | 否 | 来源键仅允许 `click_id`、`qz_gdt`、`gdt_vid`；有来源键时必须有 ID |
| `trackingParams` / `trackingId` / `trackingIdType` | 否 | 长度受限并在入库前清洗 |

请求骨架：

```json
{
  "clientRequestId": "<UNIQUE_REQUEST_ID>",
  "role": "consumer",
  "idType": "cn_id",
  "idNumber": "<ID_NUMBER>",
  "phone": "<PHONE>",
  "name": "<NAME>",
  "title": "<TITLE>",
  "company": "<COMPANY>"
}
```

成功返回 `202`：

```json
{
  "id": "<SUBMISSION_ID>",
  "traceId": "<TRACE_ID>",
  "syncStatus": "PENDING"
}
```

`202` 只证明提交已在本系统受理，不证明飞书同步成功。重复 `clientRequestId` 应返回同一提交语义，调用方不要自行生成第二条报名。

## `GET /api/submissions/:id/status`

查询异步同步状态。响应包含 `syncStatus`、尝试次数、最后/下次尝试时间，以及成功后的飞书记录 ID或失败摘要。

状态含义：

- `PENDING`：已受理，等待 worker。
- `PROCESSING`：正在同步。
- `RETRYING`：暂时失败，已安排重试。
- `SUCCESS`：已写入飞书。
- `FAILED`：达到重试上限或遇到不可重试错误，需要按 Runbook 处理。

状态接口只接受 submission ID；不要设计按手机号或证件号公开查询的接口。
