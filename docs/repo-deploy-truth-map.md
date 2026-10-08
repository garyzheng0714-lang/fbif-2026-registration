# 仓库与部署真相地图

核对日期：2026-07-17（Asia/Shanghai）。部署细节仍以当前 `.github/workflows/`、`scripts/remote-deploy.sh` 和服务器现场状态为最终证据。

## 仓库权威关系

| 对象 | 角色 | 是否可开发/部署 |
| --- | --- | --- |
| GitHub `fbif-2026-registration` 的 `main` | 唯一代码与部署真身 | 是 |
| 本目录 | 现役本地工作副本；可能处于功能分支并有未提交改动 | 先保护工作树，再与 `origin/main` 对齐 |
| GitHub `web-fbif-form` | 镜像/备份 | 否 |
| `归档/fbif-2026-registration` | 2026-03-09、commit `8941d5e` 的本地冻结快照 | 否 |
| `归档/web-fbif-form` | 与上项同 commit 的重复本地冻结快照 | 否 |

两个归档目录不维护第二套产品文档。需要追溯旧实现时读各自 Git 历史；任何现行判断回到主仓库 `main` 和本目录的权威文档。

## 分支与发布

- `main` 是唯一部署分支。
- Push 到 `main` 触发 `.github/workflows/deploy-preview.yml`，只更新 Preview。
- Production 由 `.github/workflows/deploy-aliyun.yml` 的 `workflow_dispatch` 人工触发；必须先取得用户明确确认。
- 本地功能分支不能直接代表已部署状态。文档、代码和部署状态必须分别核验，不能用分支名推断线上事实。

## 环境映射

| 环境 | Web 入口 | API 数据面 | Docker 项目/数据 | 触发 |
| --- | --- | --- | --- | --- |
| Preview | Caddy `:3003` → 独立主机网关 | 蓝绿临时槽位 `28080/28081` | `fbif-form-staging`，独立 PostgreSQL/Redis | `main` push |
| Production | HTTPS 域名 → Caddy → 主机 Nginx `3001` | 蓝绿槽位 `8080/18080` | `fbif-form`，生产 PostgreSQL/Redis | 人工 dispatch |

两套环境可以位于同一服务器，但端口、Nginx 站点、Docker 项目名、数据库和 Redis 必须隔离。生产发布门禁会拒绝 Preview 占用生产槽位，也会拒绝生产 Caddy 绕过 `3001`。

## 运行链路

```text
main push
  └─ deploy-preview.yml
       └─ Preview: Caddy 3003 → staging 网关 → 28080/28081

人工确认 + workflow_dispatch
  └─ deploy-aliyun.yml
       └─ Production: HTTPS → Caddy → Nginx 3001 → 8080/18080
            └─ API 容器：PM2 3×API + 可选 1×BullMQ worker
```

两套环境的报名都先写各自 PostgreSQL。飞书 Base 是否共用及其来源字段以部署环境变量和 `docs/feishu-setup.md` 为准，不把具体凭据写在本文。

## 现场核验顺序

1. `git status --short` 和 `git branch -vv`：确认本地未提交内容与分支，不覆盖工作。
2. 读取当前 workflow 和 `scripts/remote-deploy.sh`：确认端口、项目名、门禁与回滚逻辑。
3. 部署前执行脚本的 `preflight`；不得凭旧文档手写旁路命令。
4. 部署后核对 Caddy/Nginx 上游、容器端口、`/health`、`/api/csrf`、静态资源和报名 `202`。
5. 最终飞书同步要通过提交状态与目标表记录确认，不能把 HTTP `202` 当作同步成功。

## 相关文档

- `release-flow.md`：发布审批顺序。
- `github-actions-deploy.md`：workflow 细节。
- `production-port-isolation-runbook.md`：端口门禁与串线止血。
- `runbook.md`：受理、队列、飞书与 OSS 排障。
