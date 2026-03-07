#!/bin/sh
set -eu

if [ "${RUN_DB_MIGRATE:-true}" = "true" ]; then
  echo "[entrypoint] Running prisma migrate deploy..."
  npx prisma migrate deploy
fi

api_pid=""
worker_pid=""

shutdown() {
  echo "[entrypoint] Shutting down..."
  if [ -n "${api_pid}" ]; then
    echo "[entrypoint] Sending SIGTERM to API (PID=${api_pid})..."
    kill -TERM "${api_pid}" 2>/dev/null || true
  fi
  if [ -n "${worker_pid}" ]; then
    echo "[entrypoint] Sending SIGTERM to Worker (PID=${worker_pid})..."
    kill -TERM "${worker_pid}" 2>/dev/null || true
  fi
  [ -n "${api_pid}" ] && wait "${api_pid}" 2>/dev/null || true
  [ -n "${worker_pid}" ] && wait "${worker_pid}" 2>/dev/null || true
  echo "[entrypoint] All processes stopped."
  exit 0
}

trap shutdown INT TERM

if [ "${RUN_WORKER:-true}" = "true" ]; then
  echo "[entrypoint] Starting background worker..."
  node dist/worker.js &
  worker_pid="$!"
fi

echo "[entrypoint] Starting API server..."
node dist/index.js &
api_pid="$!"

# Monitor: poll child processes. SIGTERM triggers trap immediately (interrupts sleep).
while true; do
  sleep 2

  if [ -n "${api_pid}" ] && ! kill -0 "${api_pid}" 2>/dev/null; then
    echo "[entrypoint] FATAL: API process (PID=${api_pid}) died. Shutting down."
    if [ -n "${worker_pid}" ]; then
      kill -TERM "${worker_pid}" 2>/dev/null || true
      wait "${worker_pid}" 2>/dev/null || true
    fi
    exit 1
  fi

  if [ -n "${worker_pid}" ] && ! kill -0 "${worker_pid}" 2>/dev/null; then
    echo "[entrypoint] FATAL: Worker process (PID=${worker_pid}) died. Shutting down."
    if [ -n "${api_pid}" ]; then
      kill -TERM "${api_pid}" 2>/dev/null || true
      wait "${api_pid}" 2>/dev/null || true
    fi
    exit 1
  fi
done
