import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { env } from '../config/env.js';
import { redis } from '../queue/redis.js';

export const apiLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  store: new RedisStore({
    sendCommand: (...args: string[]) => redis.call(...args)
  })
});

export const burstLimiter = rateLimit({
  windowMs: 1000,
  limit: env.RATE_LIMIT_BURST,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  store: new RedisStore({
    sendCommand: (...args: string[]) => redis.call(...args)
  })
});
