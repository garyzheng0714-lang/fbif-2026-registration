# 发布流程

本文档描述 `web-fbif-form` 项目的发布规则。核心模型：

**单分支 (main) + 单服务器 (121.40.214.5) + 双端口隔离**

## 环境映射

| 环境 | 触发方式 | 服务器 | Web 端口 | API 端口 | 服务器目录 |
|------|---------|--------|---------|---------|-----------|
| 预览 | push 到 `main` 自动触发 | 121.40.214.5 | 3003 | active slot `28080/28081`（经 `3101`） | `/opt/web-fbif-form-staging` |
| 生产 | 手动 workflow_dispatch | 121.40.214.5 | 3001 | 8080 | `/opt/web-fbif-form` |

两个环境共用同一台服务器，通过不同端口和目录隔离。

## 发布流程

```
功能分支开发
    |
    v
创建 PR -> main
    |
    v
合并到 main -> 自动部署预览环境 (121.40.214.5:3003)
    |
    v
用户在预览环境确认
    |
    v
手动触发 workflow_dispatch -> 部署生产环境 (121.40.214.5:3001)
```

### 具体步骤

1. 从 `main` 创建功能分支（`feat/xxx` 或 `fix/xxx`）。
2. 开发完成后提交 PR 到 `main`。
3. PR 合并后，`deploy-preview.yml` 自动部署到预览环境。
4. 将预览链接 `http://121.40.214.5:3003` 发给相关人员确认。
5. 确认无误后，在 GitHub Actions 手动触发 `deploy-aliyun.yml` 部署生产。
6. 检查生产环境 `https://fbif2026ticket.foodtalks.cn`。

## 规则

1. **`main` 是唯一分支**，所有改动通过 PR 合并。
2. **预览先行** -- 每次合并到 `main` 自动部署预览，必须确认后才手动发布生产。
3. **禁止直接 push 到 `main`** -- 开启 branch protection。
4. **服务器禁止手动改代码** -- 只接受 GitHub Actions 部署的 release。
5. **端口隔离门禁必须通过** -- 生产发布前必须确认 staging 不占用 `8080/18080`，且生产域名 API 上游固定为 `localhost:3001`。

## 两个环境的差异

仅以下参数不同，部署逻辑完全一致：

| 参数 | 预览 | 生产 |
|------|------|------|
| `APP_DIR` | `/opt/web-fbif-form-staging` | `/opt/web-fbif-form` |
| `COMPOSE_PROJECT_NAME` | `fbif-form-staging` | `fbif-form` |
| `POSTGRES_DB` | `fbif_form_staging` | `fbif_form` |
| `API_SLOT_PORTS` | `28080/28081`（经 `3101`） | `8080/18080`（经 `3001`） |
| `WEB_PORT` | `3003` | `3001` |
| `FEISHU_SUBMISSION_SOURCE` | `测试环境` | `正式环境` |

## 发布后检查

- 预览前端：`http://121.40.214.5:3003`
- 预览后端健康：`http://121.40.214.5:3003/health`（外部）或 `http://127.0.0.1:3101/healthz`（服务器内）
- 生产前端：`https://fbif2026ticket.foodtalks.cn`
- 生产后端健康：`http://127.0.0.1:8080/health`（服务器内）
- GitHub Actions 日志：仓库 `Actions` 页面查看对应 workflow
- 端口隔离检查：参考 `docs/production-port-isolation-runbook.md`

## 判断标准

满足以下条件，发布流程即为健康：

1. 所有改动通过 PR 合并到 `main`，不直接 push。
2. 预览和生产只差环境参数，不差部署逻辑。
3. 两个环境都能明确看到当前运行的 commit SHA。
4. 所有生产发布都经过预览环境验证。
