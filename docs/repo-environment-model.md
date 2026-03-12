# 仓库与环境管理结构图

更新时间：2026-03-08（Asia/Shanghai）

这份文档只回答 6 个问题，用于给新接手的人快速建立统一认知。

## 1. 主仓库是哪一个

- 唯一主仓库：`fbif-2026-registration.git`
- 日常开发、提交、分支保护、GitHub Actions、文档说明都以它为准。

## 2. 备份仓库还保不保留

- 可以保留：`web-fbif-form.git`
- 但它只能是镜像/备份仓库，不能再当独立开发源头。
- 任何"哪个仓库代表真实生产状态"的判断，都只看主仓库。

## 3. 只有一个分支：`main`

- `main` = 唯一开发与部署分支
- 不再使用 `staging` 分支
- push 到 `main` 自动触发 preview 部署
- 手动 `workflow_dispatch` 触发生产部署

## 4. 单服务器双端口模型

所有环境部署在同一台服务器 `121.40.214.5` 上，通过端口区分：

| 环境 | Web 端口 | API 端口 | 触发方式 | 用途 |
| --- | --- | --- | --- | --- |
| Preview（预览） | 3003 | active slot `28080/28081`（经 `3101`） | push to `main` 自动 | 验证代码变更 |
| Production（生产） | 3001 | 8080 | 手动 `workflow_dispatch` | 对外正式服务 |

补充：

- 两个环境在同一台服务器上通过不同的 Docker 项目名和端口隔离。
- 旧测试服务器 `112.124.103.65` 已停用。
- 生产域名：`https://fbif2026ticket.foodtalks.cn`

## 5. 工作流对应关系

| 工作流文件 | 触发方式 | 目标环境 |
| --- | --- | --- |
| `deploy-preview.yml` | push to `main` | Preview（预览） |
| `deploy-aliyun.yml` | 手动 `workflow_dispatch` | Production（生产） |

## 6. 飞书表现在怎么对应

| 环境 | Table ID | 写入来源值 |
| --- | --- | --- |
| Preview | `tbl0CQ74guMS1IDd` | `测试环境` |
| Production | `tbl0CQ74guMS1IDd` | `正式环境` |

结论：

- 当前不是"两张表"，而是"同一张表，两个来源值"。
- 区分生产/预览数据的关键字段是 `FEISHU_SUBMISSION_SOURCE`，不是 `FEISHU_TABLE_ID`。

## 一张图看懂

```text
fbif-2026-registration.git
└── main (唯一分支)
    ├── push 自动触发 → deploy-preview.yml
    │   └── 121.40.214.5:3003 -> 3101 -> 28080/28081  (preview)
    │       └── FEISHU_SUBMISSION_SOURCE=测试环境
    └── 手动触发 → deploy-aliyun.yml
        └── 121.40.214.5:3001/8080  (production)
            └── FEISHU_SUBMISSION_SOURCE=正式环境

web-fbif-form.git
└── mirror / backup only
```

## 冻结规则

- 只保留一个主仓库：`fbif-2026-registration.git`
- 只有一个分支 `main`，同时服务 preview 和 production
- 单服务器 `121.40.214.5`，双端口隔离环境
- `web-fbif-form.git` 不再承载独立产品语义
- 生产和预览共用同一张飞书表，通过 `FEISHU_SUBMISSION_SOURCE` 区分来源

## 相关文档

- 详细真相地图：`docs/repo-deploy-truth-map.md`
- 部署指南：`docs/deploy-guide.md`
