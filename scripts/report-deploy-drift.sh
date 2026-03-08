#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "${ROOT_DIR}"

print_ref() {
  local ref="$1"
  if git rev-parse --verify "${ref}" >/dev/null 2>&1; then
    printf '%-20s %s\n' "${ref}" "$(git rev-parse --short "${ref}")"
  else
    printf '%-20s %s\n' "${ref}" "(missing)"
  fi
}

echo "== Local Git refs =="
print_ref "main"
print_ref "origin/main"

echo
echo "== Local config checkpoints =="
grep -nE '^(API_PORT|API_PORT_INTERNAL|WEB_ORIGIN|CSRF_COOKIE_SECURE|FEISHU_FIELD_CLICK_ID|FEISHU_FIELD_CLICK_ID_SOURCE_KEY|FEISHU_FIELD_TRACKING_PARAMS|FEISHU_FIELD_TRACKING_ID|FEISHU_FIELD_TRACKING_ID_TYPE|FEISHU_SUBMISSION_SOURCE|FEISHU_ALERT_ENABLED)=' backend.env.example apps/api/.env.example || true

echo
echo "== Local compose pass-through =="
grep -nE 'FEISHU_FIELD_CLICK_ID|FEISHU_FIELD_CLICK_ID_SOURCE_KEY|FEISHU_FIELD_TRACKING_PARAMS|FEISHU_FIELD_TRACKING_ID|FEISHU_FIELD_TRACKING_ID_TYPE|FEISHU_SUBMISSION_SOURCE' docker-compose.production.yml || true

if [[ -z "${SSH_HOST:-}" ]]; then
  echo
  echo "SSH_HOST is not set; skipping remote read-only checks."
  echo "Usage:"
  echo "  SSH_HOST=root@121.40.214.5 SSH_KEY_PATH=/path/to/key ./scripts/report-deploy-drift.sh"
  exit 0
fi

SSH_ARGS=(-o BatchMode=yes -o StrictHostKeyChecking=accept-new)
if [[ -n "${SSH_KEY_PATH:-}" ]]; then
  SSH_ARGS=(-i "${SSH_KEY_PATH}" "${SSH_ARGS[@]}")
fi

echo
echo "== Remote read-only checks (${SSH_HOST}) =="

ssh "${SSH_ARGS[@]}" "${SSH_HOST}" 'bash -s' <<'REMOTE'
set -euo pipefail

prod_release="$(basename "$(readlink -f /opt/web-fbif-form/current 2>/dev/null || echo 'N/A')")"
preview_release="$(basename "$(readlink -f /opt/web-fbif-form-staging/current 2>/dev/null || echo 'N/A')")"

echo "prod_release ${prod_release}"
echo "preview_release ${preview_release}"

echo
echo "-- prod env --"
grep -nE '^(WEB_ORIGIN|API_PORT|POSTGRES_DB|FEISHU_SUBMISSION_SOURCE|FEISHU_FIELD_CLICK_ID|FEISHU_FIELD_CLICK_ID_SOURCE_KEY|FEISHU_FIELD_TRACKING_PARAMS|FEISHU_FIELD_TRACKING_ID|FEISHU_FIELD_TRACKING_ID_TYPE)=' /opt/web-fbif-form/shared/backend.env || true

echo
echo "-- preview env --"
grep -nE '^(WEB_ORIGIN|API_PORT|POSTGRES_DB|FEISHU_SUBMISSION_SOURCE|FEISHU_FIELD_CLICK_ID|FEISHU_FIELD_CLICK_ID_SOURCE_KEY|FEISHU_FIELD_TRACKING_PARAMS|FEISHU_FIELD_TRACKING_ID|FEISHU_FIELD_TRACKING_ID_TYPE)=' /opt/web-fbif-form-staging/shared/backend.env || true

echo
echo "-- prod submission tracking columns --"
docker exec -i fbif-form-postgres-1 psql -U fbif -d fbif_form -AXqt <<'SQL'
SELECT column_name
FROM information_schema.columns
WHERE table_schema='public'
  AND table_name='Submission'
  AND column_name IN ('clickId','clickIdSourceKey','trackingParams','trackingId','trackingIdType')
ORDER BY ordinal_position;
SQL

echo
echo "-- preview submission tracking columns --"
docker exec -i fbif-form-staging-postgres-1 psql -U fbif -d fbif_form_staging -AXqt <<'SQL'
SELECT column_name
FROM information_schema.columns
WHERE table_schema='public'
  AND table_name='Submission'
  AND column_name IN ('clickId','clickIdSourceKey','trackingParams','trackingId','trackingIdType')
ORDER BY ordinal_position;
SQL
REMOTE
