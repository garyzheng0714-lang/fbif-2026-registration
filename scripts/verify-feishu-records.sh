#!/usr/bin/env bash
# verify-feishu-records.sh — 从飞书多维表格读取最近的记录并输出字段值
# 用法: BACKEND_ENV_FILE=/path/to/backend.env bash scripts/verify-feishu-records.sh [record_count]
set -euo pipefail

RECORD_COUNT="${1:-5}"
ENV_FILE="${BACKEND_ENV_FILE:-}"

if [ -z "$ENV_FILE" ] || [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: BACKEND_ENV_FILE not set or not found" >&2
  exit 1
fi

# Read credentials from backend.env
get_val() { grep "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2-; }

APP_ID="$(get_val FEISHU_APP_ID)"
APP_SECRET="$(get_val FEISHU_APP_SECRET)"
APP_TOKEN="$(get_val FEISHU_APP_TOKEN)"
TABLE_ID="$(get_val FEISHU_TABLE_ID)"

if [ -z "$APP_ID" ] || [ -z "$APP_SECRET" ] || [ -z "$APP_TOKEN" ] || [ -z "$TABLE_ID" ]; then
  echo "ERROR: Missing FEISHU credentials in $ENV_FILE" >&2
  exit 1
fi

# Get tenant access token
TOKEN_RESP=$(curl -s --max-time 10 -X POST \
  "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal" \
  -H "Content-Type: application/json" \
  -d "{\"app_id\":\"$APP_ID\",\"app_secret\":\"$APP_SECRET\"}")

TENANT_TOKEN=$(echo "$TOKEN_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tenant_access_token',''))" 2>/dev/null || true)
if [ -z "$TENANT_TOKEN" ]; then
  echo "ERROR: Failed to get tenant token: $TOKEN_RESP" >&2
  exit 1
fi

echo "=== 飞书多维表格验证 (最近 $RECORD_COUNT 条记录) ==="
echo ""

# Read recent records
RECORDS_RESP=$(curl -s --max-time 15 -X POST \
  "https://open.feishu.cn/open-apis/bitable/v1/apps/$APP_TOKEN/tables/$TABLE_ID/records/search?page_size=$RECORD_COUNT" \
  -H "Authorization: Bearer $TENANT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sort":[{"field_name":"创建时间","desc":true}]}' 2>/dev/null || \
  curl -s --max-time 15 \
  "https://open.feishu.cn/open-apis/bitable/v1/apps/$APP_TOKEN/tables/$TABLE_ID/records?page_size=$RECORD_COUNT&sort=%5B%7B%22field_name%22%3A%22%E5%88%9B%E5%BB%BA%E6%97%B6%E9%97%B4%22%2C%22desc%22%3Atrue%7D%5D" \
  -H "Authorization: Bearer $TENANT_TOKEN" 2>/dev/null)

# Parse and display records
python3 << 'PYEOF'
import json, sys

try:
    data = json.loads(sys.stdin.read())
except:
    print("ERROR: Failed to parse Feishu response")
    sys.exit(1)

if data.get("code", -1) != 0:
    print(f"ERROR: Feishu API error: code={data.get('code')} msg={data.get('msg')}")
    sys.exit(1)

items = data.get("data", {}).get("items", [])
if not items:
    print("No records found")
    sys.exit(0)

print(f"Found {len(items)} records:\n")

for i, item in enumerate(items):
    record_id = item.get("record_id", "?")
    fields = item.get("fields", {})
    print(f"--- Record {i+1}: {record_id} ---")
    for key, val in fields.items():
        # Handle different value types
        if isinstance(val, list):
            # Could be attachments or multi-select
            display = ", ".join(str(v.get("text", v) if isinstance(v, dict) else v) for v in val)
        elif isinstance(val, dict):
            display = val.get("text", val.get("value", str(val)))
        else:
            display = str(val)
        # Mask sensitive data (phone, ID)
        if "手机" in key and len(display) >= 7:
            display = display[:3] + "****" + display[-4:]
        if "证件号码" in key and len(display) >= 10:
            display = display[:6] + "********" + display[-4:]
        print(f"  {key}: {display}")
    print()

print(f"Total: {len(items)} records verified")
PYEOF
<<< "$RECORDS_RESP"

echo ""
echo "=== 验证完成 ==="
