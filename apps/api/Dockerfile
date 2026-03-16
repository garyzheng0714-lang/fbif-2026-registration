# syntax=docker/dockerfile:1.7

FROM node:20-bookworm AS base
WORKDIR /app

ENV npm_config_update_notifier=false \
    npm_config_fund=false \
    npm_config_audit=false

COPY apps/api/package*.json ./
RUN npm ci

FROM base AS build
COPY apps/api/ ./
RUN npm run prisma:generate
RUN npm run build

FROM node:20-bookworm AS runtime
WORKDIR /app

RUN npm install -g pm2

ENV NODE_ENV=production

COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/dist ./dist
COPY --from=build /app/ecosystem.config.cjs ./ecosystem.config.cjs
COPY apps/api/docker/entrypoint.sh /entrypoint.sh
COPY apps/api/docker/entrypoint-pm2.sh /entrypoint-pm2.sh

RUN chmod +x /entrypoint.sh /entrypoint-pm2.sh

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["/entrypoint-pm2.sh"]
