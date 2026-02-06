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
  SYNC_POLL_TIMEOUT_MS: z.coerce.number().default(30000)
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
  SYNC_POLL_TIMEOUT_MS: process.env.SYNC_POLL_TIMEOUT_MS
});

export const isProd = env.NODE_ENV === 'production';
