#!/usr/bin/env bash
# post-deploy-verify.sh — End-to-end verification after deployment.
#
# Validates the full request lifecycle:
#   1. Health check (API running)
#   2. CSRF flow (cookie + token acquisition)
#   3. Identity verification (Aliyun real-name API)
#   4. Form submission (database write + BullMQ enqueue)
#   5. Feishu sync polling (async sync to Bitable)
#
# Usage:
#   API_PORT=8080 bash scripts/post-deploy-verify.sh
#
# Environment:
#   API_PORT         — API port (default: 8080)
#   VERIFY_NAME      — Name for id-verify (default: test value)
#   VERIFY_ID        — ID number for id-verify (default: test value)
#   VERIFY_PHONE     — Phone for submission (default: 13800000001)
#   SYNC_POLL_MAX    — Max polls for sync status (default: 30)
#   SKIP_SUBMISSION  — Set to "true" to skip submission + sync (id-verify only)
#   SKIP_ID_VERIFY   — Set to "true" to skip id-verify (health + csrf only)

set -euo pipefail

API_PORT="${API_PORT:-8080}"
API_BASE="http://127.0.0.1:${API_PORT}"
SYNC_POLL_MAX="${SYNC_POLL_MAX:-30}"

VERIFY_NAME="${VERIFY_NAME:-郑梽煌}"
VERIFY_ID="${VERIFY_ID:-35052519981217001X}"
VERIFY_PHONE="${VERIFY_PHONE:-13800000001}"

PASS=0
FAIL=0
WARN=0

ok()   { PASS=$((PASS + 1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  ❌ $1" >&2; }
warn() { WARN=$((WARN + 1)); echo "  ⚠️  $1"; }

cleanup() {
  rm -f /tmp/_verify_csrf.hdr /tmp/_verify_idv.json /tmp/_verify_sub.json /tmp/_verify_status.json
}
trap cleanup EXIT

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║      FBIF Post-Deploy Verification Suite        ║"
echo "╠══════════════════════════════════════════════════╣"
echo "║  Target: ${API_BASE}"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# ---------------------------------------------------------------
# Step 1: Health check
# ---------------------------------------------------------------
echo "--- Step 1/5: Health check ---"

HEALTH=$(curl -fsS "${API_BASE}/health" 2>/dev/null || echo "CURL_FAIL")
if [ "${HEALTH}" = "CURL_FAIL" ]; then
  fail "Cannot reach ${API_BASE}/health"
  echo ""
  echo "RESULT: ${PASS} passed, ${FAIL} failed, ${WARN} warnings"
  exit 1
fi

HEALTH_OK=$(echo "${HEALTH}" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('ok',''))" 2>/dev/null || echo "")
if [ "${HEALTH_OK}" = "True" ] || [ "${HEALTH_OK}" = "true" ]; then
  ok "Health check passed"
  SHA=$(echo "${HEALTH}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('sha','unknown'))" 2>/dev/null || echo "unknown")
  echo "     SHA: ${SHA}"
else
  fail "Health check returned unexpected body: ${HEALTH}"
  echo ""
  echo "RESULT: ${PASS} passed, ${FAIL} failed, ${WARN} warnings"
  exit 1
fi

# ---------------------------------------------------------------
# Step 2: CSRF flow
# ---------------------------------------------------------------
echo ""
echo "--- Step 2/5: CSRF token acquisition ---"

# Production _csrf cookie has Secure flag — curl won't send it over plain HTTP.
# Extract cookie value from Set-Cookie header and pass it manually.
HTTP_CODE=$(curl -sS -o /tmp/_verify_csrf.body -D /tmp/_verify_csrf.hdr \
  -w "%{http_code}" \
  "${API_BASE}/api/csrf" 2>/dev/null || echo "000")

if [ "${HTTP_CODE}" != "200" ]; then
  fail "CSRF endpoint returned HTTP ${HTTP_CODE}"
  echo ""
  echo "RESULT: ${PASS} passed, ${FAIL} failed, ${WARN} warnings"
  exit 1
fi

CSRF_TOKEN=$(python3 -c "import sys,json; print(json.load(open('/tmp/_verify_csrf.body')).get('csrfToken',''))" 2>/dev/null || echo "")
if [ -z "${CSRF_TOKEN}" ]; then
  fail "CSRF response missing csrfToken"
  exit 1
fi

CSRF_COOKIE=$(grep -i 'set-cookie:.*_csrf=' /tmp/_verify_csrf.hdr | sed -E 's/^[^:]+:\s*_csrf=([^;]+).*/\1/' | head -1)
if [ -z "${CSRF_COOKIE}" ]; then
  fail "CSRF response missing _csrf cookie in Set-Cookie header"
  exit 1
fi

ok "CSRF token acquired (${#CSRF_TOKEN} chars)"
ok "CSRF cookie extracted"

CURL_AUTH=(-b "_csrf=${CSRF_COOKIE}" -H "X-CSRF-Token: ${CSRF_TOKEN}" -H "Content-Type: application/json")

# ---------------------------------------------------------------
# Step 3: Identity verification
# ---------------------------------------------------------------
echo ""
echo "--- Step 3/5: Identity verification (Aliyun real-name API) ---"

if [ "${SKIP_ID_VERIFY:-}" = "true" ]; then
  warn "Skipped (SKIP_ID_VERIFY=true)"
  VERIFY_TOKEN=""
else
  IDV_CODE=$(curl -sS -o /tmp/_verify_idv.json -w "%{http_code}" \
    "${CURL_AUTH[@]}" \
    -X POST "${API_BASE}/api/id-verify" \
    -d "{\"name\":\"${VERIFY_NAME}\",\"idType\":\"cn_id\",\"idNumber\":\"${VERIFY_ID}\"}" \
    2>/dev/null || echo "000")

  if [ "${IDV_CODE}" = "200" ]; then
    IDV_VERIFIED=$(python3 -c "import sys,json; print(json.load(open('/tmp/_verify_idv.json')).get('verified',''))" 2>/dev/null || echo "")
    VERIFY_TOKEN=$(python3 -c "import sys,json; print(json.load(open('/tmp/_verify_idv.json')).get('verificationToken',''))" 2>/dev/null || echo "")

    if [ "${IDV_VERIFIED}" = "True" ] || [ "${IDV_VERIFIED}" = "true" ]; then
      ok "Identity verified: ${VERIFY_NAME}"
      ok "Verification token obtained (${#VERIFY_TOKEN} chars)"
    else
      fail "Identity verification returned verified=${IDV_VERIFIED}"
      cat /tmp/_verify_idv.json 2>/dev/null || true
      VERIFY_TOKEN=""
    fi
  elif [ "${IDV_CODE}" = "429" ]; then
    warn "Identity verification rate-limited (HTTP 429) — skipping, non-fatal"
    VERIFY_TOKEN=""
  elif [ "${IDV_CODE}" = "503" ] || [ "${IDV_CODE}" = "502" ]; then
    warn "Identity verification upstream unavailable (HTTP ${IDV_CODE}) — skipping, non-fatal"
    VERIFY_TOKEN=""
  else
    fail "Identity verification returned HTTP ${IDV_CODE}"
    cat /tmp/_verify_idv.json 2>/dev/null || true
    VERIFY_TOKEN=""
  fi
fi

# ---------------------------------------------------------------
# Step 4: Form submission
# ---------------------------------------------------------------
echo ""
echo "--- Step 4/5: Form submission ---"

if [ "${SKIP_SUBMISSION:-}" = "true" ]; then
  warn "Skipped (SKIP_SUBMISSION=true)"
  SUBMISSION_ID=""
else
  CLIENT_REQ_ID="deploy-verify-$(date +%s)-$$"

  SUB_BODY=$(python3 -c "
import json, sys
body = {
    'clientRequestId': '${CLIENT_REQ_ID}',
    'role': 'industry',
    'idType': 'cn_id',
    'idNumber': '${VERIFY_ID}',
    'phone': '${VERIFY_PHONE}',
    'name': '${VERIFY_NAME}',
    'title': '部署验证',
    'company': 'FBIF部署验证',
    'businessType': '其他',
    'department': '其他',
    'proofUrls': ['https://fbif2026ticket.foodtalks.cn/placeholder-proof.jpg']
}
token = '${VERIFY_TOKEN}'
if token:
    body['idVerifyToken'] = token
print(json.dumps(body, ensure_ascii=False))
")

  SUB_CODE=$(curl -sS -o /tmp/_verify_sub.json -w "%{http_code}" \
    "${CURL_AUTH[@]}" \
    -X POST "${API_BASE}/api/submissions" \
    -d "${SUB_BODY}" \
    2>/dev/null || echo "000")

  if [ "${SUB_CODE}" = "202" ]; then
    SUBMISSION_ID=$(python3 -c "import sys,json; print(json.load(open('/tmp/_verify_sub.json')).get('id',''))" 2>/dev/null || echo "")
    TRACE_ID=$(python3 -c "import sys,json; print(json.load(open('/tmp/_verify_sub.json')).get('traceId',''))" 2>/dev/null || echo "")
    ok "Submission accepted (HTTP 202)"
    echo "     ID: ${SUBMISSION_ID}"
    echo "     Trace: ${TRACE_ID}"
  elif [ "${SUB_CODE}" = "409" ]; then
    warn "Submission returned 409 (duplicate clientRequestId) — non-fatal"
    SUBMISSION_ID=""
  elif [ "${SUB_CODE}" = "429" ]; then
    warn "Submission rate-limited (HTTP 429) — non-fatal"
    SUBMISSION_ID=""
  else
    fail "Submission returned HTTP ${SUB_CODE}"
    cat /tmp/_verify_sub.json 2>/dev/null || true
    SUBMISSION_ID=""
  fi
fi

# ---------------------------------------------------------------
# Step 5: Feishu sync polling
# ---------------------------------------------------------------
echo ""
echo "--- Step 5/5: Feishu sync status ---"

if [ -z "${SUBMISSION_ID:-}" ]; then
  warn "Skipped (no submission ID)"
else
  SYNC_OK=false
  for i in $(seq 1 "${SYNC_POLL_MAX}"); do
    sleep 2

    STATUS_CODE=$(curl -fsS -o /tmp/_verify_status.json -w "%{http_code}" \
      "${API_BASE}/api/submissions/${SUBMISSION_ID}/status" \
      2>/dev/null || echo "000")

    if [ "${STATUS_CODE}" != "200" ]; then
      echo "     Poll ${i}/${SYNC_POLL_MAX}: HTTP ${STATUS_CODE}"
      continue
    fi

    SYNC_STATUS=$(python3 -c "import sys,json; print(json.load(open('/tmp/_verify_status.json')).get('syncStatus',''))" 2>/dev/null || echo "")
    FEISHU_REC=$(python3 -c "import sys,json; print(json.load(open('/tmp/_verify_status.json')).get('feishuRecordId',''))" 2>/dev/null || echo "")
    SYNC_ERR=$(python3 -c "import sys,json; print(json.load(open('/tmp/_verify_status.json')).get('syncError','') or '')" 2>/dev/null || echo "")

    echo "     Poll ${i}/${SYNC_POLL_MAX}: syncStatus=${SYNC_STATUS}"

    case "${SYNC_STATUS}" in
      SUCCESS)
        ok "Feishu sync SUCCESS (record: ${FEISHU_REC})"
        SYNC_OK=true
        break
        ;;
      FAILED)
        fail "Feishu sync FAILED: ${SYNC_ERR}"
        break
        ;;
      PENDING|PROCESSING|RETRYING)
        ;;
      *)
        warn "Unknown syncStatus: ${SYNC_STATUS}"
        ;;
    esac
  done

  if [ "${SYNC_OK}" != "true" ] && [ "${SYNC_STATUS:-}" != "FAILED" ]; then
    warn "Feishu sync did not complete within ${SYNC_POLL_MAX} polls (status: ${SYNC_STATUS:-unknown})"
  fi
fi

# ---------------------------------------------------------------
# Summary
# ---------------------------------------------------------------
echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║                  SUMMARY                        ║"
echo "╠══════════════════════════════════════════════════╣"
printf "║  ✅ Passed:   %-33s║\n" "${PASS}"
printf "║  ❌ Failed:   %-33s║\n" "${FAIL}"
printf "║  ⚠️  Warnings: %-33s║\n" "${WARN}"
echo "╚══════════════════════════════════════════════════╝"
echo ""

if [ "${FAIL}" -gt 0 ]; then
  echo "VERIFICATION FAILED — ${FAIL} check(s) did not pass."
  exit 1
fi

if [ "${WARN}" -gt 0 ]; then
  echo "VERIFICATION PASSED WITH WARNINGS — review above."
  exit 0
fi

echo "ALL CHECKS PASSED."
exit 0
