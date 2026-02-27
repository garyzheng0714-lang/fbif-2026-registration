#!/usr/bin/env bash
# update-backend-env.sh — 管理 backend.env 的创建与更新
# 用法: source scripts/update-backend-env.sh
#   或: . scripts/update-backend-env.sh
#
# 依赖环境变量:
#   BACKEND_ENV_FILE - backend.env 文件路径
#   BACKEND_ENV_TMP  - 临时文件路径 (默认 ${BACKEND_ENV_FILE}.tmp)
#
# 提供的函数:
#   init_env_file         - 初始化临时文件
#   upsert_env KEY VALUE  - 写入或覆盖某个键
#   set_if_non_empty KEY VALUE - 仅在 VALUE 非空时写入
#   set_default KEY VALUE - 仅在键不存在时写入
#   get_env_value KEY     - 读取键值
#   finalize_env_file     - 将临时文件写回正式文件并校验必填项

set -euo pipefail

BACKEND_ENV_TMP="${BACKEND_ENV_TMP:-${BACKEND_ENV_FILE}.tmp}"

init_env_file() {
  if [ -f "${BACKEND_ENV_FILE}" ]; then
    cp "${BACKEND_ENV_FILE}" "${BACKEND_ENV_TMP}"
  else
    : > "${BACKEND_ENV_TMP}"
  fi
}

upsert_env() {
  local key="$1"
  local value="$2"
  grep -v "^${key}=" "${BACKEND_ENV_TMP}" > "${BACKEND_ENV_TMP}.next" || true
  printf '%s=%s\n' "${key}" "${value}" >> "${BACKEND_ENV_TMP}.next"
  mv "${BACKEND_ENV_TMP}.next" "${BACKEND_ENV_TMP}"
}

set_if_non_empty() {
  local key="$1"
  local value="${2:-}"
  if [ -n "${value}" ]; then
    upsert_env "${key}" "${value}"
  fi
}

set_default() {
  local key="$1"
  local value="$2"
  if ! grep -q "^${key}=" "${BACKEND_ENV_TMP}"; then
    upsert_env "${key}" "${value}"
  fi
}

get_env_value() {
  local key="$1"
  local line
  line="$(grep "^${key}=" "${BACKEND_ENV_TMP}" | tail -n 1 || true)"
  printf '%s' "${line#*=}"
}

finalize_env_file() {
  local missing=0
  for key in DATA_KEY DATA_HASH_SALT FEISHU_APP_SECRET FEISHU_APP_TOKEN; do
    if [ -z "$(get_env_value "${key}")" ]; then
      echo "Missing required backend env: ${key}" >&2
      missing=1
    fi
  done
  if [ "${missing}" -ne 0 ]; then
    return 1
  fi

  mv "${BACKEND_ENV_TMP}" "${BACKEND_ENV_FILE}"
  chmod 600 "${BACKEND_ENV_FILE}"
}

# --- 一次性迁移：修正错误的默认值 ---
migrate_env() {
  # FEISHU_FIELD_NAME 实际表字段是 "姓名"，不是 "姓名（问卷题）"
  if [ "$(get_env_value FEISHU_FIELD_NAME)" = "姓名（问卷题）" ]; then
    upsert_env FEISHU_FIELD_NAME "姓名"
  fi
}

# --- 设置所有默认值 ---
apply_defaults() {
  local web_port_value="${WEB_PORT:-3001}"
  local web_origin_value="${WEB_ORIGIN:-}"
  local api_port_value="${API_PORT:-8080}"
  local api_port_internal_value="${API_PORT_INTERNAL:-8080}"

  set_default WEB_PORT "${web_port_value}"
  set_default NODE_ENV production
  set_default API_PORT "${api_port_value}"
  set_default API_PORT_INTERNAL "${api_port_internal_value}"
  set_default WEB_ORIGIN "${web_origin_value}"
  set_default CSRF_COOKIE_SECURE false
  set_default POSTGRES_USER fbif
  set_default POSTGRES_PASSWORD change_me
  set_default POSTGRES_DB "${POSTGRES_DB:-fbif_form}"
  set_default FEISHU_APP_ID cli_a9f7f8703778dcee
  set_default FEISHU_TABLE_ID tbl0CQ74guMS1IDd
  set_default FEISHU_FIELD_NAME "姓名"
  set_default FEISHU_FIELD_PHONE "手机号（问卷题）"
  set_default FEISHU_FIELD_TITLE "职位（问卷题）"
  set_default FEISHU_FIELD_COMPANY "公司（问卷题）"
  set_default FEISHU_FIELD_ID "证件号码（问卷题）"
  set_default FEISHU_FIELD_BUSINESS_TYPE "贵司的业务类型"
  set_default FEISHU_FIELD_DEPARTMENT "您所处的部门（问卷题）"
  set_default FEISHU_FIELD_PROOF_URL "专业观众证明（附件链接）"
  set_default FEISHU_FIELD_SUBMITTED_AT ""
  set_default FEISHU_FIELD_SYNC_STATUS ""
  set_default FEISHU_FIELD_SOURCE ""
  set_default FEISHU_SUBMISSION_SOURCE "${FEISHU_SUBMISSION_SOURCE:-正式环境}"
  set_default RATE_LIMIT_WINDOW_MS 60000
  set_default RATE_LIMIT_MAX 120
  set_default RATE_LIMIT_BURST 20
  set_default SYNC_POLL_TIMEOUT_MS 30000
  set_default FEISHU_SYNC_ATTEMPTS 8
  set_default FEISHU_SYNC_BACKOFF_MS 1000
  set_default FEISHU_SYNC_BACKOFF_MAX_MS 120000
  set_default FEISHU_WORKER_CONCURRENCY 10
  set_default FEISHU_WORKER_QPS 10
  set_default FEISHU_SELECT_WRITE_MODE label
  set_default MAX_PROOF_URLS 5
  set_default MAX_PROOF_URL_LENGTH 2048
  set_default ID_VERIFY_ENABLED false
  set_default ID_VERIFY_ALIYUN_HOST "https://sxidcheck.market.alicloudapi.com"
  set_default ID_VERIFY_ALIYUN_PATH "/idcard/check"
  set_default ID_VERIFY_TIMEOUT_MS 5000
  set_default ID_VERIFY_TOKEN_TTL_SECONDS 900
  set_default RUN_DB_MIGRATE true
  set_default RUN_WORKER true
}

# --- 从环境变量覆盖 (GitHub Secrets → backend.env) ---
apply_overrides() {
  set_if_non_empty WEB_PORT "${WEB_PORT:-}"
  set_if_non_empty WEB_ORIGIN "${WEB_ORIGIN:-}"
  set_if_non_empty API_PORT "${API_PORT:-}"
  set_if_non_empty API_PORT_INTERNAL "${API_PORT_INTERNAL:-}"
  set_if_non_empty CSRF_COOKIE_SECURE "${CSRF_COOKIE_SECURE:-}"
  set_if_non_empty POSTGRES_USER "${POSTGRES_USER:-}"
  set_if_non_empty POSTGRES_PASSWORD "${POSTGRES_PASSWORD:-}"
  set_if_non_empty POSTGRES_DB "${POSTGRES_DB:-}"
  set_if_non_empty DATA_KEY "${DATA_KEY:-}"
  set_if_non_empty DATA_HASH_SALT "${DATA_HASH_SALT:-}"
  set_if_non_empty FEISHU_APP_ID "${FEISHU_APP_ID:-}"
  set_if_non_empty FEISHU_APP_SECRET "${FEISHU_APP_SECRET:-}"
  set_if_non_empty FEISHU_APP_TOKEN "${FEISHU_APP_TOKEN:-}"
  set_if_non_empty FEISHU_TABLE_ID "${FEISHU_TABLE_ID:-}"
  set_if_non_empty OSS_ACCESS_KEY_ID "${OSS_ACCESS_KEY_ID:-}"
  set_if_non_empty OSS_ACCESS_KEY_SECRET "${OSS_ACCESS_KEY_SECRET:-}"
  set_if_non_empty OSS_BUCKET "${OSS_BUCKET:-}"
  set_if_non_empty OSS_REGION "${OSS_REGION:-}"
  set_if_non_empty OSS_HOST "${OSS_HOST:-}"
  set_if_non_empty OSS_PUBLIC_BASE_URL "${OSS_PUBLIC_BASE_URL:-}"
  set_if_non_empty OSS_UPLOAD_PREFIX "${OSS_UPLOAD_PREFIX:-}"
  set_if_non_empty OSS_MAX_UPLOAD_MB "${OSS_MAX_UPLOAD_MB:-}"
  set_if_non_empty OSS_POLICY_EXPIRE_SECONDS "${OSS_POLICY_EXPIRE_SECONDS:-}"
  set_if_non_empty OSS_OBJECT_ACL "${OSS_OBJECT_ACL:-}"
  set_if_non_empty ID_VERIFY_ENABLED "${ID_VERIFY_ENABLED:-}"
  set_if_non_empty ID_VERIFY_ALIYUN_HOST "${ID_VERIFY_ALIYUN_HOST:-}"
  set_if_non_empty ID_VERIFY_ALIYUN_PATH "${ID_VERIFY_ALIYUN_PATH:-}"
  set_if_non_empty ID_VERIFY_APPCODE "${ID_VERIFY_APPCODE:-}"
  set_if_non_empty ID_VERIFY_TIMEOUT_MS "${ID_VERIFY_TIMEOUT_MS:-}"
  set_if_non_empty ID_VERIFY_TOKEN_TTL_SECONDS "${ID_VERIFY_TOKEN_TTL_SECONDS:-}"
  set_if_non_empty RATE_LIMIT_WINDOW_MS "${RATE_LIMIT_WINDOW_MS:-}"
  set_if_non_empty RATE_LIMIT_MAX "${RATE_LIMIT_MAX:-}"
  set_if_non_empty RATE_LIMIT_BURST "${RATE_LIMIT_BURST:-}"
  set_if_non_empty SYNC_POLL_TIMEOUT_MS "${SYNC_POLL_TIMEOUT_MS:-}"
  set_if_non_empty FEISHU_SYNC_ATTEMPTS "${FEISHU_SYNC_ATTEMPTS:-}"
  set_if_non_empty FEISHU_SYNC_BACKOFF_MS "${FEISHU_SYNC_BACKOFF_MS:-}"
  set_if_non_empty FEISHU_SYNC_BACKOFF_MAX_MS "${FEISHU_SYNC_BACKOFF_MAX_MS:-}"
  set_if_non_empty FEISHU_WORKER_CONCURRENCY "${FEISHU_WORKER_CONCURRENCY:-}"
  set_if_non_empty FEISHU_WORKER_QPS "${FEISHU_WORKER_QPS:-}"
  set_if_non_empty FEISHU_SELECT_WRITE_MODE "${FEISHU_SELECT_WRITE_MODE:-}"
  set_if_non_empty MAX_PROOF_URLS "${MAX_PROOF_URLS:-}"
  set_if_non_empty MAX_PROOF_URL_LENGTH "${MAX_PROOF_URL_LENGTH:-}"
  set_if_non_empty FEISHU_FIELD_SOURCE "${FEISHU_FIELD_SOURCE:-}"
  set_if_non_empty FEISHU_SUBMISSION_SOURCE "${FEISHU_SUBMISSION_SOURCE:-}"
  set_if_non_empty FEISHU_ALERT_WEBHOOK "${FEISHU_ALERT_WEBHOOK:-}"
  set_if_non_empty FEISHU_ALERT_ENABLED "${FEISHU_ALERT_ENABLED:-}"
  set_if_non_empty RUN_DB_MIGRATE "${RUN_DB_MIGRATE:-}"
  set_if_non_empty RUN_WORKER "${RUN_WORKER:-}"
}
