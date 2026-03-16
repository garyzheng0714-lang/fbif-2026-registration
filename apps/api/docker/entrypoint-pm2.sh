#!/bin/sh
set -eu

if [ "${RUN_DB_MIGRATE:-true}" = "true" ]; then
  echo "[entrypoint-pm2] Running prisma migrate deploy..."
  npx prisma migrate deploy
fi

echo "[entrypoint-pm2] Starting PM2 runtime..."
exec pm2-runtime ecosystem.config.cjs
