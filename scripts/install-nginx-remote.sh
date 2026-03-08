#!/usr/bin/env bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

if ! command -v nginx >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y nginx
fi

STATIC_DIR_VALUE="${STATIC_DIR:-/var/www/fbif-form}"
API_PORT_VALUE="${API_PORT:-8080}"
PRIMARY_WEB_PORT_VALUE="${PRIMARY_WEB_PORT:-3001}"
NGINX_SITE_NAME_VALUE="${NGINX_SITE_NAME:-fbif-form}"
APP_DIR_VALUE="${APP_DIR:-/opt/web-fbif-form}"

mkdir -p "${STATIC_DIR_VALUE}" /etc/nginx/sites-available /etc/nginx/sites-enabled

CURRENT_DIST="${APP_DIR_VALUE}/current/apps/web/dist"
if [ -d "${CURRENT_DIST}" ] && [ -z "$(ls -A "${STATIC_DIR_VALUE}" 2>/dev/null || true)" ]; then
  cp -r "${CURRENT_DIST}/"* "${STATIC_DIR_VALUE}/" || true
fi

cat > "/etc/nginx/sites-available/${NGINX_SITE_NAME_VALUE}" <<SITE
server {
    listen ${PRIMARY_WEB_PORT_VALUE};
    listen [::]:${PRIMARY_WEB_PORT_VALUE};
    server_name _;

    root ${STATIC_DIR_VALUE};
    index index.html;

    location = /healthz {
        default_type text/plain;
        return 200 "ok\\n";
    }

    location /api/ {
        proxy_pass http://127.0.0.1:${API_PORT_VALUE};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_read_timeout 75s;
        proxy_send_timeout 75s;
        proxy_connect_timeout 5s;
        proxy_next_upstream error timeout http_502 http_503;
        proxy_next_upstream_timeout 30s;
        proxy_next_upstream_tries 3;
    }

    location /assets/ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    location / {
        try_files \$uri \$uri/ /index.html;
        add_header Cache-Control "no-store";
    }
}
SITE

ln -sfn "/etc/nginx/sites-available/${NGINX_SITE_NAME_VALUE}" "/etc/nginx/sites-enabled/${NGINX_SITE_NAME_VALUE}"
rm -f /etc/nginx/sites-enabled/default || true

nginx -t
systemctl enable nginx
systemctl restart nginx
systemctl is-active nginx

curl -fsS "http://127.0.0.1:${PRIMARY_WEB_PORT_VALUE}/healthz" >/dev/null
echo "NGINX_READY=1"
