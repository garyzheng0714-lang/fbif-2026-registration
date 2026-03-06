# Staging / Prod Alignment Runbook

这份 runbook 只覆盖“对齐准备”和“只读核对”。默认前提：

- 不修改正式端容器、数据库、env
- 不直接 push 到 GitHub，避免触发自动部署
- 所有 staging 变更都先做快照

## 当前基线

- 正式端稳定基线：`43ff13d`
- 测试端当前 release：`102eb54`
- GitHub `staging`：`247c4e8`

目标状态：

- GitHub `staging` 与 `main` 对齐到同一稳定 SHA
- 测试端 release 与正式端稳定 SHA 一致
- 测试库 schema 与正式库一致
- 测试端 `backend.env` 与正式端非 secret 配置一致，仅保留 staging 专属覆盖

## 先做的只读检查

1. 运行本地 drift 报告：

```bash
SSH_HOST=root@<your-server> \
SSH_KEY_PATH=/path/to/private-key \
./scripts/report-deploy-drift.sh
```

2. 重点确认以下输出：

- `main / staging / production/main / production/staging` 的 SHA
- 正式端与测试端当前 release SHA
- 正式端与测试端的关键 env 覆盖项
- `Submission` 表是否都包含跟踪字段

## 对齐时的约束

测试端 `backend.env` 需要与正式端对齐，但保留这些差异：

- `POSTGRES_DB=fbif_form_staging`
- `API_PORT=8083`
- `FEISHU_SUBMISSION_SOURCE=测试环境`
- `WEB_ORIGIN=<staging-domain>`

跟踪字段映射需要显式存在：

- `FEISHU_FIELD_CLICK_ID=`
- `FEISHU_FIELD_CLICK_ID_SOURCE_KEY=`
- `FEISHU_FIELD_TRACKING_PARAMS=访问跟踪参数`
- `FEISHU_FIELD_TRACKING_ID=跟踪ID`
- `FEISHU_FIELD_TRACKING_ID_TYPE=跟踪ID类型`

## 对齐后的 smoke checklist

在测试端各提交 1 条 `consumer` 和 1 条 `industry`，验证：

- API `/health` 正常
- 提交成功写入 `fbif_form_staging`
- Worker 消费成功
- 飞书写入成功
- 跟踪字段写入成功
- `FEISHU_SUBMISSION_SOURCE=测试环境`

## 明确不在本轮执行的事项

- 不修改正式端服务器
- 不切换正式端 release
- 不直接改 GitHub 远端分支
- 不删除 `docker-compose.staging.yml`
