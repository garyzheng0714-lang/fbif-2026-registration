import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

function parseEnvBool(value: unknown, fallback = false) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') return true;
  if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false;
  return fallback;
}

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(8080),
  // Proxy hops: Caddy→Nginx = 2 (default). With CDN: CDN→Caddy→Nginx = 3.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(1).max(5).default(2),
  WEB_ORIGIN: z.string().url(),
  DATABASE_URL: z.string().min(1),
  // Prisma pool config (applied by rewriting DATABASE_URL at runtime).
  // Keep conservative defaults and tune via env for load testing / production.
  DB_POOL_CONNECTION_LIMIT: z.coerce.number().int().min(1).max(50).optional(),
  DB_POOL_TIMEOUT_S: z.coerce.number().int().min(1).max(120).optional(),
  REDIS_URL: z.string().min(1),
  DATA_KEY: z.string().min(1),
  DATA_HASH_SALT: z.string().min(8),
  FEISHU_APP_ID: z.string().min(1),
  FEISHU_APP_SECRET: z.string().min(1),
  FEISHU_APP_TOKEN: z.string().min(1),
  FEISHU_TABLE_ID: z.string().min(1),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  RATE_LIMIT_MAX: z.coerce.number().default(120),
  RATE_LIMIT_BURST: z.coerce.number().default(20),
  // Keep /api/csrf on a separate limiter so token bootstrap is resilient
  // under short traffic spikes and not throttled by generic API limits.
  CSRF_RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  CSRF_RATE_LIMIT_MAX: z.coerce.number().default(1200),
  SYNC_POLL_TIMEOUT_MS: z.coerce.number().default(30000),

  FEISHU_SYNC_ATTEMPTS: z.coerce.number().default(8),
  FEISHU_SYNC_BACKOFF_MS: z.coerce.number().default(1000),
  FEISHU_SYNC_BACKOFF_MAX_MS: z.coerce.number().default(120000),
  FEISHU_WORKER_CONCURRENCY: z.coerce.number().default(10),
  FEISHU_WORKER_QPS: z.coerce.number().default(10),
  FEISHU_SELECT_WRITE_MODE: z.enum(['label', 'option_id']).default('label'),
  FEISHU_QUEUE_HIGH_WATERMARK: z.coerce.number().default(1000),
  FEISHU_QUEUE_CRITICAL_WATERMARK: z.coerce.number().default(5000),
  FEISHU_QUEUE_PRESSURE_CACHE_MS: z.coerce.number().default(500),
  FEISHU_ENQUEUE_DELAY_HIGH_MS: z.coerce.number().default(300),
  FEISHU_ENQUEUE_DELAY_CRITICAL_MS: z.coerce.number().default(2000),
  FEISHU_RETRY_BACKOFF_HIGH_MULTIPLIER: z.coerce.number().default(1.5),
  FEISHU_RETRY_BACKOFF_CRITICAL_MULTIPLIER: z.coerce.number().default(2.5),

  MAX_PROOF_URLS: z.coerce.number().default(5),
  MAX_PROOF_URL_LENGTH: z.coerce.number().default(2048),

  OSS_ACCESS_KEY_ID: z.string().optional(),
  OSS_ACCESS_KEY_SECRET: z.string().optional(),
  OSS_BUCKET: z.string().optional(),
  OSS_REGION: z.string().optional(),
  OSS_HOST: z.string().optional(),
  OSS_PUBLIC_BASE_URL: z.string().optional(),
  OSS_UPLOAD_PREFIX: z.string().optional(),
  OSS_MAX_UPLOAD_MB: z.coerce.number().default(20),
  OSS_POLICY_EXPIRE_SECONDS: z.coerce.number().default(600),
  OSS_OBJECT_ACL: z.string().optional(),

  ID_VERIFY_ENABLED: z.boolean().default(false),
  ID_VERIFY_ALIYUN_HOST: z.string().default('https://sxidcheck.market.alicloudapi.com'),
  ID_VERIFY_ALIYUN_PATH: z.string().default('/idcard/check'),
  ID_VERIFY_APPCODE: z.string().optional(),
  ID_VERIFY_TIMEOUT_MS: z.coerce.number().int().min(1000).max(20000).default(5000),
  ID_VERIFY_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),

  // 飞书告警 Webhook (用于数据同步失败通知)
  FEISHU_ALERT_WEBHOOK: z.string().url().optional(),
  FEISHU_ALERT_ENABLED: z.boolean().default(true)
});

// Pre-process fields that need special handling before zod parsing.
// Boolean env vars need parseEnvBool (zod can't parse "yes"/"on"/etc).
// Empty FEISHU_ALERT_WEBHOOK must become undefined (not empty string).
function preprocessEnv(): Record<string, unknown> {
  return {
    ...process.env,
    ID_VERIFY_ENABLED: parseEnvBool(process.env.ID_VERIFY_ENABLED, false),
    FEISHU_ALERT_ENABLED: parseEnvBool(process.env.FEISHU_ALERT_ENABLED, true),
    FEISHU_ALERT_WEBHOOK: process.env.FEISHU_ALERT_WEBHOOK || undefined,
  };
}

export const env = envSchema.parse(preprocessEnv());

export const isProd = env.NODE_ENV === 'production';
