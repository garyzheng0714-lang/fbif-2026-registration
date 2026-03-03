# FBIF 2026 观众注册系统 — 部署指南

## 前置条件

- Ubuntu Linux 服务器（2 核 2GB 以上），开放 80/443/22 端口
- 域名已解析到服务器公网 IP
- 服务器能 SSH 登录

## 第一步：初始化服务器

```bash
# SSH 登录后执行（自动安装 Docker + Caddy + 创建目录）
curl -fsSL https://raw.githubusercontent.com/garyzheng0714-lang/web-fbif-form/main/scripts/bootstrap-server.sh | bash
```

## 第二步：写入环境变量

将以下内容写入 `/opt/web-fbif-form/shared/backend.env`。

只需要改 3 处（标注了 `⬅ 改这里`）：

```bash
cat > /opt/web-fbif-form/shared/backend.env << 'EOF'
# ====== 需要修改的（共 3 处）======
WEB_ORIGIN=https://改成你的域名                        # ⬅ 改这里
POSTGRES_PASSWORD=改成一个强密码                         # ⬅ 改这里
FEISHU_SUBMISSION_SOURCE=正式环境                       # ⬅ 如需区分环境改这里

# ====== 以下全部照抄，不用改 ======

# 加密（自动生成）
# DATA_KEY=<自动生成>
# DATA_HASH_SALT=<自动生成>

# 数据库
POSTGRES_USER=fbif
POSTGRES_DB=fbif_form

# 飞书
FEISHU_APP_ID=cli_a9f7f8703778dcee
FEISHU_APP_SECRET=<从飞书开放平台获取>
FEISHU_APP_TOKEN=<从飞书开放平台获取>
FEISHU_TABLE_ID=<从飞书多维表格 URL 获取>
FEISHU_FIELD_NAME=姓名
FEISHU_FIELD_PHONE=手机号（问卷题）
FEISHU_FIELD_TITLE=职位
FEISHU_FIELD_COMPANY=公司
FEISHU_FIELD_ID=证件号码
FEISHU_FIELD_IDENTITY=观展身份
FEISHU_FIELD_ID_TYPE=证件类型
FEISHU_FIELD_BUSINESS_TYPE=贵司的业务类型
FEISHU_FIELD_DEPARTMENT=您所处的部门（问卷题）
FEISHU_FIELD_PROOF_URL=专业观众证明（附件链接）
FEISHU_SELECT_WRITE_MODE=label

# 阿里云 OSS
OSS_ACCESS_KEY_ID=<从阿里云 RAM 控制台获取>
OSS_ACCESS_KEY_SECRET=<从阿里云 RAM 控制台获取>
OSS_BUCKET=fbif-2026-registration
OSS_REGION=cn-shanghai
OSS_UPLOAD_PREFIX=fbif-form/proof
OSS_MAX_UPLOAD_MB=50
OSS_POLICY_EXPIRE_SECONDS=600
OSS_OBJECT_ACL=public-read

# 身份证验证（可选）
ID_VERIFY_ENABLED=false
ID_VERIFY_APPCODE=<从阿里云云市场获取>
ID_VERIFY_ALIYUN_HOST=https://sxidcheck.market.alicloudapi.com
ID_VERIFY_ALIYUN_PATH=/idcard/check
ID_VERIFY_TIMEOUT_MS=5000
ID_VERIFY_TOKEN_TTL_SECONDS=900

# 其他
CSRF_COOKIE_SECURE=true
API_PORT=8080
API_PORT_INTERNAL=8080
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=200
RATE_LIMIT_BURST=50
SYNC_POLL_TIMEOUT_MS=30000
FEISHU_SYNC_ATTEMPTS=8
FEISHU_SYNC_BACKOFF_MS=1000
FEISHU_SYNC_BACKOFF_MAX_MS=120000
FEISHU_WORKER_CONCURRENCY=5
FEISHU_WORKER_QPS=5
MAX_PROOF_URLS=5
MAX_PROOF_URL_LENGTH=2048
RUN_DB_MIGRATE=true
RUN_WORKER=true
EOF

chmod 600 /opt/web-fbif-form/shared/backend.env
```

## 第三步：配置 HTTPS

把 `你的域名` 换成实际域名：

```bash
cat > /etc/caddy/Caddyfile << 'EOF'
你的域名 {
    reverse_proxy localhost:3001
}
EOF

systemctl restart caddy
```

## 第四步：配置 OSS 跨域

登录阿里云 OSS 控制台 → Bucket `fbif-2026-registration` → 权限管理 → 跨域设置，添加规则：

| 项 | 值 |
|---|---|
| 来源 | `https://你的域名` |
| 允许方法 | POST, GET, PUT, HEAD |
| 允许头 | `*` |
| 缓存时间 | 3600 |

## 第五步：部署代码

**方式 A：手动部署（推荐先用这个验证）**

```bash
# 1. 安装 Node.js 20（如果没有）
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs

# 2. 克隆代码
cd /opt/web-fbif-form
git clone https://github.com/garyzheng0714-lang/web-fbif-form.git current
cd current

# 3. 构建前端
npm ci --prefix apps/web && npm run build --prefix apps/web

# 4. 部署前端静态文件
mkdir -p /var/www/fbif-form && cp -r apps/web/dist/* /var/www/fbif-form/

# 5. 启动后端（Docker 自动拉起 API + 数据库 + Redis）
set -a && source /opt/web-fbif-form/shared/backend.env && set +a
docker compose --env-file /opt/web-fbif-form/shared/backend.env -f docker-compose.production.yml up -d --build

# 6. 等 30 秒后验证
curl http://localhost:8080/health
# 返回 {"ok":true} 就成功了
```

**方式 B：GitHub Actions 自动部署**

在 GitHub 仓库 Settings → Secrets 添加这 3 个即可（其余配置已在 backend.env 里）：

| Secret | 值 |
|---|---|
| `ALIYUN_HOST` | 服务器公网 IP |
| `ALIYUN_SSH_KEY` | SSH 私钥内容（见下方生成方法） |
| `ALIYUN_USER` | `root` |

```bash
# 生成部署密钥
ssh-keygen -t ed25519 -f fbif-deploy-key -N ""
ssh-copy-id -i fbif-deploy-key.pub root@服务器 IP
cat fbif-deploy-key  # 复制内容到 GitHub Secret
```

之后每次 `git push origin main` 自动部署。

## 验证

访问 `https://你的域名`，选择身份 → 填写表单 → 提交，检查飞书多维表格是否收到数据。

## 常用命令

```bash
docker ps                                          # 查看服务状态
docker logs fbif-form-api-1 --tail 100             # 查看日志
docker logs fbif-form-api-1 2>&1 | grep -i error   # 查看错误
docker compose --env-file /opt/web-fbif-form/shared/backend.env -f docker-compose.production.yml restart  # 重启
```
