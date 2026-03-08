#!/usr/bin/env bash
# remote-deploy.sh — Shared remote deployment script with atomic static file
# switching, build-before-switch for shorter API downtime, and full rollback
# on health-check failure.
#
# Expected environment variables (passed by CI):
#   APP_DIR, STATIC_DIR, API_PORT, API_PORT_INTERNAL, GH_SHA, ...
#   COMPOSE_PROJECT_NAME (optional, defaults to fbif-form)
#   NGINX_LISTEN_PORT    (optional, set to enable NGINX site config)
#   NGINX_SITE_NAME      (optional, requires NGINX_LISTEN_PORT)
#   CADDY_DOMAIN         (optional, set to add Caddy HTTPS entry)

set -euo pipefail

APP_ROOT="${APP_DIR:-/opt/web-fbif-form}"
RELEASES_DIR="${APP_ROOT}/releases"
CURRENT_LINK="${APP_ROOT}/current"
RELEASE_DIR="${RELEASES_DIR}/${GH_SHA}"
SHARED_DIR="${APP_ROOT}/shared"
BACKEND_ENV_FILE="${SHARED_DIR}/backend.env"

STATIC_DIR_VALUE="${STATIC_DIR:-/var/www/fbif-form}"
API_PORT_VALUE="${API_PORT:-8080}"

RELEASE_TGZ="${RELEASE_TGZ:-/tmp/release.tgz}"

mkdir -p "${RELEASES_DIR}" "${SHARED_DIR}"
rm -rf "${RELEASE_DIR}"
mkdir -p "${RELEASE_DIR}"

echo "==> Extracting release ${GH_SHA:0:7}..."
tar -xzf "${RELEASE_TGZ}" -C "${RELEASE_DIR}"

# ---------------------------------------------------------------
# Step 1: Copy static files to a versioned directory (no switch yet)
# ---------------------------------------------------------------
STATIC_NEW="${STATIC_DIR_VALUE}-${GH_SHA}"
echo "==> Preparing static files at ${STATIC_NEW}..."
rm -rf "${STATIC_NEW}"
cp -r "${RELEASE_DIR}/apps/web/dist" "${STATIC_NEW}"

# ---------------------------------------------------------------
# Step 2: Build new backend.env into a STAGED file (don't touch live env yet)
# ---------------------------------------------------------------
BACKEND_ENV_STAGED="${BACKEND_ENV_FILE}.staged"
cp "${BACKEND_ENV_FILE}" "${BACKEND_ENV_STAGED}" 2>/dev/null || touch "${BACKEND_ENV_STAGED}"

# Generate env into the staged file (not the live one)
export BACKEND_ENV_FILE="${BACKEND_ENV_STAGED}"
. "${RELEASE_DIR}/scripts/update-backend-env.sh"

init_env_file
migrate_env
apply_defaults
apply_overrides
set_if_non_empty GH_SHA "${GH_SHA:-}"
finalize_env_file

# Restore the real path for later use
BACKEND_ENV_FILE="${SHARED_DIR}/backend.env"

# ---------------------------------------------------------------
# Step 3: NGINX site config (opt-in: only when NGINX_LISTEN_PORT is set)
# ---------------------------------------------------------------
if [ -n "${NGINX_LISTEN_PORT:-}" ] && command -v nginx >/dev/null 2>&1; then
  NGINX_SITE_NAME="${NGINX_SITE_NAME:-fbif-form-${NGINX_LISTEN_PORT}}"
  mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled
  printf '%s\n' \
    'server {' \
    "    listen ${NGINX_LISTEN_PORT};" \
    "    listen [::]:${NGINX_LISTEN_PORT};" \
    '    server_name _;' \
    '' \
    "    root ${STATIC_DIR_VALUE};" \
    '    index index.html;' \
    '' \
    '    location = /healthz {' \
    '        default_type text/plain;' \
    '        return 200 "ok\n";' \
    '    }' \
    '' \
    '    location /api/ {' \
    "        proxy_pass http://127.0.0.1:${API_PORT_VALUE};" \
    '        proxy_http_version 1.1;' \
    '        proxy_set_header Host $host;' \
    '        proxy_set_header X-Real-IP $remote_addr;' \
    '        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;' \
    '        proxy_set_header X-Forwarded-Proto $scheme;' \
    '        proxy_set_header X-Forwarded-Host $host;' \
    '        proxy_read_timeout 75s;' \
    '        proxy_send_timeout 75s;' \
    '        proxy_connect_timeout 5s;' \
    '        proxy_next_upstream error timeout http_502 http_503;' \
    '        proxy_next_upstream_timeout 30s;' \
    '        proxy_next_upstream_tries 3;' \
    '    }' \
    '' \
    '    location /assets/ {' \
    '        expires 30d;' \
    '        add_header Cache-Control "public, immutable";' \
    '    }' \
    '' \
    '    location / {' \
    '        try_files $uri $uri/ /index.html;' \
    '        add_header Cache-Control "no-store";' \
    '    }' \
    '}' \
    > "/etc/nginx/sites-available/${NGINX_SITE_NAME}"
  ln -sfn "/etc/nginx/sites-available/${NGINX_SITE_NAME}" \
          "/etc/nginx/sites-enabled/${NGINX_SITE_NAME}"
  nginx -t
  systemctl reload nginx
fi

# --- Caddy entry (opt-in: only when CADDY_DOMAIN is set) ---
if [ -n "${CADDY_DOMAIN:-}" ] && command -v caddy >/dev/null 2>&1 && [ -f /etc/caddy/Caddyfile ]; then
  if ! grep -F "${CADDY_DOMAIN} {" /etc/caddy/Caddyfile >/dev/null 2>&1; then
    printf '\n%s\n%s\n%s\n' \
      "${CADDY_DOMAIN} {" \
      "    reverse_proxy 127.0.0.1:${NGINX_LISTEN_PORT:-${API_PORT_VALUE}}" \
      '}' >> /etc/caddy/Caddyfile
  fi
  caddy validate --config /etc/caddy/Caddyfile
  systemctl reload caddy
fi

# ---------------------------------------------------------------
# Step 4: Docker checks
# ---------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  echo "Docker not found on server." >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 not found on server." >&2
  exit 1
fi

# Clean up legacy web containers from migration period
docker rm -f "${COMPOSE_PROJECT_NAME:-fbif-form}-web-1" >/dev/null 2>&1 || true
docker rm -f "${COMPOSE_PROJECT_NAME:-fbif-form}-web-nginx" >/dev/null 2>&1 || true

# ---------------------------------------------------------------
# Step 5: Build images with STAGED env (old containers keep serving)
# ---------------------------------------------------------------
set -a
. "${BACKEND_ENV_STAGED}"
set +a

export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-fbif-form}"

echo "==> Building Docker images (old containers still running)..."
(
  cd "${RELEASE_DIR}"
  docker compose \
    --env-file "${BACKEND_ENV_STAGED}" \
    -f docker-compose.production.yml \
    build
)
# If build fails, set -e exits here. Old containers still running with live
# env — no damage, nothing to roll back.

# ---------------------------------------------------------------
# Step 6 + 7: Swap containers then health check.
#             Uses a minimal-downtime strategy:
#             - Postgres/Redis containers are never recreated (data preserved)
#             - Only the API container is recreated with the new image
#             - NGINX proxy_next_upstream queues requests during the brief gap
# ---------------------------------------------------------------
rollback() {
  echo "==> ROLLBACK triggered!"

  PREV_RELEASE="$(readlink -f "${CURRENT_LINK}" 2>/dev/null || true)"
  if [ -n "${PREV_RELEASE}" ] && [ -d "${PREV_RELEASE}" ] && [ "${PREV_RELEASE}" != "${RELEASE_DIR}" ]; then
    echo "==> Restarting containers from previous release: ${PREV_RELEASE}"
    set -a
    . "${BACKEND_ENV_FILE}"
    set +a
    (
      cd "${PREV_RELEASE}"
      docker compose \
        --env-file "${BACKEND_ENV_FILE}" \
        -f docker-compose.production.yml \
        up -d --no-build --remove-orphans
    ) || echo "==> WARNING: rollback container restart also failed" >&2
  else
    echo "==> No previous release to roll back to (first deploy?)" >&2
  fi

  echo "==> Static files still point to previous version (symlink not switched)"
  rm -rf "${STATIC_NEW}"
  rm -f "${BACKEND_ENV_STAGED}"
  exit 1
}

wait_http() {
  local url="$1"
  local retries="${2:-40}"
  local i=1
  while [ "${i}" -le "${retries}" ]; do
    if curl -fsS "${url}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    i=$((i + 1))
  done
  echo "Health check failed: ${url}" >&2
  docker ps || true
  docker logs "${COMPOSE_PROJECT_NAME:-fbif-form}-api-1" --tail 30 2>&1 || true
  return 1
}

# Disable set -e for the swap+check block so we can handle failures ourselves
set +e

# --- Minimal-downtime deployment ---
# 1. Ensure Postgres + Redis are running (no recreate if unchanged)
# 2. Only recreate the API container with the new image
echo "==> Ensuring database services are running..."
(
  cd "${RELEASE_DIR}"
  docker compose \
    --env-file "${BACKEND_ENV_STAGED}" \
    -f docker-compose.production.yml \
    up -d --no-build --no-recreate postgres redis
)
DB_EXIT=$?
if [ "${DB_EXIT}" -ne 0 ]; then
  echo "==> Database services failed to start (exit ${DB_EXIT})"
  rollback
fi

# Wait for database readiness before swapping API
echo "==> Waiting for Postgres to be ready..."
for _i in $(seq 1 30); do
  if docker exec "${COMPOSE_PROJECT_NAME:-fbif-form}-postgres-1" pg_isready -U "${POSTGRES_USER:-fbif}" -d "${POSTGRES_DB:-fbif_form}" >/dev/null 2>&1; then
    echo "==> Postgres is ready."
    break
  fi
  sleep 1
done

echo "==> Waiting for Redis to be ready..."
for _i in $(seq 1 15); do
  if docker exec "${COMPOSE_PROJECT_NAME:-fbif-form}-redis-1" redis-cli ping 2>/dev/null | grep -q PONG; then
    echo "==> Redis is ready."
    break
  fi
  sleep 1
done

# Now recreate only the API container (brief downtime, typically 3-8 seconds)
echo "==> Recreating API container (minimal downtime)..."
(
  cd "${RELEASE_DIR}"
  docker compose \
    --env-file "${BACKEND_ENV_STAGED}" \
    -f docker-compose.production.yml \
    up -d --no-build --force-recreate --no-deps api
)
UP_EXIT=$?

if [ "${UP_EXIT}" -ne 0 ]; then
  echo "==> docker compose up (api) failed (exit ${UP_EXIT})"
  rollback
fi

if ! wait_http "http://127.0.0.1:${API_PORT_VALUE}/health" 60; then
  echo "==> API health check failed"
  rollback
fi

# Clean up orphaned containers from previous project names
(
  cd "${RELEASE_DIR}"
  docker compose \
    --env-file "${BACKEND_ENV_STAGED}" \
    -f docker-compose.production.yml \
    up -d --no-build --remove-orphans 2>/dev/null
) || true

# ---------------------------------------------------------------
# Step 8: Post-deploy end-to-end verification
# ---------------------------------------------------------------
VERIFY_SCRIPT="${RELEASE_DIR}/scripts/post-deploy-verify.sh"
if [ -x "${VERIFY_SCRIPT}" ]; then
  echo "==> Running post-deploy verification..."
  if ! API_PORT="${API_PORT_VALUE}" bash "${VERIFY_SCRIPT}"; then
    echo "==> Post-deploy verification FAILED"
    rollback
  fi
else
  echo "==> Post-deploy verify script not found, skipping"
fi

set -e

# ---------------------------------------------------------------
# Step 9: Verification passed — COMMIT the deployment
# ---------------------------------------------------------------
echo "==> All checks passed. Committing deployment..."

# Promote staged env to live
cp "${BACKEND_ENV_FILE}" "${BACKEND_ENV_FILE}.prev" 2>/dev/null || true
mv "${BACKEND_ENV_STAGED}" "${BACKEND_ENV_FILE}"
echo "==> backend.env promoted (prev backed up)"

# Atomic static file switch via symlink
if [ -L "${STATIC_DIR_VALUE}" ]; then
  ln -sfn "${STATIC_NEW}" "${STATIC_DIR_VALUE}.pending"
  mv -Tf "${STATIC_DIR_VALUE}.pending" "${STATIC_DIR_VALUE}"
elif [ -d "${STATIC_DIR_VALUE}" ]; then
  mv "${STATIC_DIR_VALUE}" "${STATIC_DIR_VALUE}-old-$(date +%s)-$$"
  ln -sfn "${STATIC_NEW}" "${STATIC_DIR_VALUE}"
else
  ln -sfn "${STATIC_NEW}" "${STATIC_DIR_VALUE}"
fi
echo "==> Static files switched to ${STATIC_NEW}"

# Update current link
ln -sfn "${RELEASE_DIR}" "${CURRENT_LINK}"
echo "==> current -> ${RELEASE_DIR}"

# NGINX healthz check (if applicable)
if [ -n "${NGINX_LISTEN_PORT:-}" ]; then
  wait_http "http://127.0.0.1:${NGINX_LISTEN_PORT}/healthz" 10 || true
fi

# ---------------------------------------------------------------
# Step 10: Cleanup old releases (keep latest 3) + old static dirs
# ---------------------------------------------------------------
ls -1dt "${RELEASES_DIR}"/* 2>/dev/null | tail -n +4 | xargs -r rm -rf
ls -1dt "${STATIC_DIR_VALUE}"-* 2>/dev/null | tail -n +4 | xargs -r rm -rf

echo "==> Deployment of ${GH_SHA:0:7} complete!"
