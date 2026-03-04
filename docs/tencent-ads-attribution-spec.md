# 腾讯广告归因与飞书表规范

本文件是腾讯广告归因字段、飞书多维表格字段、以及正式/测试环境表配置的唯一规范文档。

## 部署拓扑

### 备用端仓库

- GitHub 仓库：<https://github.com/garyzheng0714-lang/web-fbif-form.git>
- 部署服务器：`112.124.103.65`
- 自动部署

分支与用途：

- `staging`
  - 用于检查每一次改动
  - 提交数据必须写入测试飞书表
- `main`
  - 备用端主分支
  - 随时可能替换正式端主分支
  - 需要尽量与正式端字段规范保持一致
  - 外部访问域名：<http://fbif2026ticket2.foodtalks.cn>

### 正式端仓库

- GitHub 仓库：<https://github.com/garyzheng0714-lang/fbif-2026-registration.git>
- 部署服务器：`121.40.214.5`
- 仅 `main` 分支
- 外部访问域名：<http://fbif2026ticket.foodtalks.cn>

说明：

- 本仓库只负责备用端代码与自动部署配置
- 正式端仓库需要与本文档中的字段规范保持一致

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

正式和测试环境的多维表格必须保持以下字段一致：

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

### 生产环境

生产环境继续通过环境变量控制目标表：

- `FEISHU_APP_TOKEN`
- `FEISHU_TABLE_ID`

字段列名通过以下环境变量控制：

- `FEISHU_FIELD_CLICK_ID`
- `FEISHU_FIELD_CLICK_ID_SOURCE_KEY`
- `FEISHU_FIELD_SOURCE`

### 测试环境（staging 分支）

`staging` 分支部署后的数据必须落到以下测试表：

- Base: `<YOUR_FEISHU_APP_TOKEN>`
- Table: `tblwMPbX5WBSoP6y`
- URL: <https://foodtalks.feishu.cn/base/<YOUR_FEISHU_APP_TOKEN>?table=tblwMPbX5WBSoP6y&view=vewlonPheh>

测试环境写入值要求：

- `FEISHU_SUBMISSION_SOURCE=测试环境`

### 备用端 main 分支

- 备用端 `main` 分支保持自动部署
- 它不是测试分支，不使用上述 staging 测试表
- 其飞书表配置应与正式端保持同一套字段规范
- 如果备用端 `main` 和正式端 `main` 指向不同表，这两个表也必须保持字段完全一致

## 部署要求

### staging

- `staging` GitHub Actions 工作流固定写入测试表：
  - `FEISHU_APP_TOKEN=<YOUR_FEISHU_APP_TOKEN>`
  - `FEISHU_TABLE_ID=tblwMPbX5WBSoP6y`

### production

- `main` GitHub Actions 工作流继续从 Secrets 读取生产表配置

## 变更要求

以后如果新增、删除、重命名以下任一字段：

- `腾讯广告点击ID`
- `腾讯广告点击ID来源字段`
- `数据来源`

必须同时更新：

1. 正式环境多维表格
2. 测试环境多维表格
3. 本文档
4. 对应环境变量配置

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
