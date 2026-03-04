# 腾讯广告归因与飞书表规范

本文件是腾讯广告归因字段、飞书多维表格字段、以及正式/测试环境配置的唯一规范文档。

## 部署拓扑

### 主仓库

- GitHub 仓库：<https://github.com/garyzheng0714-lang/fbif-2026-registration.git>
- `main` -> 生产服务器 `121.40.214.5`
- `staging` -> 测试服务器 `112.124.103.65`
- 生产访问域名：<https://fbif2026ticket.foodtalks.cn>

### 镜像仓库

- GitHub 仓库：<https://github.com/garyzheng0714-lang/web-fbif-form.git>
- 仅保留镜像/备份语义
- 不再承载独立产品语义
- 任何部署与配置判断都以主仓库为准

## 目标

提交成功时，系统需要把腾讯广告落地页参数里的点击标识一并保存到：

- PostgreSQL `Submission`
- 飞书多维表格

用于后续按点击标识匹配客户来源。

## 归因规则

系统从 URL 查询参数中按以下优先级提取点击标识：

1. `click_id`
2. `qz_gdt`
3. `gdt_vid`

归一化后保留两个字段：

- `clickId`
  - 命中的第一个非空值
- `clickIdSourceKey`
  - 命中的原始参数名
  - 只允许：`click_id`、`qz_gdt`、`gdt_vid`

示例：

| URL 参数 | clickId | clickIdSourceKey |
| --- | --- | --- |
| `?click_id=AAA` | `AAA` | `click_id` |
| `?qz_gdt=BBB` | `BBB` | `qz_gdt` |
| `?gdt_vid=CCC` | `CCC` | `gdt_vid` |
| `?click_id=AAA&qz_gdt=BBB` | `AAA` | `click_id` |
| 无参数 | 空 | 空 |

## 飞书多维表格字段

生产和测试环境使用同一张飞书表，字段必须保持以下规范：

- `腾讯广告点击ID`
- `腾讯广告点击ID来源字段`

推荐同时保留已有环境来源字段：

- `数据来源`

字段语义：

| 列名 | 用途 |
| --- | --- |
| `腾讯广告点击ID` | 保存归一化后的 `clickId` |
| `腾讯广告点击ID来源字段` | 保存命中的原始参数名 |
| `数据来源` | 标记 `正式环境` / `测试环境` |

## 环境配置

### 生产环境（main 分支）

当前固定写入：

- `FEISHU_APP_TOKEN=<YOUR_FEISHU_APP_TOKEN>`
- `FEISHU_TABLE_ID=tbl0CQ74guMS1IDd`

字段列名通过以下环境变量控制：

- `FEISHU_FIELD_CLICK_ID`
- `FEISHU_FIELD_CLICK_ID_SOURCE_KEY`
- `FEISHU_FIELD_SOURCE`

### 测试环境（staging 分支）

`staging` 分支部署后的数据当前也写入同一张表：

- Base: `<YOUR_FEISHU_APP_TOKEN>`
- Table: `tbl0CQ74guMS1IDd`
- URL: <https://foodtalks.feishu.cn/base/<YOUR_FEISHU_APP_TOKEN>?table=tbl0CQ74guMS1IDd>

测试环境写入值要求：

- `FEISHU_SUBMISSION_SOURCE=测试环境`

说明：

- 当前不再要求“生产表”和“测试表”分离。
- 生产与测试通过 `FEISHU_SUBMISSION_SOURCE` 区分来源。
- 如果未来恢复为两张表，必须同步修改 workflow、文档和环境变量。

## 部署要求

### staging

- `staging` GitHub Actions 工作流固定写入共享表：
  - `FEISHU_APP_TOKEN=<YOUR_FEISHU_APP_TOKEN>`
  - `FEISHU_TABLE_ID=tbl0CQ74guMS1IDd`
  - `FEISHU_SUBMISSION_SOURCE=测试环境`

### production

- `main` GitHub Actions 工作流写入同一张表
- 如果继续从 Secrets 读取配置，其结果必须仍为：
  - `FEISHU_APP_TOKEN=<YOUR_FEISHU_APP_TOKEN>`
  - `FEISHU_TABLE_ID=tbl0CQ74guMS1IDd`
  - `FEISHU_SUBMISSION_SOURCE=正式环境`

## 变更要求

以后如果新增、删除、重命名以下任一字段：

- `腾讯广告点击ID`
- `腾讯广告点击ID来源字段`
- `数据来源`

必须同时更新：

1. 当前共享的飞书多维表格
2. 本文档
3. 对应环境变量配置

如果未来再次拆成测试专用表，还必须同时更新：

1. `.github/workflows/deploy-staging.yml`
2. `docs/repo-environment-model.md`
3. `docs/repo-deploy-truth-map.md`

## 相关环境变量

后端归因相关环境变量：

- `FEISHU_APP_TOKEN`
- `FEISHU_TABLE_ID`
- `FEISHU_FIELD_CLICK_ID`
- `FEISHU_FIELD_CLICK_ID_SOURCE_KEY`
- `FEISHU_FIELD_SOURCE`
- `FEISHU_SUBMISSION_SOURCE`

## 相关代码位置

- 前端提取与提交：`apps/web/src/App.tsx`
- 提交入库校验：`apps/api/src/validation/submission.ts`
- 持久化：`apps/api/src/services/submissionService.ts`
- 飞书字段映射：`apps/api/src/services/feishuService.ts`
- 测试环境部署：`.github/workflows/deploy-staging.yml`
- 生产环境部署：`.github/workflows/deploy-aliyun.yml`
