#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

ERRORS=0
WARNINGS=0

pass() {
  echo "  ✅ $1"
}

warn() {
  WARNINGS=$((WARNINGS + 1))
  echo "  ⚠️  $1"
}

fail() {
  ERRORS=$((ERRORS + 1))
  echo "  ❌ $1"
}

print_ref() {
  local ref="$1"
  if git rev-parse --verify "${ref}" >/dev/null 2>&1; then
    printf '%-20s %s\n' "${ref}" "$(git rev-parse --short "${ref}")"
  else
    printf '%-20s %s\n' "${ref}" "(missing)"
  fi
}

check_local_regex() {
  local file="$1"
  local pattern="$2"
  local label="$3"

  if [ ! -f "${file}" ]; then
    warn "${label} (missing file: ${file})"
    return 0
  fi

  if grep -Eq "${pattern}" "${file}"; then
    pass "${label}"
  else
    fail "${label}"
  fi
}

echo "== Local Git refs =="
print_ref "main"
print_ref "origin/main"

echo
echo "== Local drift checks =="
check_local_regex "apps/api/.env.example" '^TRUST_PROXY_HOPS=' "apps/api/.env.example exposes TRUST_PROXY_HOPS"
check_local_regex "apps/api/src/config/env.ts" 'TRUST_PROXY_HOPS' "env.ts defines TRUST_PROXY_HOPS in schema"
check_local_regex "deploy/Caddyfile.template" 'reverse_proxy localhost:3001' "Caddy template keeps production upstream on localhost:3001"
check_local_regex "deploy/Caddyfile.template" 'reverse_proxy localhost:3101' "Caddy template keeps preview upstream on localhost:3101"
check_local_regex "deploy/Caddyfile.template" 'rewrite \* /healthz' "Caddy template rewrites /health to /healthz"
check_local_regex "deploy/Caddyfile.template" 'X-Content-Type-Options "nosniff"' "Caddy template sets X-Content-Type-Options"
check_local_regex "deploy/Caddyfile.template" 'X-Frame-Options "DENY"' "Caddy template sets X-Frame-Options"
check_local_regex "deploy/Caddyfile.template" 'Referrer-Policy "strict-origin-when-cross-origin"' "Caddy template sets Referrer-Policy"
check_local_regex "deploy/Caddyfile.template" 'Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"' "Caddy template sets HSTS for production"

echo
echo "== Local compose pass-through checks =="
check_local_regex "docker-compose.production.yml" 'FEISHU_FIELD_CLICK_ID' "compose passes FEISHU_FIELD_CLICK_ID"
check_local_regex "docker-compose.production.yml" 'FEISHU_FIELD_CLICK_ID_SOURCE_KEY' "compose passes FEISHU_FIELD_CLICK_ID_SOURCE_KEY"
check_local_regex "docker-compose.production.yml" 'FEISHU_FIELD_TRACKING_PARAMS' "compose passes FEISHU_FIELD_TRACKING_PARAMS"
check_local_regex "docker-compose.production.yml" 'FEISHU_FIELD_TRACKING_ID' "compose passes FEISHU_FIELD_TRACKING_ID"
check_local_regex "docker-compose.production.yml" 'FEISHU_FIELD_TRACKING_ID_TYPE' "compose passes FEISHU_FIELD_TRACKING_ID_TYPE"
check_local_regex "docker-compose.production.yml" 'FEISHU_SUBMISSION_SOURCE' "compose passes FEISHU_SUBMISSION_SOURCE"

if [[ -z "${SSH_HOST:-}" ]]; then
  echo
  echo "SSH_HOST is not set; skipping remote checks."
  echo "Usage:"
  echo "  SSH_HOST=root@121.40.214.5 SSH_KEY_PATH=/path/to/key ./scripts/report-deploy-drift.sh"
  echo
  echo "Summary: ${ERRORS} errors, ${WARNINGS} warnings"
  if [ "${ERRORS}" -ne 0 ]; then
    exit 1
  fi
  exit 0
fi

SSH_ARGS=(-o BatchMode=yes -o StrictHostKeyChecking=accept-new)
if [[ -n "${SSH_KEY_PATH:-}" ]]; then
  SSH_ARGS=(-i "${SSH_KEY_PATH}" "${SSH_ARGS[@]}")
fi

echo
echo "== Remote drift checks (${SSH_HOST}) =="
if ! ssh "${SSH_ARGS[@]}" "${SSH_HOST}" 'bash -s' <<'REMOTE'
set -euo pipefail

errors=0

pass() {
  echo "  ✅ $1"
}

fail() {
  errors=$((errors + 1))
  echo "  ❌ $1"
}

check_block_has() {
  local block="$1"
  local pattern="$2"
  local label="$3"
  if echo "${block}" | grep -Eq "${pattern}"; then
    pass "${label}"
  else
    fail "${label}"
  fi
}

prod_release="$(basename "$(readlink -f /opt/web-fbif-form/current 2>/dev/null || echo 'N/A')")"
preview_release="$(basename "$(readlink -f /opt/web-fbif-form-staging/current 2>/dev/null || echo 'N/A')")"
echo "prod_release ${prod_release}"
echo "preview_release ${preview_release}"

prod_caddy="$(sed -n '/^fbif2026ticket\.foodtalks\.cn {/,/^}/p' /etc/caddy/Caddyfile 2>/dev/null || true)"
preview_caddy="$(sed -n '/^:3003 {/,/^}/p' /etc/caddy/Caddyfile 2>/dev/null || true)"

check_block_has "${prod_caddy}" 'reverse_proxy localhost:3001' "production Caddy upstream is localhost:3001"
check_block_has "${prod_caddy}" 'rewrite \* /healthz' "production Caddy rewrites /health to /healthz"
check_block_has "${preview_caddy}" 'reverse_proxy localhost:3101' "preview Caddy upstream is localhost:3101"
check_block_has "${preview_caddy}" 'rewrite \* /healthz' "preview Caddy rewrites /health to /healthz"
check_block_has "${prod_caddy}" 'X-Content-Type-Options "nosniff"' "production Caddy has X-Content-Type-Options"
check_block_has "${prod_caddy}" 'X-Frame-Options "DENY"' "production Caddy has X-Frame-Options"
check_block_has "${prod_caddy}" 'Referrer-Policy "strict-origin-when-cross-origin"' "production Caddy has Referrer-Policy"
check_block_has "${prod_caddy}" 'Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"' "production Caddy has HSTS"

if ls /etc/nginx/sites-enabled/fbif-form-staging* >/dev/null 2>&1; then
  fail "staging nginx site leaked into /etc/nginx/sites-enabled"
else
  pass "no staging nginx site in /etc/nginx/sites-enabled"
fi

remote_ports="$(docker ps --format '{{.Names}}\t{{.Ports}}' 2>/dev/null || true)"
if echo "${remote_ports}" | grep -Eq '^fbif-form-staging-api-(blue|green)[[:space:]].*127\.0\.0\.1:(8080|18080)->'; then
  fail "staging API blue/green containers are occupying production API ports"
else
  pass "staging API blue/green containers are not occupying production API ports"
fi

if grep -Eq '^TRUST_PROXY_HOPS=' /opt/web-fbif-form/shared/backend.env 2>/dev/null; then
  pass "production backend.env defines TRUST_PROXY_HOPS"
else
  fail "production backend.env missing TRUST_PROXY_HOPS"
fi

if grep -Eq '^TRUST_PROXY_HOPS=' /opt/web-fbif-form-staging/shared/backend.env 2>/dev/null; then
  pass "preview backend.env defines TRUST_PROXY_HOPS"
else
  fail "preview backend.env missing TRUST_PROXY_HOPS"
fi

echo
if [ "${errors}" -ne 0 ]; then
  echo "Remote drift check failed: ${errors} issue(s)."
  exit 1
fi

echo "Remote drift check passed."
REMOTE
then
  fail "remote drift checks failed"
else
  pass "remote drift checks passed"
fi

echo
echo "Summary: ${ERRORS} errors, ${WARNINGS} warnings"
if [ "${ERRORS}" -ne 0 ]; then
  exit 1
fi
