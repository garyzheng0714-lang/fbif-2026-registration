#!/usr/bin/env bash

set -euo pipefail

if [[ -z "${ALIYUN_CDN_ACCESS_KEY_ID:-}" || -z "${ALIYUN_CDN_ACCESS_KEY_SECRET:-}" ]]; then
  echo "CDN purge skipped: missing ALIYUN_CDN_ACCESS_KEY_ID or ALIYUN_CDN_ACCESS_KEY_SECRET."
  exit 0
fi

CDN_DOMAIN="${CDN_DOMAIN:-https://fbif2026ticket.foodtalks.cn}"
CDN_OBJECT_PATHS="${CDN_OBJECT_PATHS:-${CDN_DOMAIN}/index.html}"
CDN_OBJECT_TYPE="${CDN_OBJECT_TYPE:-File}"
CDN_API_ENDPOINT="${CDN_API_ENDPOINT:-https://cdn.aliyuncs.com}"

python3 - <<'PY'
import base64
import hashlib
import hmac
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from uuid import uuid4

access_key_id = os.environ["ALIYUN_CDN_ACCESS_KEY_ID"].strip()
access_key_secret = os.environ["ALIYUN_CDN_ACCESS_KEY_SECRET"].strip()
endpoint = os.environ["CDN_API_ENDPOINT"].strip()
object_paths = os.environ["CDN_OBJECT_PATHS"].strip()
object_type = os.environ["CDN_OBJECT_TYPE"].strip()

if not object_paths:
  print("CDN purge skipped: CDN_OBJECT_PATHS is empty.")
  sys.exit(0)

params = {
  "Action": "RefreshObjectCaches",
  "Format": "JSON",
  "Version": "2018-05-10",
  "AccessKeyId": access_key_id,
  "SignatureMethod": "HMAC-SHA1",
  "SignatureVersion": "1.0",
  "SignatureNonce": str(uuid4()),
  "Timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
  "ObjectPath": object_paths,
  "ObjectType": object_type,
}

def percent_encode(value: str) -> str:
  return urllib.parse.quote(value, safe="~")

sorted_items = sorted(params.items(), key=lambda x: x[0])
canonicalized = "&".join(f"{percent_encode(k)}={percent_encode(v)}" for k, v in sorted_items)
string_to_sign = "GET&%2F&" + percent_encode(canonicalized)
signature = base64.b64encode(
  hmac.new((access_key_secret + "&").encode("utf-8"), string_to_sign.encode("utf-8"), hashlib.sha1).digest()
).decode("utf-8")

params["Signature"] = signature
request_url = endpoint + "/?" + urllib.parse.urlencode(params)

request = urllib.request.Request(request_url, method="GET")
try:
  with urllib.request.urlopen(request, timeout=20) as resp:
    payload = resp.read().decode("utf-8")
except Exception as exc:
  print(f"CDN purge failed: request error: {exc}", file=sys.stderr)
  sys.exit(1)

try:
  data = json.loads(payload)
except json.JSONDecodeError:
  print(f"CDN purge failed: non-JSON response: {payload}", file=sys.stderr)
  sys.exit(1)

if "RequestId" not in data:
  print(f"CDN purge failed: {json.dumps(data, ensure_ascii=False)}", file=sys.stderr)
  sys.exit(1)

print("CDN purge succeeded.")
print(json.dumps(data, ensure_ascii=False))
PY
