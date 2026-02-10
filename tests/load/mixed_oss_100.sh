#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://112.124.103.65:8080}"
OUT_JSONL="${OUT_JSONL:-/tmp/fbif-load-results.jsonl}"

INDUSTRY_USERS="${INDUSTRY_USERS:-60}"
CONSUMER_USERS="${CONSUMER_USERS:-40}"

# Comma-separated file specs: /path:sizeBytes:filename
# Example: /tmp/fbif-load-20mb.bin:20971520:proof.bin
FILES_SPECS="${FILES_SPECS:-/tmp/fbif-load-20mb.bin:20971520:proof.bin}"

MAX_TIME_UPLOAD="${MAX_TIME_UPLOAD:-300}"
MAX_TIME_API="${MAX_TIME_API:-30}"

rm -f "$OUT_JSONL"

json_escape() {
  python3 - <<'PY' "$1"
import json,sys
print(json.dumps(sys.argv[1]))
PY
}

get_csrf() {
  local cookie_jar="$1"
  local csrf_json
  csrf_json=$(curl -fsS --max-time "$MAX_TIME_API" -c "$cookie_jar" "$API_BASE/api/csrf")
  python3 - <<'PY' "$csrf_json"
import json,sys
print(json.loads(sys.argv[1])["csrfToken"])
PY
}

get_policy_json() {
  local cookie_jar="$1"
  local token="$2"
  local filename="$3"
  local size="$4"

  curl -fsS --max-time "$MAX_TIME_API" \
    -b "$cookie_jar" \
    -H "Content-Type: application/json" \
    -H "X-CSRF-Token: $token" \
    -d "{\"filename\":\"$filename\",\"size\":$size}" \
    "$API_BASE/api/oss/policy"
}

oss_upload() {
  local pol_json="$1"
  local file_path="$2"

  local host key policy ak sig
  host=$(python3 - <<'PY' "$pol_json"
import json,sys
print(json.loads(sys.argv[1])["host"])
PY
)
  key=$(python3 - <<'PY' "$pol_json"
import json,sys
print(json.loads(sys.argv[1])["fields"]["key"])
PY
)
  policy=$(python3 - <<'PY' "$pol_json"
import json,sys
print(json.loads(sys.argv[1])["fields"]["policy"])
PY
)
  ak=$(python3 - <<'PY' "$pol_json"
import json,sys
print(json.loads(sys.argv[1])["fields"]["OSSAccessKeyId"])
PY
)
  sig=$(python3 - <<'PY' "$pol_json"
import json,sys
print(json.loads(sys.argv[1])["fields"]["Signature"])
PY
)

  curl -sS --max-time "$MAX_TIME_UPLOAD" -o /dev/null -w "%{http_code}" \
    -F "key=$key" \
    -F "policy=$policy" \
    -F "OSSAccessKeyId=$ak" \
    -F "Signature=$sig" \
    -F "success_action_status=200" \
    -F "file=@$file_path" \
    "$host"
}

policy_public_url() {
  python3 - <<'PY' "$1"
import json,sys
print(json.loads(sys.argv[1])["publicUrl"])
PY
}

submit_json() {
  local cookie_jar="$1"
  local token="$2"
  local json_payload="$3"

  curl -fsS --max-time "$MAX_TIME_API" \
    -b "$cookie_jar" \
    -H "Content-Type: application/json" \
    -H "X-CSRF-Token: $token" \
    -d "$json_payload" \
    "$API_BASE/api/submissions"
}

run_industry_user() {
  local idx="$1"

  local cookie_jar
  cookie_jar=$(mktemp "/tmp/fbif-cookie-industry-$idx.XXXXXX")

  local started_ms
  started_ms=$(python3 - <<'PY'
import time
print(int(time.time()*1000))
PY
)

  local token
  token=$(get_csrf "$cookie_jar")

  local urls=()
  local upload_codes=()

  IFS=',' read -r -a specs <<< "$FILES_SPECS"
  for spec in "${specs[@]}"; do
    IFS=':' read -r file_path size_bytes filename <<< "$spec"

    local pol_json
    pol_json=$(get_policy_json "$cookie_jar" "$token" "$filename" "$size_bytes")

    local code
    code=$(oss_upload "$pol_json" "$file_path" || true)
    upload_codes+=("$code")

    local url
    url=$(policy_public_url "$pol_json")
    urls+=("$url")
  done

  local proofUrlsJson
  proofUrlsJson=$(python3 - <<'PY' "${urls[@]}"
import json,sys
print(json.dumps(list(sys.argv[1:])))
PY
)

  local payload
  payload=$(cat <<JSON
{"role":"industry","phone":"1380000$(printf '%04d' "$idx")","name":"用户$(printf '%02d' "$idx")","title":"岗位","company":"公司$(printf '%02d' "$idx")","idType":"other","idNumber":"USER$(printf '%04d' "$idx")X","businessType":"其他","department":"其他","proofUrls":$proofUrlsJson}
JSON
)

  local resp
  resp=$(submit_json "$cookie_jar" "$token" "$payload" || true)

  local finished_ms
  finished_ms=$(python3 - <<'PY'
import time
print(int(time.time()*1000))
PY
)

  python3 - <<'PY' "$resp" "$idx" "$started_ms" "$finished_ms" "${upload_codes[*]}" >> "$OUT_JSONL"
import json,sys
resp_raw=sys.argv[1]
idx=int(sys.argv[2])
started=int(sys.argv[3])
finished=int(sys.argv[4])
upload_codes=sys.argv[5].split() if len(sys.argv)>5 else []

ok=False
submission_id=None
trace_id=None
error=None
try:
  data=json.loads(resp_raw)
  submission_id=data.get('id')
  trace_id=data.get('traceId')
  ok=bool(submission_id)
except Exception as e:
  error=str(e)

print(json.dumps({
  "kind":"industry",
  "idx": idx,
  "ok": ok,
  "submissionId": submission_id,
  "traceId": trace_id,
  "uploadHttpCodes": upload_codes,
  "apiMs": finished-started,
  "raw": resp_raw if not ok else None,
  "error": error,
}))
PY

  rm -f "$cookie_jar"
}

run_consumer_user() {
  local idx="$1"

  local cookie_jar
  cookie_jar=$(mktemp "/tmp/fbif-cookie-consumer-$idx.XXXXXX")

  local started_ms
  started_ms=$(python3 - <<'PY'
import time
print(int(time.time()*1000))
PY
)

  local token
  token=$(get_csrf "$cookie_jar")

  local payload
  payload=$(cat <<JSON
{"role":"consumer","phone":"1390000$(printf '%04d' "$idx")","name":"用户$(printf '%02d' "$idx")","title":"消费者","company":"个人消费者","idType":"other","idNumber":"CONS$(printf '%04d' "$idx")X"}
JSON
)

  local resp
  resp=$(submit_json "$cookie_jar" "$token" "$payload" || true)

  local finished_ms
  finished_ms=$(python3 - <<'PY'
import time
print(int(time.time()*1000))
PY
)

  python3 - <<'PY' "$resp" "$idx" "$started_ms" "$finished_ms" >> "$OUT_JSONL"
import json,sys
resp_raw=sys.argv[1]
idx=int(sys.argv[2])
started=int(sys.argv[3])
finished=int(sys.argv[4])

ok=False
submission_id=None
trace_id=None
error=None
try:
  data=json.loads(resp_raw)
  submission_id=data.get('id')
  trace_id=data.get('traceId')
  ok=bool(submission_id)
except Exception as e:
  error=str(e)

print(json.dumps({
  "kind":"consumer",
  "idx": idx,
  "ok": ok,
  "submissionId": submission_id,
  "traceId": trace_id,
  "apiMs": finished-started,
  "raw": resp_raw if not ok else None,
  "error": error,
}))
PY

  rm -f "$cookie_jar"
}

main() {
  echo "API_BASE=$API_BASE"
  echo "INDUSTRY_USERS=$INDUSTRY_USERS CONSUMER_USERS=$CONSUMER_USERS"
  echo "FILES_SPECS=$FILES_SPECS"
  echo "OUT_JSONL=$OUT_JSONL"

  local total=$((INDUSTRY_USERS + CONSUMER_USERS))
  echo "starting $total jobs..."

  local i
  for i in $(seq 1 "$INDUSTRY_USERS"); do
    run_industry_user "$i" &
  done

  for i in $(seq 1 "$CONSUMER_USERS"); do
    run_consumer_user "$i" &
  done

  wait

  echo "done"

  python3 - <<'PY' "$OUT_JSONL"
import json,sys
path=sys.argv[1]
rows=[json.loads(line) for line in open(path,'r',encoding='utf-8') if line.strip()]

kinds={}
for r in rows:
  kinds.setdefault(r['kind'], []).append(r)

print('results_total', len(rows))
for k,v in kinds.items():
  ok=sum(1 for r in v if r.get('ok'))
  print('results', k, 'ok', ok, 'fail', len(v)-ok)

# Upload code histogram for industry
codes={}
for r in kinds.get('industry', []):
  for c in r.get('uploadHttpCodes', []) or []:
    codes[c]=codes.get(c,0)+1
print('upload_http_codes', dict(sorted(codes.items(), key=lambda kv: (-kv[1], kv[0]))))

api_ms=[r.get('apiMs') for r in rows if isinstance(r.get('apiMs'), int)]
api_ms.sort()
if api_ms:
  p95=api_ms[int(len(api_ms)*0.95)-1]
  p50=api_ms[int(len(api_ms)*0.50)-1]
  print('api_ms_p50', p50)
  print('api_ms_p95', p95)
PY
}

main "$@"
