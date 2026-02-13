#!/bin/sh
set -eu

if [ "${RUN_DB_MIGRATE:-true}" = "true" ]; then
  echo "[entrypoint] Running prisma migrate deploy..."
  npx prisma migrate deploy
fi

worker_pid=""
if [ "${RUN_WORKER:-true}" = "true" ]; then
  echo "[entrypoint] Starting background worker..."
  node dist/worker.js &
  worker_pid="$!"
fi

shutdown() {
  if [ -n "${worker_pid}" ]; then
    echo "[entrypoint] Stopping background worker..."
    kill "${worker_pid}" 2>/dev/null || true
    wait "${worker_pid}" 2>/dev/null || true
  fi
}

trap shutdown INT TERM EXIT

echo "[entrypoint] Starting API server..."
api_status=0
node dist/index.js || api_status="$?"
exit "${api_status}"
