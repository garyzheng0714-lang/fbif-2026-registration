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
  echo "[entrypoint] Shutting down..."
  if [ -n "${worker_pid}" ]; then
    echo "[entrypoint] Stopping background worker (PID=${worker_pid})..."
    kill "${worker_pid}" 2>/dev/null || true
    wait "${worker_pid}" 2>/dev/null || true
  fi
}

trap shutdown INT TERM EXIT

# Monitor worker health: if worker crashes, the entire container must exit
# so Docker restarts both API + worker together.
if [ -n "${worker_pid}" ]; then
  (
    while true; do
      if ! kill -0 "${worker_pid}" 2>/dev/null; then
        echo "[entrypoint] FATAL: worker process (PID=${worker_pid}) died unexpectedly. Exiting container."
        # Send TERM to the main API process (PID 1 in container = this script's child)
        kill $$ 2>/dev/null || true
        exit 1
      fi
      sleep 5
    done
  ) &
  monitor_pid="$!"
fi

echo "[entrypoint] Starting API server..."
api_status=0
node dist/index.js || api_status="$?"

# Clean up monitor if API exits first
if [ -n "${monitor_pid:-}" ]; then
  kill "${monitor_pid}" 2>/dev/null || true
fi

exit "${api_status}"
