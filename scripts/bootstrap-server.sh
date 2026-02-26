#!/usr/bin/env bash
# bootstrap-server.sh — 在全新 Linux 服务器上安装 FBIF Form 所需的运行环境
# 用法: ssh root@new-server 'bash -s' < scripts/bootstrap-server.sh
#   或: curl -fsSL <raw-url>/scripts/bootstrap-server.sh | bash
set -euo pipefail

echo "=== FBIF Form 服务器初始化 ==="

# ---------- 1. 安装 Docker ----------
if command -v docker &>/dev/null; then
  echo "[OK] Docker 已安装: $(docker --version)"
else
  echo "[安装] Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
  echo "[OK] Docker 安装完成: $(docker --version)"
fi

# ---------- 2. 验证 Docker Compose v2 ----------
if docker compose version &>/dev/null; then
  echo "[OK] Docker Compose v2: $(docker compose version --short)"
else
  echo "[错误] Docker Compose v2 未找到，请升级 Docker" >&2
  exit 1
fi

# ---------- 3. 安装 Caddy (HTTPS 反向代理) ----------
if command -v caddy &>/dev/null; then
  echo "[OK] Caddy 已安装: $(caddy version)"
else
  echo "[安装] Caddy..."
  apt-get update -qq
  apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  apt-get update -qq
  apt-get install -y -qq caddy
  echo "[OK] Caddy 安装完成: $(caddy version)"
fi

# ---------- 4. 创建应用目录 ----------
APP_DIR="${APP_DIR:-/opt/web-fbif-form}"
mkdir -p "${APP_DIR}/shared" "${APP_DIR}/releases"

echo "[OK] 应用目录: ${APP_DIR}"

# ---------- 5. 创建环境变量文件占位 ----------
if [ ! -f "${APP_DIR}/shared/backend.env" ]; then
  cat > "${APP_DIR}/shared/backend.env" <<'ENVEOF'
# FBIF Form 后端环境变量
# 请参考 backend.env.example 填写以下必填项:
#   DATA_KEY=<32字节base64>
#   DATA_HASH_SALT=<随机字符串>
#   FEISHU_APP_SECRET=<飞书应用密钥>
#   FEISHU_APP_TOKEN=<飞书多维表格 token>
ENVEOF
  chmod 600 "${APP_DIR}/shared/backend.env"
  echo "[注意] 请编辑 ${APP_DIR}/shared/backend.env 填写密钥"
else
  echo "[OK] backend.env 已存在"
fi

# ---------- 6. 安装常用工具 ----------
for cmd in curl git; do
  if ! command -v "${cmd}" &>/dev/null; then
    echo "[安装] ${cmd}..."
    apt-get install -y -qq "${cmd}"
  fi
done

echo ""
echo "=== 初始化完成 ==="
echo ""
echo "后续步骤:"
echo "  1. 编辑 ${APP_DIR}/shared/backend.env 填写密钥"
echo "  2. 配置 Caddy: echo 'your-domain.com { reverse_proxy localhost:3001 }' > /etc/caddy/Caddyfile && systemctl restart caddy"
echo "  3. 更新 GitHub Secrets: ALIYUN_HOST, ALIYUN_SSH_KEY"
echo "  4. 推送代码到 main/staging 分支触发自动部署"
