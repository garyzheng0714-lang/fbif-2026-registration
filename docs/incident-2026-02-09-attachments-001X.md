# 事故与修复报告：2026-02-09（证件号后四位 001X）附件未写入多维表格

## 结论 / 当前状态

- 2026-02-10：生产已迁移到 `apps/api`（PostgreSQL + Redis + BullMQ），附件采用 OSS 直传并写入“附件链接”，不再走飞书附件 token 回写链路；本文保留为 2026-02-09 的历史事故复盘与经验沉淀。
- 已修复并上线（2026-02-09）：行业观众的「专业观众证明」附件已支持 `multipart/form-data` 上传，并在后台异步写入飞书多维表格附件字段。
- 已补齐可观测性：前端提交成功弹窗会返回 `traceId` 与 `submissionId`，服务端链路日志也会带上这两个值，便于精确排查。
- 已增强可靠性：服务端采用**磁盘持久化队列 + 并发控制 + 指数退避重试**。同步成功后才清理临时文件；失败会保留文件并自动重试，超过最大次数进入 `dead` 目录等待人工处理。
- 已优化附件上传体验：附件区支持追加文件（不会再覆盖/消失），提交时展示上传进度，上传完成后展示缩略图与 hover 下载入口。

## 影响范围

- 影响对象：选择「食品行业相关从业者（industry）」且携带附件的提交。
- 影响表现：
  - 表单前端提示“提交成功”（HTTP 202 Accepted），但后台异步写入失败导致多维表格看不到记录或附件缺失。
  - 若多维表格视图存在筛选条件（例如依赖某些字段或公式字段），也可能造成“记录已创建但视图里看不到”，需要在全表或无筛选视图中确认。

## 调查结论（根因）

### 根因 1：飞书附件 token 归属不正确，导致 Bitable 回写被拒绝

生产错误日志中发现明确证据（`/root/.pm2/logs/fbif-mock-api-error.log`）：

```text
feishu sync failed: [trace=bb257e0e-7a34-46b4-8e1d-80807b316911] [idSuffix=001X] [sub=825f2adc-85cb-4989-98e3-d12e830610f9] update record failed: The attachment does not belong to this bitable.
```

该错误意味着上传得到的 `file_token` 不属于当前多维表格（上传接口/parent 参数不匹配），从而在更新附件字段时被飞书拒绝，最终表现为“提交受理成功，但附件没有写入表格”。

### 根因 2：异步受理导致“成功提示”与“最终落表”存在时间差

系统采用 `202 Accepted` 作为受理成功（为了前端快速响应），多维表格写入在后台异步完成。

- 如果后台同步失败且没有可靠的队列/重试，用户会感知为“显示成功但表格没有数据/附件”。
- 因此需要“可观测性 + 持久化队列 + 重试”来保证最终一致性。

### 根因 3（历史版本）：附件字节未进入服务端，无法补齐

在 `multipart` 支持上线之前，如果前端仅提交文件名/元数据而未上传文件字节，则服务端与飞书侧都不存在可用的附件内容，历史提交无法补齐，只能重新提交。

## 修复内容（已上线）

### 后端（`apps/mock-api`）

- `POST /api/submissions` 支持 `multipart/form-data`，使用 `multer` 落盘临时文件。
- 多维表格同步链路（后台队列任务）：
  1. 创建 Bitable 主记录；
  2. 使用 Drive Media 上传附件（确保 token 归属该 Bitable）；
  3. 更新 Bitable 记录的附件字段；
  4. 成功后清理本地临时文件；失败则保留文件并进入重试。
- 可靠性机制：
  - 队列目录（生产）：`/opt/web-fbif-form/shared/mock-api-queue/{pending,processing,dead}`
  - 失败自动重试：指数退避（exponential backoff），最大次数可配置；超过上限进入 `dead`。
- 可观测性：
  - 服务端生成 `traceId` 并通过响应头/响应体返回；
  - 关键日志包含 `traceId`、证件号后四位、`submissionId`、上传字节数与多维表格同步阶段。

### 前端（`apps/web`）

- 附件组件重构：
  - 选择文件后显示缩略图卡片；
  - 再次选择/拖拽/粘贴会**追加**文件，不会覆盖之前已选内容；
  - 支持单个文件移除（右上角 X）；
  - 上传完成后 hover 显示文件名与下载按钮。
- 提交体验：
  - 行业观众提交走 `XMLHttpRequest + FormData`，可展示上传进度（匹配“上传中”的 UI 状态）；
  - 服务端返回 `202` 后立即展示“提交成功”弹窗，并展示 `traceId/submissionId` 供排查。

## 验证结果（生产环境实测）

以 `idSuffix=001X` 的一笔提交为例（日志来自 `/root/.pm2/logs/fbif-mock-api-out.log`）：

```text
2026-02-09T06:03:15.032Z submission upload accepted: [trace=22e7ab73-ba0e-401a-a8b7-615bba2b6f93] [idSuffix=001X] [sub=013af68a-f06e-4723-a423-3831df2739fe] role=industry files=1 bytes=52559
2026-02-09T06:03:15.384Z multitable sync start: [trace=22e7ab73-ba0e-401a-a8b7-615bba2b6f93] [idSuffix=001X] [sub=013af68a-f06e-4723-a423-3831df2739fe] files=1
2026-02-09T06:03:17.765Z multitable attachment upload ok: [trace=22e7ab73-ba0e-401a-a8b7-615bba2b6f93] [idSuffix=001X] [sub=013af68a-f06e-4723-a423-3831df2739fe] count=1 ms=2381
2026-02-09T06:03:19.734Z multitable sync ok: [trace=22e7ab73-ba0e-401a-a8b7-615bba2b6f93] [idSuffix=001X] [sub=013af68a-f06e-4723-a423-3831df2739fe] record_id_suffix=mQdWl9 ms=4350
```

说明：日志时间为 UTC（`toISOString()`），若按北京时间（UTC+8）对齐，请将时间 +8 小时。

## 运维与排查指引（后续快速定位）

- 关键日志：
  - 正常链路：`/root/.pm2/logs/fbif-mock-api-out.log`
  - 异常链路：`/root/.pm2/logs/fbif-mock-api-error.log`
- 推荐检索条件：
  - 证件号后四位：`idSuffix=001X`
  - 单笔链路：`trace=<traceId>` 或 `sub=<submissionId>`
  - 关键字：`multitable`、`attachment`、`upload`、`retry`、`dead`
- 端口路径：
  - Web：PM2 `fbif-web`（`0.0.0.0:3001`）
  - API：PM2 `fbif-mock-api`（`0.0.0.0:8080`）
