# 文档索引

本目录只保留现行操作说明、接口契约和仍有复用价值的验证方法。代码、workflow、Prisma schema 与环境变量 schema 是实现事实；文档与实现冲突时，先核对实现，再在同一变更中修正文档。

## 先读

| 场景 | 文档 | 权威范围 |
| --- | --- | --- |
| 第一次接手 | [`../README.md`](../README.md) | 项目入口、本地启动 |
| AI/自动化协作 | [`../CLAUDE.md`](../CLAUDE.md) | 边界、红线、命令与指针 |
| 仓库和环境关系 | [`repo-deploy-truth-map.md`](repo-deploy-truth-map.md) | 主仓库、分支、Preview/Production |
| 发布 | [`release-flow.md`](release-flow.md) | 从 PR 到 Preview、生产确认 |
| 生产故障 | [`runbook.md`](runbook.md) | 受理、队列、飞书、OSS、限流 |
| 端口串线 | [`production-port-isolation-runbook.md`](production-port-isolation-runbook.md) | 稳态门禁与止血 |

## 开发与接口

- [`local-dev-environment.md`](local-dev-environment.md)：前端与模拟 API 联调。
- [`api.md`](api.md)：公开 HTTP 接口与请求约定。
- [`preview-spec.md`](preview-spec.md)：本地/远程预览规范。
- [`performance-test.md`](performance-test.md)：压测方法、已验证边界与结果记录要求。
- [`user-manual.md`](user-manual.md)：终端用户流程。

## 集成

- [`feishu-setup.md`](feishu-setup.md)：飞书 Base 权限与字段映射。
- [`aliyun-id-verify-integration.md`](aliyun-id-verify-integration.md)：身份证二要素校验。
- [`tencent-ads-attribution-spec.md`](tencent-ads-attribution-spec.md)：腾讯广告点击归因。
- [`cdn-setup-guide.md`](cdn-setup-guide.md)：阿里云 CDN 配置、验收与回退。
- `esa-migration-guide.html`、`esa-production-cutover.html`：ESA 迁移与生产切换说明；外部控制台状态仍需现场验证。

## 部署与运维

- [`deploy-guide.md`](deploy-guide.md)：仅保留新机初始化的历史参考；现役发布入口是 `release-flow.md` 和当前 workflow。
- [`github-actions-deploy.md`](github-actions-deploy.md)：workflow 触发与部署门禁。
- [`release-flow.md`](release-flow.md)：发布审批顺序。
- [`repo-deploy-truth-map.md`](repo-deploy-truth-map.md)：环境/端口真相表。
- [`runbook.md`](runbook.md)：常规排障与补偿。
- [`production-port-isolation-runbook.md`](production-port-isolation-runbook.md)：生产/Preview 隔离。

完成或失效的执行计划、旧部署说明、旧单进程压测结论、历史报名明细和飞书官方 SDK 文档副本不在本目录保留；需要追溯时使用 Git 历史，飞书 SDK 以官方文档为准。长期未排期事项只放在 [`../TODOS.md`](../TODOS.md)。
