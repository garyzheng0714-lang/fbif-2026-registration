import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';

function buildDatabaseUrlWithPoolParams(databaseUrl: string) {
  // Prisma reads pool settings from the connection string query params.
  // See: https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections
  try {
    const u = new URL(databaseUrl);
    if (env.DB_POOL_CONNECTION_LIMIT && !u.searchParams.has('connection_limit')) {
      u.searchParams.set('connection_limit', String(env.DB_POOL_CONNECTION_LIMIT));
    }
    if (env.DB_POOL_TIMEOUT_S && !u.searchParams.has('pool_timeout')) {
      u.searchParams.set('pool_timeout', String(env.DB_POOL_TIMEOUT_S));
    }
    return u.toString();
  } catch {
    return databaseUrl;
  }
}

export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: buildDatabaseUrlWithPoolParams(env.DATABASE_URL)
    }
  },
  log: ['error', 'warn']
});
