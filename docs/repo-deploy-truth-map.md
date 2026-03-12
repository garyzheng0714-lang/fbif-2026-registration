# 仓库与部署真相地图

更新时间：2026-03-08（Asia/Shanghai）

本文档记录当前仓库、分支、服务器、飞书表、GitHub Actions 与部署的真实关系。

## 当前架构概述

- **单分支**：仅使用 `main` 分支，不再有 `staging` 分支。
- **单服务器**：所有环境部署在同一台服务器 `121.40.214.5`。
- **双端口**：通过不同端口区分 preview 和 production 环境。
- **旧测试服务器 `112.124.103.65` 已停用。**

## 1. 仓库映射表

| 对象 | 当前值 | 说明 |
| --- | --- | --- |
| 主仓库 | `https://github.com/garyzheng0714-lang/fbif-2026-registration.git` | 唯一 source of truth |
| 镜像仓库 | `git@github.com:garyzheng0714-lang/web-fbif-form.git` | 仅镜像/备份，不作为部署依据 |

## 2. 分支映射表

| 分支 | 语义 | 说明 |
| --- | --- | --- |
| `main` | 唯一开发与部署分支 | push 自动触发 preview 部署；手动 workflow_dispatch 触发生产部署 |

不再使用 `staging` 分支。所有开发和部署都通过 `main` 分支完成。

## 3. 服务器与环境映射表

| 环境 | 服务器 | Web 端口 | API 端口 | 触发方式 | 工作流文件 |
| --- | --- | --- | --- | --- | --- |
| Preview（预览） | `121.40.214.5` | 3003 | active slot `28080/28081`（经 `3101`） | push to `main` 自动触发 | `deploy-preview.yml` |
| Production（生产） | `121.40.214.5` | 3001 | 8080 | 手动 `workflow_dispatch` | `deploy-aliyun.yml` |

补充：

- 两个环境运行在同一台服务器上，通过不同的端口和 Docker 项目名隔离。
- Preview 环境用于验证代码变更，确认无误后手动触发生产部署。
- 生产域名：`https://fbif2026ticket.foodtalks.cn`

## 4. 飞书映射表

| 环境 | `FEISHU_TABLE_ID` | `FEISHU_SUBMISSION_SOURCE` | 说明 |
| --- | --- | --- | --- |
| Preview | `tbl0CQ74guMS1IDd` | `测试环境` | 与生产共用同一张表，通过来源字段区分 |
| Production | `tbl0CQ74guMS1IDd` | `正式环境` | 生产数据 |

区分生产/预览数据的关键字段是 `FEISHU_SUBMISSION_SOURCE`，而非 `FEISHU_TABLE_ID`。

## 5. 工作流映射表

| Workflow | 触发方式 | 目标端口 | 飞书来源值 | 说明 |
| --- | --- | --- | --- | --- |
| `deploy-preview.yml` | push to `main` | Web 3003 / API active slot `28080/28081`（经 3101） | `测试环境` | 自动部署预览环境 |
| `deploy-aliyun.yml` | 手动 `workflow_dispatch` | Web 3001 / API 8080 | `正式环境` | 手动触发生产部署 |

## 6. 部署流程

```text
开发者 push 到 main
    |
    v
deploy-preview.yml 自动运行
    |
    v
Preview 部署到 121.40.214.5:3003（API 经 3101 -> 28080/28081）
    |
    v
开发者验证 Preview 环境
    |
    v
手动触发 deploy-aliyun.yml (workflow_dispatch)
    |
    v
Production 部署到 121.40.214.5:3001/8080
```

## 一张图看懂

```text
fbif-2026-registration.git
└── main
    ├── deploy-preview.yml   (push 自动触发)
    │   └── 121.40.214.5:3003 -> 3101 -> 28080/28081  (preview)
    ├── deploy-aliyun.yml    (手动触发)
    │   └── 121.40.214.5:3001/8080  (production)
    └── feishu table: tbl0CQ74guMS1IDd
        ├── preview  → FEISHU_SUBMISSION_SOURCE=测试环境
        └── production → FEISHU_SUBMISSION_SOURCE=正式环境
```

## 相关文档

- 环境管理结构图：`docs/repo-environment-model.md`
- 部署指南：`docs/deploy-guide.md`
