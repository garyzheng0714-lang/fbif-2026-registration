# 仓库与部署真相地图

更新时间：2026-03-05（Asia/Shanghai）

本文档用于冻结当前仓库、分支、服务器、飞书表、GitHub Actions 与部署文档的真实关系，并明确哪些结论已经核实，哪些仍然只是从仓库配置推断出来的结果。

## 判定规则

- 已核实：来自本地 Git 现状、仓库内 workflow/script 文本，或此前已经直接核验过的生产服务器事实。
- 配置可见但未实机核实：仓库文件中能看到配置，但没有通过实时 SSH / 控制台确认运行态。
- 待补证：目前无法证明 staging 服务器 `112.124.103.65` 的实时目录、容器、代理与端口状态。

## 当前冻结结论

- 主仓库应冻结为 `fbif-2026-registration.git`。
- `web-fbif-form.git` 只保留镜像/备份语义，不再承载独立产品语义。
- `main` 只对应生产环境。
- `staging` 只对应测试环境。
- 生产服务器已核实为 `121.40.214.5`，测试服务器暂按 workflow 和文档推定为 `112.124.103.65`。
- 生产与测试当前共用飞书表 `tbl0CQ74guMS1IDd`，通过 `FEISHU_SUBMISSION_SOURCE` 区分来源。

## 1. 仓库映射表

| 对象 | 当前值 | 当前关系 | 是否 source of truth | 证据/说明 |
| --- | --- | --- | --- | --- |
| 主仓库 | `https://github.com/garyzheng0714-lang/fbif-2026-registration.git` | 本地 remote 名为 `production` | 是 | `main` 当前跟踪 `production/main` |
| 镜像仓库 | `git@github.com:garyzheng0714-lang/web-fbif-form.git` | 本地 remote 名为 `backup` | 否 | 仅承载镜像/历史分支，不应再作为判断生产状态的依据 |
| 本地工作树 | `/Users/simba/local_vibecoding/web-fbif-form` | 目录名仍沿用旧仓库名 | 否 | 目录命名与主仓库名不一致，是认知混乱源之一 |
| 当前 `HEAD` | `6386a7210ec56479ff64fb65cc3cd61c5276d4ca` | 位于本地 `main` | 是 | 已与生产服务器当前 release commit 对齐 |
| 当前 remote 命名 | `production` / `backup` | 未使用 `origin` | 否 | 当前命名本身清晰，但文档必须明确 `production` 才是主仓库 |

## 2. 分支映射表

| 分支/引用 | 当前观察到的位置 | 当前语义 | 允许部署到哪里 | 状态 |
| --- | --- | --- | --- | --- |
| `main` | 本地分支，跟踪 `production/main` | 生产分支 | 只允许生产服务器 `121.40.214.5` | 已核实分支跟踪关系；生产部署事实已核实 |
| `staging` | 仅观察到 `production/staging`，本地未检出 | 测试分支 | 只允许测试服务器 `112.124.103.65` | workflow 与文档一致指向测试，但服务器运行态待补证 |
| `backup/main` | 镜像仓库默认分支 | 镜像/备份引用 | 不应作为正式部署判断依据 | 历史遗留，保留只用于镜像同步 |
| `backup/claude/*`、`backup/codex/*` | 镜像仓库历史开发分支 | 历史分支 | 不应直接部署 | 本地仍有 `claude/gallant-visvesvaraya`、`codex/api-migration`、`codex/fix-attachment-upload` 跟踪 `backup/*` |

## 3. 服务器映射表

| 环境 | 核实状态 | 服务器 | 应用目录 | 反向代理 | Docker 项目名 | 数据库名 | 健康检查 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 生产 | 已核实 | `121.40.214.5` | `/opt/web-fbif-form` | Caddy | `fbif-form` | `fbif_form`（来自 compose 默认值与现有文档，未单独实机复核） | API：`http://127.0.0.1:8080/health` | `current -> /opt/web-fbif-form/releases/6386a7210ec56479ff64fb65cc3cd61c5276d4ca`；外部域名为 `https://fbif2026ticket.foodtalks.cn` |
| 测试 | 待补证 | `112.124.103.65` | `/opt/web-fbif-form-staging` | 未核实；仓库内仍可见 Nginx 过渡清理痕迹 | `fbif-form-staging`（来自 workflow/CLAUDE） | `fbif_form_staging`（workflow 硬编码） | API：`http://127.0.0.1:8083/health`；Web：`http://127.0.0.1:3003/healthz` | 目前只能确认 workflow 目标，不可把实时运行态当成已核实事实 |

补充：

- 生产 workflow 还会把前端静态文件复制到 `/var/www/fbif-form`，这是仓库配置可见事实，但尚未重新登录生产机逐项复核。
- staging workflow 通过 `COMPOSE_PROJECT_NAME=fbif-form-staging` 与生产环境隔离。

## 4. 飞书映射表

| 环境 | `FEISHU_APP_TOKEN` | `FEISHU_TABLE_ID` | `FEISHU_FIELD_CLICK_ID` | `FEISHU_FIELD_CLICK_ID_SOURCE_KEY` | `FEISHU_SUBMISSION_SOURCE` | 状态/备注 |
| --- | --- | --- | --- | --- | --- | --- |
| 生产 | `<YOUR_FEISHU_APP_TOKEN>` | `tbl0CQ74guMS1IDd` | `click_id` | 空 | `正式环境` | 这些值已核实；`clickIdSourceKey` 仍是配置缺口，不纳入本轮收敛主任务 |
| 测试 | `<YOUR_FEISHU_APP_TOKEN>` | `tbl0CQ74guMS1IDd` | 未冻结，依赖环境变量/表字段映射 | 未冻结，当前来自 secret | `测试环境` | 该共享表策略来自 2026-03-05 的最新决策；环境区分依赖 `FEISHU_SUBMISSION_SOURCE` |
| 共享默认值 | `<YOUR_FEISHU_APP_TOKEN>`（`.env.example`） | `tbl0CQ74guMS1IDd`（`.env.example` 与 `update-backend-env.sh`） | `click_id`（`update-backend-env.sh`） | 空（`update-backend-env.sh`） | 默认 `正式环境`（`update-backend-env.sh`） | 当前默认表与正式/测试共享策略一致；真正风险在于如果 staging 未显式覆盖来源值，会被误标成正式环境 |

当前需要特别注意的字段层问题：

- 文档 `docs/tencent-ads-attribution-spec.md` 要求飞书字段保持 `腾讯广告点击ID` / `腾讯广告点击ID来源字段`。
- 生产环境当前已核实的 `FEISHU_FIELD_CLICK_ID` 却是 `click_id`。
- 这说明“字段规范文档”和“当前生产配置”之间至少有一处未收敛，必须在后续修复中二选一：要么更新真实表字段和环境变量，要么回写文档承认现状。

## 5. 工作流映射表

| Workflow | 触发分支 | 当前目标服务器 | 当前目标目录 | 飞书表来源 | 其他关键环境语义 | 默认值风险 |
| --- | --- | --- | --- | --- | --- | --- |
| `.github/workflows/deploy-aliyun.yml` | `main` | `ALIYUN_HOST` secret；若未提供则 fallback 到 `121.40.214.5` | `APP_DIR` secret；remote script fallback `/opt/web-fbif-form` | `FEISHU_TABLE_ID` secret；若空则 `scripts/update-backend-env.sh` 默认 `tbl0CQ74guMS1IDd` | 会把静态文件复制到 `STATIC_DIR`，默认 `/var/www/fbif-form`；API 健康检查 `127.0.0.1:8080/health` | 中：如果 production secrets 未对齐，仍可能偏离当前冻结语义 |
| `.github/workflows/deploy-staging.yml` | `staging` | `ALIYUN_HOST` secret；若未提供则 fallback 到 `112.124.103.65` | 固定 `/opt/web-fbif-form-staging` | 当前硬编码 `tbl0CQ74guMS1IDd` | 固定 `POSTGRES_DB=fbif_form_staging`、`WEB_PORT=3003`、`API_PORT=8083`、`FEISHU_SUBMISSION_SOURCE=测试环境` | 中：共享表策略已符合当前决策，但必须保住 `FEISHU_SUBMISSION_SOURCE=测试环境` |

## 6. 已知冲突清单

| 文件位置 | 当前值 | 应有值 | 风险 |
| --- | --- | --- | --- |
| `docs/deploy-guide.md` | 生产初始化仍写 `git clone https://github.com/garyzheng0714-lang/web-fbif-form.git current` | 应改为从主仓库 `fbif-2026-registration.git` 拉取，或明确这是镜像应急路径而不是主路径 | 新机器可能从镜像仓库拉起生产，绕开主仓库语义 |
| `scripts/update-backend-env.sh` | 默认 `FEISHU_TABLE_ID=tbl0CQ74guMS1IDd`、`FEISHU_SUBMISSION_SOURCE=正式环境` | 必须明确表默认值可共享，但 staging 绝不能依赖默认来源值 | 手工部署或 secret 缺失时，测试环境可能被误标成正式环境 |
| `README.md`、`docs/deployment.md`、`docs/deployment-nginx-docker.md` | 仍保留旧的 Nginx/rsync/backend-only 部署路径 | 应明确标记为 legacy，或统一迁移到现行生产部署事实（Caddy + release 目录 + GitHub Actions） | 文档层存在多套部署真相，难以判断哪套仍有效 |
| `docs/tencent-ads-attribution-spec.md` + 生产环境实际值 | 文档要求字段名为 `腾讯广告点击ID` / `腾讯广告点击ID来源字段`，但生产已核实 `FEISHU_FIELD_CLICK_ID=click_id`，`FEISHU_FIELD_CLICK_ID_SOURCE_KEY` 为空 | 应统一成一套真实字段映射规范 | 点击归因字段配置和文档可能长期脱节 |

## 仍待补齐的证据

以下事项在进入“收敛落地”前必须至少补齐一项：

1. 重新获得对 `112.124.103.65` 的有效 SSH 访问。
2. 查看最近一次 staging GitHub Actions 成功或失败日志，确认实际目录、容器和端口。
3. 通过服务器控制台或运维面板确认 staging 当前运行目录、代理类型和健康检查端口。

在补证完成前，本文档对 staging 的描述只能视为“仓库配置推断”，不能当成运行态事实。

## 下一阶段建议

完成本文件后，后续收敛工作应按以下顺序执行：

1. 先补 staging 实机证据：SSH、Actions 日志或控制台信息至少补齐一项。
2. 再修剩余文档：`README.md`、`docs/deploy-guide.md`、`docs/deployment.md`、`docs/deployment-nginx-docker.md`。
3. 最后统一飞书字段真实映射：确认 `click_id` 与中文列名到底哪套才是现行规范。
