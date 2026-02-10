import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(8080),
  WEB_ORIGIN: z.string().url(),
  DATABASE_URL: z.string().min(1),
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
  SYNC_POLL_TIMEOUT_MS: z.coerce.number().default(30000),

  FEISHU_SYNC_ATTEMPTS: z.coerce.number().default(8),
  FEISHU_SYNC_BACKOFF_MS: z.coerce.number().default(1000),
  FEISHU_SYNC_BACKOFF_MAX_MS: z.coerce.number().default(120000),
  FEISHU_WORKER_CONCURRENCY: z.coerce.number().default(10),
  FEISHU_WORKER_QPS: z.coerce.number().default(10),

  MAX_PROOF_URLS: z.coerce.number().default(5),
  MAX_PROOF_URL_LENGTH: z.coerce.number().default(2048),

  OSS_ACCESS_KEY_ID: z.string().optional(),
  OSS_ACCESS_KEY_SECRET: z.string().optional(),
  OSS_BUCKET: z.string().optional(),
  OSS_REGION: z.string().optional(),
  OSS_HOST: z.string().optional(),
  OSS_PUBLIC_BASE_URL: z.string().optional(),
  OSS_UPLOAD_PREFIX: z.string().optional(),
  OSS_MAX_UPLOAD_MB: z.coerce.number().default(50),
  OSS_POLICY_EXPIRE_SECONDS: z.coerce.number().default(600),
  OSS_OBJECT_ACL: z.string().optional()
});

export const env = envSchema.parse({
  NODE_ENV: process.env.NODE_ENV,
  PORT: process.env.PORT,
  WEB_ORIGIN: process.env.WEB_ORIGIN,
  DATABASE_URL: process.env.DATABASE_URL,
  REDIS_URL: process.env.REDIS_URL,
  DATA_KEY: process.env.DATA_KEY,
  DATA_HASH_SALT: process.env.DATA_HASH_SALT,
  FEISHU_APP_ID: process.env.FEISHU_APP_ID,
  FEISHU_APP_SECRET: process.env.FEISHU_APP_SECRET,
  FEISHU_APP_TOKEN: process.env.FEISHU_APP_TOKEN,
  FEISHU_TABLE_ID: process.env.FEISHU_TABLE_ID,
  RATE_LIMIT_WINDOW_MS: process.env.RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX: process.env.RATE_LIMIT_MAX,
  RATE_LIMIT_BURST: process.env.RATE_LIMIT_BURST,
  SYNC_POLL_TIMEOUT_MS: process.env.SYNC_POLL_TIMEOUT_MS,

  FEISHU_SYNC_ATTEMPTS: process.env.FEISHU_SYNC_ATTEMPTS,
  FEISHU_SYNC_BACKOFF_MS: process.env.FEISHU_SYNC_BACKOFF_MS,
  FEISHU_SYNC_BACKOFF_MAX_MS: process.env.FEISHU_SYNC_BACKOFF_MAX_MS,
  FEISHU_WORKER_CONCURRENCY: process.env.FEISHU_WORKER_CONCURRENCY,
  FEISHU_WORKER_QPS: process.env.FEISHU_WORKER_QPS,

  MAX_PROOF_URLS: process.env.MAX_PROOF_URLS,
  MAX_PROOF_URL_LENGTH: process.env.MAX_PROOF_URL_LENGTH,

  OSS_ACCESS_KEY_ID: process.env.OSS_ACCESS_KEY_ID,
  OSS_ACCESS_KEY_SECRET: process.env.OSS_ACCESS_KEY_SECRET,
  OSS_BUCKET: process.env.OSS_BUCKET,
  OSS_REGION: process.env.OSS_REGION,
  OSS_HOST: process.env.OSS_HOST,
  OSS_PUBLIC_BASE_URL: process.env.OSS_PUBLIC_BASE_URL,
  OSS_UPLOAD_PREFIX: process.env.OSS_UPLOAD_PREFIX,
  OSS_MAX_UPLOAD_MB: process.env.OSS_MAX_UPLOAD_MB,
  OSS_POLICY_EXPIRE_SECONDS: process.env.OSS_POLICY_EXPIRE_SECONDS,
  OSS_OBJECT_ACL: process.env.OSS_OBJECT_ACL
});

export const isProd = env.NODE_ENV === 'production';
