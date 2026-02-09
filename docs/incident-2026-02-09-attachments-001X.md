# 事故与修复报告：2026-02-09（证件号后四位 001X）附件未写入多维表格

## 结论 / 当前状态

- 已修复并上线：表单的「专业观众证明」附件现在会实际上传，并写入飞书多维表格的附件字段（`上传专业观众证明`）。
- 历史数据无法补救：在修复前，前端并未上传文件内容，服务端也未接收文件字节，因此 2026-02-09 09:13-10:25（用户反馈窗口）期间“显示提交成功但表格无附件”的提交，其附件无法从服务端或飞书侧找回，只能让用户重新提交。

## 影响范围

- 影响对象：选择「食品行业相关从业者（industry）」且携带附件的提交。
- 表现形式：
  - 多维表格记录可能创建成功，但附件字段为空。
  - 部分视图依赖公式字段 `票种（SKU）`；若 `观展身份` 未写入，会导致 `票种（SKU）` 为空，从而在筛选视图中“看不到记录”，进一步误判为“没有提交成功”。

## 调查结论（根因）

### 根因 1：前端未上传文件字节

- `apps/web/src/App.tsx` 旧逻辑仅把 `file.name` 保存并以 JSON 形式提交（例如 `proofFileNames`），没有走 `multipart/form-data`，导致服务端根本收不到文件内容，自然也无法写入多维表格的附件字段。

### 根因 2：后端缺少附件链路（创建记录后未上传附件并回写）

- `apps/mock-api/src/app.js` 旧逻辑仅接收 JSON；未配置上传中间件（multer）、未落盘临时文件、未上传飞书 Drive Media、未对 Bitable 记录做附件字段更新。

### 根因 3（修复过程中暴露）：Drive token 归属不正确导致回写失败

- 早期尝试使用 `drive/v1/files/upload_all` + `parent_type=explorer` 生成的 `file_token` 在回写 Bitable 附件字段时会报错：
  - `The attachment does not belong to this bitable.`
- 解决方式：改为使用 `drive/v1/medias/*` 上传，并将 `parent_type=bitable_file`、`parent_node=FEISHU_APP_TOKEN`（默认）以确保 token 归属于该 Bitable，可被附件字段接受。

## 修复内容（已上线）

### 配置层

- 上传限制（后端 multer）：
  - 单文件上限：50 MB（`MOCK_API_MAX_UPLOAD_MB=50`）
  - 文件数上限：5（`MOCK_API_MAX_UPLOAD_FILES=5`）
  - 临时目录：`/tmp/fbif-form-uploads`（可配 `MOCK_API_UPLOAD_DIR`）

### 代码层

- 前端（`apps/web/src/App.tsx`）
  - 行业观众走 `FormData` 上传：字段 + `proofFiles`（可多文件）。
  - 不再把附件信息持久化到 `localStorage`（刷新后需重新选择文件，避免“显示成功但实际无文件数据”）。

- 后端（`apps/mock-api`）
  - `POST /api/submissions` 自动识别 `multipart/form-data`：
    - 使用 `multer` 落盘临时文件。
    - 行业观众未上传附件则直接 400（前置校验）。
  - 异步同步链路（`apps/mock-api/src/store.js`）：
    1. 先创建 Bitable 主记录；
    2. 上传附件到 Drive Media：
       - `<= 20MB` 用 `upload_all`
       - `> 20MB` 用 `upload_prepare/upload_part/upload_finish` 分片上传
       - 含 Adler32 checksum；并对 sha256+filename 做 token 缓存，避免同名同内容重复上传
    3. 更新 Bitable 记录附件字段；
    4. 若“主记录已创建但附件链路失败”，则回滚删除该记录，保证表一致性；
    5. 无论成功/失败均清理临时文件。
  - 重试与退避：对飞书 API 调用加入指数退避重试（最大 3 次）。
  - 可观测性：
    - 为每个请求生成 `traceId`（响应头 `X-Trace-Id`，响应体也返回 `traceId`）。
    - 关键链路日志包含：时间戳、`traceId`、证件号后四位、submissionId、附件上传阶段。

### 权限层

- 当前链路无 API Gateway / Nginx 反代层；后端仅依赖 CSRF（cookie + header）。
- 未观察到 401/403 或限流导致的失败；tenant_access_token 会自动刷新。

## 验证结果（生产环境实测）

> 在阿里云服务器本机对 `http://127.0.0.1:8080` 进行 `curl -F proofFiles=@...` 测试；证件号使用非真实值 `TEST001X`（后四位 001X）。

- 小文件（1 MB，单附件）：同步成功，附件字段可预览（proofCount=1）
- 大文件（11 MB，单附件，`upload_all`）：同步成功，附件字段可预览（proofCount=1）
- 超 20MB（21 MB，单附件，分片上传）：同步成功（proofCount=1）
- 多附件（3 x 11 MB）：同步成功（proofCount=3）

示例日志（`/root/.pm2/logs/fbif-mock-api-out.log`，已含时间戳与 traceId）：

```text
2026-02-09T03:33:04.823Z submission upload accepted: [trace=...] [idSuffix=001X] [sub=...] role=industry files=1 bytes=1048576
2026-02-09T03:33:06.023Z multitable sync start: [trace=...] [idSuffix=001X] [sub=...] files=1
2026-02-09T03:33:09.423Z multitable attachment upload ok: [trace=...] [idSuffix=001X] [sub=...] count=1 ms=3401
2026-02-09T03:33:10.941Z multitable sync ok: [trace=...] [idSuffix=001X] [sub=...] ms=4919
```

## 关于“<500ms / 平均<2s”的说明

- 对于 `>10MB` 的附件，**端到端上传 + 飞书侧落盘 + Bitable 回写**在现实网络下很难做到 `<500ms`，也很难稳定 `<2s`。
- 当前实现能保证正确性与可观测性；若需要进一步压缩耗时，建议改为“浏览器直传 OSS/飞书中转 + 后端仅回写 URL/token”的架构，并在前端增加上传进度提示。

## 运维与排查指引（面向后续类似问题）

- 服务器日志：
  - 业务链路日志：`/root/.pm2/logs/fbif-mock-api-out.log`
  - 错误日志：`/root/.pm2/logs/fbif-mock-api-error.log`
  - 建议过滤关键字：`multitable|attachment|upload|idSuffix=001X|trace=`
- 端口路径：
  - Web：PM2 `fbif-web`（`0.0.0.0:3001`）
  - API：PM2 `fbif-mock-api`（`0.0.0.0:8080`）
  - 当前链路不经过 Nginx；如未来加反代，需同步放开 `client_max_body_size` 与 `proxy_read_timeout`。

