#!/usr/bin/env bash
# remote-deploy.sh
#
# Usage:
#   bash scripts/remote-deploy.sh <preflight|prepare|promote|discard|rollback>
#
# The script is designed to be executed on the remote server through SSH.
# It supports blue/green API slots while keeping the currently-active slot
# serving traffic until promotion.

set -euo pipefail

CMD="${1:-}"

APP_ROOT="${APP_DIR:-/opt/web-fbif-form}"
RELEASES_DIR="${APP_ROOT}/releases"
CURRENT_LINK="${APP_ROOT}/current"
SHARED_DIR="${APP_ROOT}/shared"
BACKEND_ENV_FILE="${SHARED_DIR}/backend.env"
BACKEND_ENV_PREV_FILE="${SHARED_DIR}/backend.env.prev"
ACTIVE_SLOT_FILE="${SHARED_DIR}/active_slot"
PENDING_FILE="${SHARED_DIR}/pending_release.env"
LAST_PROMOTION_FILE="${SHARED_DIR}/last_promotion.env"

STATIC_DIR_VALUE="${STATIC_DIR:-/var/www/fbif-form}"
RELEASE_TGZ="${RELEASE_TGZ:-/tmp/release.tgz}"
GH_SHA="${GH_SHA:-}"

COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-fbif-form}"
PRIMARY_WEB_PORT="${PRIMARY_WEB_PORT:-3001}"
CANDIDATE_WEB_PORT="${CANDIDATE_WEB_PORT:-3002}"
NGINX_SITE_NAME="${NGINX_SITE_NAME:-fbif-form}"
CANDIDATE_SITE_NAME="${NGINX_SITE_NAME}-candidate"

API_PORT_VALUE="${API_PORT:-8080}"
API_PORT_INTERNAL_VALUE="${API_PORT_INTERNAL:-8080}"
BLUE_API_PORT="${BLUE_API_PORT:-8080}"
GREEN_API_PORT="${GREEN_API_PORT:-18080}"

ROLLBACK_WINDOW_SECONDS="${ROLLBACK_WINDOW_SECONDS:-180}"
ROLLBACK_CHECK_INTERVAL_SECONDS="${ROLLBACK_CHECK_INTERVAL_SECONDS:-15}"
ROLLBACK_MAX_CONSEC_FAILS="${ROLLBACK_MAX_CONSEC_FAILS:-3}"
ROLLBACK_MAX_5XX="${ROLLBACK_MAX_5XX:-6}"
ROLLBACK_MAX_TIMEOUTS="${ROLLBACK_MAX_TIMEOUTS:-6}"
ROLLBACK_SUBMISSION_MIN_FINALIZED="${ROLLBACK_SUBMISSION_MIN_FINALIZED:-3}"
ROLLBACK_SUBMISSION_MIN_SUCCESS_PERCENT="${ROLLBACK_SUBMISSION_MIN_SUCCESS_PERCENT:-85}"
ROLLBACK_SUBMISSION_MAX_FAILED="${ROLLBACK_SUBMISSION_MAX_FAILED:-2}"

RELEASE_DIR=""
BACKEND_ENV_STAGED=""
STATIC_NEW=""

log() {
  echo "==> $*"
}

die() {
  echo "ERROR: $*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "command not found: $1"
}

slot_api_port() {
  case "${1:-}" in
    blue)
      echo "${BLUE_API_PORT}"
      ;;
    green)
      echo "${GREEN_API_PORT}"
      ;;
    legacy)
      echo "${API_PORT_VALUE}"
      ;;
    *)
      return 1
      ;;
  esac
}

other_slot() {
  case "${1:-}" in
    blue)
      echo "green"
      ;;
    green)
      echo "blue"
      ;;
    legacy)
      echo "blue"
      ;;
    *)
      echo "blue"
      ;;
  esac
}

legacy_container_name() {
  echo "${COMPOSE_PROJECT_NAME}-api-1"
}

slot_container_name() {
  local slot="$1"
  echo "${COMPOSE_PROJECT_NAME}-api-${slot}"
}

container_running() {
  local name="$1"
  docker ps --format '{{.Names}}' | grep -qx "${name}"
}

read_active_slot() {
  if [ -f "${ACTIVE_SLOT_FILE}" ]; then
    local slot
    slot="$(tr -d '[:space:]' < "${ACTIVE_SLOT_FILE}")"
    case "${slot}" in
      blue|green|legacy)
        echo "${slot}"
        return 0
        ;;
    esac
  fi

  if container_running "$(slot_container_name blue)"; then
    echo "blue"
    return 0
  fi

  if container_running "$(slot_container_name green)"; then
    echo "green"
    return 0
  fi

  if container_running "$(legacy_container_name)"; then
    echo "legacy"
    return 0
  fi

  echo "legacy"
}

current_static_target() {
  if [ -L "${STATIC_DIR_VALUE}" ]; then
    readlink -f "${STATIC_DIR_VALUE}"
  else
    echo "${STATIC_DIR_VALUE}"
  fi
}

ensure_dirs() {
  mkdir -p "${RELEASES_DIR}" "${SHARED_DIR}"
}

load_pending_state() {
  [ -f "${PENDING_FILE}" ] || die "pending state not found: ${PENDING_FILE}"
  # shellcheck source=/dev/null
  . "${PENDING_FILE}"
}

save_pending_state() {
  local active_slot="$1"
  local candidate_slot="$2"
  local candidate_api_port="$3"
  local candidate_web_port="$4"
  local prev_release="$5"
  local prev_static_target="$6"

  cat > "${PENDING_FILE}" <<PENDING
GH_SHA=${GH_SHA}
ACTIVE_SLOT=${active_slot}
CANDIDATE_SLOT=${candidate_slot}
CANDIDATE_API_PORT=${candidate_api_port}
CANDIDATE_WEB_PORT=${candidate_web_port}
RELEASE_DIR=${RELEASE_DIR}
BACKEND_ENV_STAGED=${BACKEND_ENV_STAGED}
STATIC_NEW=${STATIC_NEW}
PREV_RELEASE=${prev_release}
PREV_STATIC_TARGET=${prev_static_target}
PREPARED_AT=$(date +%s)
PENDING
}

write_last_promotion_state() {
  local prev_slot="$1"
  local prev_release="$2"
  local prev_static_target="$3"
  local new_slot="$4"
  local new_release="$5"
  local new_static_target="$6"

  cat > "${LAST_PROMOTION_FILE}" <<PROMO
PREV_SLOT=${prev_slot}
PREV_RELEASE=${prev_release}
PREV_STATIC_TARGET=${prev_static_target}
NEW_SLOT=${new_slot}
NEW_RELEASE=${new_release}
NEW_STATIC_TARGET=${new_static_target}
PROMOTED_AT=$(date +%s)
PROMO
}

write_nginx_site() {
  local site_name="$1"
  local listen_port="$2"
  local root_dir="$3"
  local api_port="$4"

  mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled

  cat > "/etc/nginx/sites-available/${site_name}" <<SITE
server {
    listen ${listen_port};
    listen [::]:${listen_port};
    server_name _;

    root ${root_dir};
    index index.html;

    location = /healthz {
        default_type text/plain;
        return 200 "ok\\n";
    }

    location /api/ {
        proxy_pass http://127.0.0.1:${api_port};
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

  ln -sfn "/etc/nginx/sites-available/${site_name}" "/etc/nginx/sites-enabled/${site_name}"
}

remove_nginx_site() {
  local site_name="$1"
  rm -f "/etc/nginx/sites-enabled/${site_name}" "/etc/nginx/sites-available/${site_name}"
}

reload_nginx() {
  require_cmd nginx
  nginx -t
  if command -v systemctl >/dev/null 2>&1; then
    systemctl reload nginx
  else
    nginx -s reload
  fi
}

wait_http() {
  local url="$1"
  local retries="${2:-40}"
  local sleep_sec="${3:-1}"
  local i=1

  while [ "${i}" -le "${retries}" ]; do
    if curl -fsS "${url}" >/dev/null 2>&1; then
      return 0
    fi
    i=$((i + 1))
    sleep "${sleep_sec}"
  done

  return 1
}

is_nginx_available() {
  command -v nginx >/dev/null 2>&1
}

port_listener_count() {
  local port="$1"

  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | awk -v p=":${port}" '$4 ~ p"$" {count++} END {print count+0}'
    return 0
  fi

  if command -v netstat >/dev/null 2>&1; then
    netstat -ltn 2>/dev/null | awk -v p=":${port}" '$4 ~ p"$" {count++} END {print count+0}'
    return 0
  fi

  die "either ss or netstat is required for port checks"
}

assert_port_listening() {
  local port="$1"
  local label="$2"
  local listeners
  listeners="$(port_listener_count "${port}")"
  [ "${listeners}" -ge 1 ] || die "${label} port ${port} is not listening"
}

assert_port_not_listening() {
  local port="$1"
  local label="$2"
  local listeners
  listeners="$(port_listener_count "${port}")"
  [ "${listeners}" -eq 0 ] || die "${label} port ${port} is already occupied (${listeners} listeners)"
}

load_live_env() {
  [ -f "${BACKEND_ENV_FILE}" ] || die "missing backend env: ${BACKEND_ENV_FILE}"
  set -a
  # shellcheck source=/dev/null
  . "${BACKEND_ENV_FILE}"
  set +a
}

require_non_empty_env_keys() {
  local missing=()
  local key

  for key in "$@"; do
    local value="${!key-}"
    if [ -z "$(printf '%s' "${value}" | tr -d '[:space:]')" ]; then
      missing+=("${key}")
    fi
  done

  if [ "${#missing[@]}" -gt 0 ]; then
    die "missing required backend env keys: ${missing[*]}"
  fi
}

probe_http_code() {
  local url="$1"
  local timeout_sec="${2:-4}"
  local body_file="${3:-}"

  if [ -n "${body_file}" ]; then
    curl -sS --max-time "${timeout_sec}" -o "${body_file}" -w '%{http_code}' "${url}" 2>/dev/null || echo "000"
    return 0
  fi

  curl -sS --max-time "${timeout_sec}" -o /dev/null -w '%{http_code}' "${url}" 2>/dev/null || echo "000"
}

is_http_5xx() {
  case "${1:-}" in
    5??)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

normalize_int() {
  case "${1:-}" in
    ''|*[!0-9]*)
      echo "0"
      ;;
    *)
      echo "${1}"
      ;;
  esac
}

collect_submission_sync_window() {
  local since_epoch="$1"
  local pg_name="${COMPOSE_PROJECT_NAME}-postgres-1"
  local db_user
  local db_pass
  local db_name
  local sql

  [ -f "${BACKEND_ENV_FILE}" ] || return 1

  set -a
  # shellcheck source=/dev/null
  . "${BACKEND_ENV_FILE}"
  set +a

  db_user="${POSTGRES_USER:-fbif}"
  db_pass="${POSTGRES_PASSWORD:-change_me}"
  db_name="${POSTGRES_DB:-fbif_form}"

  sql="SELECT
    COUNT(*)::bigint,
    COALESCE(SUM(CASE WHEN \"syncStatus\" = 'SUCCESS' THEN 1 ELSE 0 END), 0)::bigint,
    COALESCE(SUM(CASE WHEN \"syncStatus\" = 'FAILED' THEN 1 ELSE 0 END), 0)::bigint,
    COALESCE(SUM(CASE WHEN \"syncStatus\" IN ('PENDING','PROCESSING','RETRYING') THEN 1 ELSE 0 END), 0)::bigint
  FROM \"Submission\"
  WHERE EXTRACT(EPOCH FROM \"createdAt\") >= ${since_epoch};"

  docker exec \
    -e PGPASSWORD="${db_pass}" \
    "${pg_name}" \
    psql -v ON_ERROR_STOP=1 -U "${db_user}" -d "${db_name}" -At -F '|' -c "${sql}"
}

extract_release() {
  [ -n "${GH_SHA}" ] || die "GH_SHA is required"
  [ -f "${RELEASE_TGZ}" ] || die "release archive missing: ${RELEASE_TGZ}"

  RELEASE_DIR="${RELEASES_DIR}/${GH_SHA}"

  rm -rf "${RELEASE_DIR}"
  mkdir -p "${RELEASE_DIR}"

  log "Extracting release ${GH_SHA:0:7}"
  tar -xzf "${RELEASE_TGZ}" -C "${RELEASE_DIR}"

  [ -f "${RELEASE_DIR}/scripts/update-backend-env.sh" ] || die "release is missing scripts/update-backend-env.sh"
  [ -f "${RELEASE_DIR}/docker-compose.production.yml" ] || die "release is missing docker-compose.production.yml"
  [ -d "${RELEASE_DIR}/apps/web/dist" ] || die "release is missing apps/web/dist"
}

build_staged_env() {
  [ -f "${BACKEND_ENV_FILE}" ] || die "missing live env file: ${BACKEND_ENV_FILE}"

  BACKEND_ENV_STAGED="${SHARED_DIR}/backend.env.staged.${GH_SHA}"
  cp "${BACKEND_ENV_FILE}" "${BACKEND_ENV_STAGED}"

  export BACKEND_ENV_FILE="${BACKEND_ENV_STAGED}"
  # shellcheck source=/dev/null
  . "${RELEASE_DIR}/scripts/update-backend-env.sh"

  init_env_file
  migrate_env
  apply_defaults
  apply_overrides
  set_if_non_empty GH_SHA "${GH_SHA}"
  finalize_env_file

  export BACKEND_ENV_FILE="${SHARED_DIR}/backend.env"
}

compose_build_api_image() {
  (
    set -a
    # shellcheck source=/dev/null
    . "${BACKEND_ENV_STAGED}"
    set +a
    cd "${RELEASE_DIR}"
    docker compose --env-file "${BACKEND_ENV_STAGED}" -f docker-compose.production.yml build api
  )
}

ensure_data_services() {
  [ -f "${BACKEND_ENV_FILE}" ] || die "missing live env file: ${BACKEND_ENV_FILE}"

  (
    set -a
    # shellcheck source=/dev/null
    . "${BACKEND_ENV_FILE}"
    set +a
    cd "${RELEASE_DIR}"
    docker compose --env-file "${BACKEND_ENV_FILE}" -f docker-compose.production.yml up -d --no-build --no-recreate postgres redis
  )

  local pg_name="${COMPOSE_PROJECT_NAME}-postgres-1"
  local redis_name="${COMPOSE_PROJECT_NAME}-redis-1"

  for _ in $(seq 1 30); do
    if docker exec "${pg_name}" pg_isready -U "${POSTGRES_USER:-fbif}" -d "${POSTGRES_DB:-fbif_form}" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done

  for _ in $(seq 1 20); do
    if docker exec "${redis_name}" redis-cli ping 2>/dev/null | grep -q PONG; then
      break
    fi
    sleep 1
  done
}

run_slot_api_container() {
  local slot="$1"
  local container_name
  local slot_port
  local image_tag

  container_name="$(slot_container_name "${slot}")"
  slot_port="$(slot_api_port "${slot}")"
  image_tag="fbif-form-api:${GH_SHA:-latest}"

  (
    set -a
    # shellcheck source=/dev/null
    . "${BACKEND_ENV_STAGED}"
    set +a

    local db_user="${POSTGRES_USER:-fbif}"
    local db_pass="${POSTGRES_PASSWORD:-change_me}"
    local db_name="${POSTGRES_DB:-fbif_form}"
    local database_url="postgresql://${db_user}:${db_pass}@${COMPOSE_PROJECT_NAME}-postgres-1:5432/${db_name}"
    local redis_url="redis://${COMPOSE_PROJECT_NAME}-redis-1:6379"

    docker rm -f "${container_name}" >/dev/null 2>&1 || true

    docker run -d \
      --name "${container_name}" \
      --restart unless-stopped \
      --network "${COMPOSE_PROJECT_NAME}_private" \
      -p "127.0.0.1:${slot_port}:${API_PORT_INTERNAL_VALUE}" \
      --env-file "${BACKEND_ENV_STAGED}" \
      -e PORT="${API_PORT_INTERNAL_VALUE}" \
      -e NODE_ENV=production \
      -e GH_SHA="${GH_SHA}" \
      -e DATABASE_URL="${database_url}" \
      -e REDIS_URL="${redis_url}" \
      "${image_tag}" >/dev/null

    docker network connect "${COMPOSE_PROJECT_NAME}_backend" "${container_name}" >/dev/null 2>&1 || true
  )

  if ! wait_http "http://127.0.0.1:${slot_port}/health" 60 1; then
    docker logs "${container_name}" --tail 80 2>&1 || true
    die "candidate container health check failed (${container_name})"
  fi
}

remove_slot_api_container() {
  local slot="$1"
  docker rm -f "$(slot_container_name "${slot}")" >/dev/null 2>&1 || true
}

configure_primary_nginx() {
  local active_slot="$1"
  local active_api_port
  active_api_port="$(slot_api_port "${active_slot}")"

  write_nginx_site "${NGINX_SITE_NAME}" "${PRIMARY_WEB_PORT}" "${STATIC_DIR_VALUE}" "${active_api_port}"
}

configure_candidate_nginx() {
  local candidate_api_port="$1"
  write_nginx_site "${CANDIDATE_SITE_NAME}" "${CANDIDATE_WEB_PORT}" "${STATIC_NEW}" "${candidate_api_port}"
}

switch_static_symlink() {
  if [ -L "${STATIC_DIR_VALUE}" ]; then
    ln -sfn "${STATIC_NEW}" "${STATIC_DIR_VALUE}.pending"
    mv -Tf "${STATIC_DIR_VALUE}.pending" "${STATIC_DIR_VALUE}"
  elif [ -d "${STATIC_DIR_VALUE}" ]; then
    mv "${STATIC_DIR_VALUE}" "${STATIC_DIR_VALUE}-old-$(date +%s)-$$"
    ln -sfn "${STATIC_NEW}" "${STATIC_DIR_VALUE}"
  else
    ln -sfn "${STATIC_NEW}" "${STATIC_DIR_VALUE}"
  fi
}

rollback_internal() {
  local prev_slot=""
  local prev_release=""
  local prev_static_target=""

  if [ -f "${LAST_PROMOTION_FILE}" ]; then
    # shellcheck source=/dev/null
    . "${LAST_PROMOTION_FILE}"
    prev_slot="${PREV_SLOT:-}"
    prev_release="${PREV_RELEASE:-}"
    prev_static_target="${PREV_STATIC_TARGET:-}"
  elif [ -f "${PENDING_FILE}" ]; then
    # shellcheck source=/dev/null
    . "${PENDING_FILE}"
    prev_slot="${ACTIVE_SLOT:-legacy}"
    prev_release="${PREV_RELEASE:-}"
    prev_static_target="${PREV_STATIC_TARGET:-}"
  fi

  [ -n "${prev_slot}" ] || prev_slot="legacy"

  log "Rollback -> slot ${prev_slot}"

  if [ -f "${BACKEND_ENV_PREV_FILE}" ]; then
    cp "${BACKEND_ENV_PREV_FILE}" "${BACKEND_ENV_FILE}"
  fi

  if [ -n "${prev_release}" ] && [ -d "${prev_release}" ]; then
    ln -sfn "${prev_release}" "${CURRENT_LINK}"
  fi

  if [ -n "${prev_static_target}" ] && [ -e "${prev_static_target}" ]; then
    if [ -L "${STATIC_DIR_VALUE}" ]; then
      ln -sfn "${prev_static_target}" "${STATIC_DIR_VALUE}.pending"
      mv -Tf "${STATIC_DIR_VALUE}.pending" "${STATIC_DIR_VALUE}"
    else
      rm -rf "${STATIC_DIR_VALUE}" >/dev/null 2>&1 || true
      ln -sfn "${prev_static_target}" "${STATIC_DIR_VALUE}"
    fi
  fi

  echo "${prev_slot}" > "${ACTIVE_SLOT_FILE}"

  if command -v nginx >/dev/null 2>&1; then
    configure_primary_nginx "${prev_slot}"
    reload_nginx
  fi

  rm -f "${PENDING_FILE}"
}

observe_after_promote() {
  local active_slot="$1"
  local active_api_port
  local checks
  local consecutive_failures=0
  local total_5xx=0
  local total_timeouts=0
  local window_start_epoch
  local nginx_present=0

  active_api_port="$(slot_api_port "${active_slot}")"
  window_start_epoch="$(date +%s)"

  if is_nginx_available; then
    nginx_present=1
  fi

  checks=$((ROLLBACK_WINDOW_SECONDS / ROLLBACK_CHECK_INTERVAL_SECONDS))
  if [ "${checks}" -lt 1 ]; then
    checks=1
  fi

  log "Observation window: ${ROLLBACK_WINDOW_SECONDS}s (${checks} checks)"

  for i in $(seq 1 "${checks}"); do
    local failed=0
    local status_label="healthy"
    local api_health_code
    local web_healthz_code="SKIP"
    local csrf_code="SKIP"
    local csrf_body=""
    local submission_stats=""
    local submission_total=0
    local submission_success=0
    local submission_failed=0
    local submission_pending=0
    local submission_finalized=0
    local submission_success_percent=100

    api_health_code="$(probe_http_code "http://127.0.0.1:${active_api_port}/health" 4)"
    if [ "${api_health_code}" = "000" ]; then
      total_timeouts=$((total_timeouts + 1))
      failed=1
    elif is_http_5xx "${api_health_code}"; then
      total_5xx=$((total_5xx + 1))
      failed=1
    elif [ "${api_health_code}" != "200" ]; then
      failed=1
    fi

    if [ "${nginx_present}" -eq 1 ]; then
      web_healthz_code="$(probe_http_code "http://127.0.0.1:${PRIMARY_WEB_PORT}/healthz" 4)"
      if [ "${web_healthz_code}" = "000" ]; then
        total_timeouts=$((total_timeouts + 1))
        failed=1
      elif is_http_5xx "${web_healthz_code}"; then
        total_5xx=$((total_5xx + 1))
        failed=1
      elif [ "${web_healthz_code}" != "200" ]; then
        failed=1
      fi

      csrf_body="$(mktemp)"
      csrf_code="$(probe_http_code "http://127.0.0.1:${PRIMARY_WEB_PORT}/api/csrf" 6 "${csrf_body}")"
      if [ "${csrf_code}" = "000" ]; then
        total_timeouts=$((total_timeouts + 1))
        failed=1
      elif is_http_5xx "${csrf_code}"; then
        total_5xx=$((total_5xx + 1))
        failed=1
      elif [ "${csrf_code}" != "200" ] || ! grep -q 'csrfToken' "${csrf_body}"; then
        failed=1
      fi
      rm -f "${csrf_body}"
    else
      log "Observation ${i}/${checks}: nginx not found, skip /healthz and /api/csrf checks"
    fi

    submission_stats="$(collect_submission_sync_window "${window_start_epoch}" 2>/dev/null || true)"
    if [ -z "${submission_stats}" ]; then
      failed=1
    else
      IFS='|' read -r submission_total submission_success submission_failed submission_pending <<<"${submission_stats}"
      submission_total="$(normalize_int "${submission_total}")"
      submission_success="$(normalize_int "${submission_success}")"
      submission_failed="$(normalize_int "${submission_failed}")"
      submission_pending="$(normalize_int "${submission_pending}")"
      submission_finalized=$((submission_success + submission_failed))

      if [ "${submission_finalized}" -gt 0 ]; then
        submission_success_percent=$((submission_success * 100 / submission_finalized))
      fi

      if [ "${submission_failed}" -gt "${ROLLBACK_SUBMISSION_MAX_FAILED}" ]; then
        failed=1
      fi

      if [ "${submission_finalized}" -ge "${ROLLBACK_SUBMISSION_MIN_FINALIZED}" ] && \
         [ "${submission_success_percent}" -lt "${ROLLBACK_SUBMISSION_MIN_SUCCESS_PERCENT}" ]; then
        failed=1
      fi
    fi

    if [ "${total_5xx}" -gt "${ROLLBACK_MAX_5XX}" ]; then
      log "Observation failed: 5xx exceeded threshold (${total_5xx} > ${ROLLBACK_MAX_5XX})"
      return 1
    fi

    if [ "${total_timeouts}" -gt "${ROLLBACK_MAX_TIMEOUTS}" ]; then
      log "Observation failed: timeout exceeded threshold (${total_timeouts} > ${ROLLBACK_MAX_TIMEOUTS})"
      return 1
    fi

    if [ "${failed}" -eq 0 ]; then
      consecutive_failures=0
      status_label="healthy"
    else
      consecutive_failures=$((consecutive_failures + 1))
      status_label="failed"
    fi

    if [ -n "${submission_stats}" ]; then
      log "Observation ${i}/${checks}: ${status_label} (consecutive=${consecutive_failures}/${ROLLBACK_MAX_CONSEC_FAILS}, api=${api_health_code}, healthz=${web_healthz_code}, csrf=${csrf_code}, 5xx=${total_5xx}/${ROLLBACK_MAX_5XX}, timeout=${total_timeouts}/${ROLLBACK_MAX_TIMEOUTS}, submissions_total=${submission_total}, success=${submission_success}, failed=${submission_failed}, pending=${submission_pending}, success_rate=${submission_success_percent}%)"
    else
      log "Observation ${i}/${checks}: ${status_label} (consecutive=${consecutive_failures}/${ROLLBACK_MAX_CONSEC_FAILS}, api=${api_health_code}, healthz=${web_healthz_code}, csrf=${csrf_code}, 5xx=${total_5xx}/${ROLLBACK_MAX_5XX}, timeout=${total_timeouts}/${ROLLBACK_MAX_TIMEOUTS}, submissions=unavailable)"
    fi

    if [ "${consecutive_failures}" -ge "${ROLLBACK_MAX_CONSEC_FAILS}" ]; then
      log "Observation failed: consecutive failures exceeded threshold"
      return 1
    fi

    if [ "${i}" -lt "${checks}" ]; then
      sleep "${ROLLBACK_CHECK_INTERVAL_SECONDS}"
    fi
  done

  log "Observation passed: 5xx=${total_5xx}, timeout=${total_timeouts}"
  return 0
}

cmd_preflight() {
  require_cmd docker
  docker compose version >/dev/null 2>&1 || die "docker compose v2 is required"
  require_cmd curl
  (command -v ss >/dev/null 2>&1 || command -v netstat >/dev/null 2>&1) || die "ss/netstat is required for port preflight"
  is_nginx_available || die "nginx is required for production preflight"

  [ -d "${APP_ROOT}" ] || die "missing app directory: ${APP_ROOT}"
  [ -d "${RELEASES_DIR}" ] || die "missing releases directory: ${RELEASES_DIR}"
  [ -d "${SHARED_DIR}" ] || die "missing shared directory: ${SHARED_DIR}"
  [ -e "${STATIC_DIR_VALUE}" ] || die "missing static target path: ${STATIC_DIR_VALUE}"
  [ -f "${BACKEND_ENV_FILE}" ] || die "missing backend env: ${BACKEND_ENV_FILE}"
  [ ! -f "${PENDING_FILE}" ] || die "pending deployment exists, run discard/rollback first: ${PENDING_FILE}"

  local active_slot
  local active_api_port
  local active_container
  active_slot="$(read_active_slot)"
  active_api_port="$(slot_api_port "${active_slot}")"

  case "${active_slot}" in
    blue|green)
      active_container="$(slot_container_name "${active_slot}")"
      ;;
    legacy)
      active_container="$(legacy_container_name)"
      ;;
    *)
      die "invalid active slot: ${active_slot}"
      ;;
  esac

  load_live_env
  require_non_empty_env_keys \
    WEB_ORIGIN \
    POSTGRES_USER \
    POSTGRES_PASSWORD \
    POSTGRES_DB \
    DATA_KEY \
    DATA_HASH_SALT \
    FEISHU_APP_ID \
    FEISHU_APP_SECRET \
    FEISHU_APP_TOKEN \
    FEISHU_TABLE_ID

  case "$(printf '%s' "${ID_VERIFY_ENABLED:-false}" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on)
      require_non_empty_env_keys ID_VERIFY_APPCODE
      ;;
  esac

  local free_mb
  free_mb="$(df -Pm "${APP_ROOT}" | awk 'NR==2 {print $4}')"
  [ -n "${free_mb}" ] || die "cannot read free disk space"
  [ "${free_mb}" -ge 1024 ] || die "insufficient disk free space: ${free_mb}MB"

  container_running "${active_container}" || die "active api container is not running: ${active_container}"
  container_running "${COMPOSE_PROJECT_NAME}-postgres-1" || die "postgres container is not running: ${COMPOSE_PROJECT_NAME}-postgres-1"
  container_running "${COMPOSE_PROJECT_NAME}-redis-1" || die "redis container is not running: ${COMPOSE_PROJECT_NAME}-redis-1"

  assert_port_listening "${PRIMARY_WEB_PORT}" "primary web"
  assert_port_listening "${active_api_port}" "active api"
  assert_port_not_listening "${CANDIDATE_WEB_PORT}" "candidate web"

  nginx -t >/dev/null 2>&1 || die "nginx config test failed"

  echo "ACTIVE_SLOT=${active_slot}"
  echo "ACTIVE_API_PORT=${active_api_port}"
  echo "ACTIVE_API_CONTAINER=${active_container}"
  echo "PRIMARY_WEB_PORT=${PRIMARY_WEB_PORT}"
  echo "CANDIDATE_WEB_PORT=${CANDIDATE_WEB_PORT}"
  echo "BLUE_API_PORT=${BLUE_API_PORT}"
  echo "GREEN_API_PORT=${GREEN_API_PORT}"
  echo "FREE_MB=${free_mb}"
  echo "PREFLIGHT_READ_ONLY=1"
}

cmd_prepare() {
  ensure_dirs
  [ -f "${PENDING_FILE}" ] && die "pending deployment already exists: ${PENDING_FILE}"

  require_cmd docker
  docker compose version >/dev/null 2>&1 || die "docker compose v2 is required"
  require_cmd curl

  extract_release
  build_staged_env

  local active_slot
  local candidate_slot
  local candidate_api_port
  local prev_release
  local prev_static_target
  local nginx_present=0

  active_slot="$(read_active_slot)"
  candidate_slot="$(other_slot "${active_slot}")"
  candidate_api_port="$(slot_api_port "${candidate_slot}")"

  prev_release="$(readlink -f "${CURRENT_LINK}" 2>/dev/null || true)"
  prev_static_target="$(current_static_target)"

  ensure_data_services
  compose_build_api_image

  STATIC_NEW="${STATIC_DIR_VALUE}-${GH_SHA}"
  rm -rf "${STATIC_NEW}"
  cp -r "${RELEASE_DIR}/apps/web/dist" "${STATIC_NEW}"

  run_slot_api_container "${candidate_slot}"

  if is_nginx_available; then
    nginx_present=1
    configure_primary_nginx "${active_slot}"
    configure_candidate_nginx "${candidate_api_port}"
    reload_nginx

    if ! wait_http "http://127.0.0.1:${CANDIDATE_WEB_PORT}/healthz" 20 1; then
      die "candidate web healthz failed on port ${CANDIDATE_WEB_PORT}"
    fi
  else
    log "nginx not found, skip candidate /healthz probe and candidate site setup"
  fi

  save_pending_state \
    "${active_slot}" \
    "${candidate_slot}" \
    "${candidate_api_port}" \
    "${CANDIDATE_WEB_PORT}" \
    "${prev_release}" \
    "${prev_static_target}"

  log "Candidate prepared"
  echo "CANDIDATE_SLOT=${candidate_slot}"
  echo "CANDIDATE_API_PORT=${candidate_api_port}"
  echo "CANDIDATE_WEB_PORT=${CANDIDATE_WEB_PORT}"
  echo "CANDIDATE_NGINX_READY=${nginx_present}"
  echo "RELEASE_DIR=${RELEASE_DIR}"
  echo "STATIC_NEW=${STATIC_NEW}"
}

cmd_promote() {
  load_pending_state

  local candidate_slot="${CANDIDATE_SLOT}"
  local candidate_api_port="${CANDIDATE_API_PORT}"
  local prev_slot="${ACTIVE_SLOT}"
  local prev_release="${PREV_RELEASE}"
  local prev_static_target="${PREV_STATIC_TARGET}"

  [ -f "${BACKEND_ENV_STAGED}" ] || die "staged env file missing: ${BACKEND_ENV_STAGED}"

  if ! wait_http "http://127.0.0.1:${candidate_api_port}/health" 10 1; then
    die "candidate slot is not healthy before promote"
  fi

  cp "${BACKEND_ENV_FILE}" "${BACKEND_ENV_PREV_FILE}" 2>/dev/null || true
  cp "${BACKEND_ENV_STAGED}" "${BACKEND_ENV_FILE}"

  switch_static_symlink

  echo "${candidate_slot}" > "${ACTIVE_SLOT_FILE}"
  ln -sfn "${RELEASE_DIR}" "${CURRENT_LINK}"

  if is_nginx_available; then
    configure_primary_nginx "${candidate_slot}"
    reload_nginx
  else
    log "nginx not found, skip primary site switch"
  fi

  write_last_promotion_state \
    "${prev_slot}" \
    "${prev_release}" \
    "${prev_static_target}" \
    "${candidate_slot}" \
    "${RELEASE_DIR}" \
    "$(current_static_target)"

  rm -f "${PENDING_FILE}"

  if ! observe_after_promote "${candidate_slot}"; then
    log "Observation failed, auto rollback"
    rollback_internal
    die "auto rollback triggered"
  fi

  log "Promoted to slot ${candidate_slot}"
  echo "ACTIVE_SLOT=${candidate_slot}"
}

cmd_discard() {
  if [ ! -f "${PENDING_FILE}" ]; then
    log "No pending deployment state to discard"
    exit 0
  fi

  load_pending_state

  remove_slot_api_container "${CANDIDATE_SLOT}"
  rm -rf "${STATIC_NEW}" >/dev/null 2>&1 || true
  rm -f "${BACKEND_ENV_STAGED}" >/dev/null 2>&1 || true
  rm -f "${PENDING_FILE}"

  if command -v nginx >/dev/null 2>&1; then
    remove_nginx_site "${CANDIDATE_SITE_NAME}"
    reload_nginx
  fi

  log "Discarded pending candidate"
}

cmd_rollback() {
  rollback_internal
  log "Manual rollback completed"
  echo "ACTIVE_SLOT=$(read_active_slot)"
}

usage() {
  cat <<USAGE
Usage: $0 <preflight|prepare|promote|discard|rollback>
USAGE
}

case "${CMD}" in
  preflight)
    cmd_preflight
    ;;
  prepare)
    cmd_prepare
    ;;
  promote)
    cmd_promote
    ;;
  discard)
    cmd_discard
    ;;
  rollback)
    cmd_rollback
    ;;
  *)
    usage
    exit 1
    ;;
esac
