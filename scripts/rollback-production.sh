#!/usr/bin/env bash
set -euo pipefail

HOST="${ALIYUN_HOST:-121.40.214.5}"
USER="${ALIYUN_USER:-root}"
KEY_PATH="${ALIYUN_KEY_PATH:-${HOME}/.ssh/id_aliyun}"
APP_DIR="${APP_DIR:-/opt/web-fbif-form}"
STATIC_DIR="${STATIC_DIR:-/var/www/fbif-form}"
API_PORT="${API_PORT:-8080}"
PRIMARY_WEB_PORT="${PRIMARY_WEB_PORT:-3001}"
NGINX_SITE_NAME="${NGINX_SITE_NAME:-fbif-form}"

if [ ! -f "${KEY_PATH}" ]; then
  echo "Missing SSH private key: ${KEY_PATH}" >&2
  exit 1
fi

REMOTE_ENV="$(printf \
  'APP_DIR=%q STATIC_DIR=%q API_PORT=%q PRIMARY_WEB_PORT=%q NGINX_SITE_NAME=%q COMPOSE_PROJECT_NAME=%q' \
  "${APP_DIR}" "${STATIC_DIR}" "${API_PORT}" "${PRIMARY_WEB_PORT}" "${NGINX_SITE_NAME}" "fbif-form")"

ssh \
  -i "${KEY_PATH}" \
  -o BatchMode=yes \
  -o ConnectTimeout=20 \
  -o StrictHostKeyChecking=accept-new \
  "${USER}@${HOST}" \
  "${REMOTE_ENV} bash -s -- rollback" < "$(cd "$(dirname "$0")" && pwd)/remote-deploy.sh"
