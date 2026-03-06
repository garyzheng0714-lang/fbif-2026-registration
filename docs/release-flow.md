# Staging -> Main 发布流程

这份文档是当前 `web-fbif-form` 项目的推荐落地规则。目标只有一个：

`本地开发 -> staging -> 测试服务器 -> main -> 正式服务器`

不要再做人肉同步，不要在服务器上手动改代码，不要让测试和正式跑两套不同逻辑。

## 最终规则

1. `staging` 是唯一测试分支，只部署到测试服务器。
2. `main` 是唯一正式分支，只部署到正式服务器。
3. 两台服务器都只跑 GitHub Actions 部署出来的 release，不允许手动改代码。
4. 测试通过后，必须把 `staging` 合并到 `main`，由 `main` 触发正式部署。
5. 正式热修如果直接进了 `main`，必须同一天回灌到 `staging`，避免再次漂移。

## 环境映射

| 环境 | 分支 | 服务器目录 | 共享 env | 数据库 | 静态目录 |
|---|---|---|---|---|---|
| 测试 | `staging` | `/opt/web-fbif-form-staging` | `/opt/web-fbif-form-staging/shared/backend.env` | `fbif_form_staging` | `/var/www/fbif-form-staging` |
| 正式 | `main` | `/opt/web-fbif-form` | `/opt/web-fbif-form/shared/backend.env` | `fbif_form` | `/var/www/fbif-form` |

两边应该保持一致的内容：

- 发布方式：GitHub Actions 上传 release 包
- 目录结构：`releases/<sha>` + `current` 软链 + `shared/backend.env`
- 启动方式：`docker compose ... -f docker-compose.production.yml up -d --build`
- 健康检查：`/health`
- 数据迁移：`prisma migrate deploy`

两边允许不同的内容：

- 服务器地址
- 分支名
- `POSTGRES_DB`
- `API_PORT`
- `WEB_ORIGIN`
- `FEISHU_SUBMISSION_SOURCE`

## 正确流程

1. 本地开发完成后，提交到功能分支。
2. 功能分支合并到 `staging`。
3. `staging` 自动部署到测试服务器。
4. 测试服务器验证通过后，把 `staging` 合并到 `main`。
5. `main` 自动部署到正式服务器。

关键点：

- 正式环境只接受 `main` 的代码。
- 正式部署的代码必须来自已经在测试环境验证过的提交。
- 不能从测试服务器复制代码到正式服务器。
- 不能跳过 `staging` 直接用本地代码“补”正式环境。

## 部署链路要求

测试和正式可以有两个 workflow，但必须共用同一套部署逻辑。两者只能有参数差异，不能有行为差异。

应该不同的参数：

- 分支触发条件
- SSH 主机
- `APP_DIR`
- `STATIC_DIR`
- `POSTGRES_DB`
- `API_PORT`
- `WEB_ORIGIN`
- `FEISHU_SUBMISSION_SOURCE`

不应该不同的内容：

- release 打包方式
- 解压与切换 `current` 的方式
- `backend.env` 生成逻辑
- `docker compose` 启动方式
- 健康检查逻辑

## 必须加的护栏

1. 服务器禁止手动操作代码。
2. `main` 开启 branch protection，禁止直接 push。
3. `staging` 和 `main` 使用不同的 GitHub Environment / Secrets。
4. 页面或接口必须显示版本信息：
   - `env`
   - `branch`
   - `commit sha`
   - `deploy time`
5. 每次准备发版前，先跑一次只读检查：

```bash
SSH_HOST=root@<server> \
SSH_KEY_PATH=/path/to/private-key \
./scripts/report-deploy-drift.sh
```

## 当前项目最需要避免的事

1. 测试服务器和正式服务器跑不同 SHA。
2. GitHub `staging` 和测试服务器不同步。
3. 测试库 schema 落后正式库 schema。
4. 测试端 `backend.env` 缺字段，正式端有字段。
5. 两个 workflow 各自修补，最后部署逻辑漂移。

## 现在这套项目的判断标准

只要满足下面 4 条，这条发布线就是稳定的：

1. `staging` 只发测试，`main` 只发正式。
2. 测试和正式只差 env，不差部署逻辑。
3. 两台服务器都能明确看到当前 SHA。
4. 所有正式发布都能追溯到一个已经在测试通过的提交。
