# 仓库与环境管理结构图

更新时间：2026-03-05（Asia/Shanghai）

这份文档只回答 6 个问题，用于给新接手的人快速建立统一认知。

## 1. 主仓库是哪一个

- 唯一主仓库：`fbif-2026-registration.git`
- 日常开发、提交、分支保护、GitHub Actions、文档说明都以它为准。

## 2. 备份仓库还保不保留

- 可以保留：`web-fbif-form.git`
- 但它只能是镜像/备份仓库，不能再当独立开发源头。
- 任何“哪个仓库代表真实生产状态”的判断，都只看主仓库。

## 3. `main` 对应什么

- `main` = 生产分支
- 只允许部署到生产服务器：`121.40.214.5`
- 当前写入共享飞书表：`tbl0CQ74guMS1IDd`
- 必须写入来源值：`正式环境`

## 4. `staging` 对应什么

- `staging` = 测试分支
- 只允许部署到测试服务器：`112.124.103.65`
- 当前也写入共享飞书表：`tbl0CQ74guMS1IDd`
- 必须写入来源值：`测试环境`

## 5. 两台服务器各自做什么

| 环境 | 服务器 | 目录 | 用途 |
| --- | --- | --- | --- |
| 生产 | `121.40.214.5` | `/opt/web-fbif-form` | 对外正式服务 |
| 测试 | `112.124.103.65` | `/opt/web-fbif-form-staging` | 测试验证、预发布检查 |

补充：

- 两台服务器分开是对的。
- 服务器分开不等于仓库也要分开。
- 当前模型应该是“一个仓库管理两个环境”，不是“两个仓库各管一个环境”。

## 6. 飞书表现在怎么对应

| 环境 | Base/App Token | Table ID | 写入来源值 |
| --- | --- | --- | --- |
| 生产 | `<YOUR_FEISHU_APP_TOKEN>` | `tbl0CQ74guMS1IDd` | `正式环境` |
| 测试 | `<YOUR_FEISHU_APP_TOKEN>` | `tbl0CQ74guMS1IDd` | `测试环境` |

结论：

- 当前不是“两张表”，而是“同一张表，两个来源值”。
- 区分生产/测试的关键字段是 `FEISHU_SUBMISSION_SOURCE`，不是 `FEISHU_TABLE_ID`。

## 一张图看懂

```text
fbif-2026-registration.git
├── main
│   ├── deploy-aliyun.yml
│   ├── server: 121.40.214.5
│   └── feishu table: tbl0CQ74guMS1IDd
└── staging
    ├── deploy-staging.yml
    ├── server: 112.124.103.65
    └── feishu table: tbl0CQ74guMS1IDd

web-fbif-form.git
└── mirror / backup only
```

## 冻结规则

- 只保留一个主仓库：`fbif-2026-registration.git`
- `main` 只对应生产，`staging` 只对应测试
- 两台服务器继续分开，但不再引申为两个产品仓库
- `web-fbif-form.git` 不再承载独立产品语义
- 生产和测试当前共用同一张飞书表，但必须通过 `FEISHU_SUBMISSION_SOURCE` 区分来源

## 相关文档

- 详细真相地图：`docs/repo-deploy-truth-map.md`
