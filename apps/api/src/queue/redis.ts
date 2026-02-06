import IORedis from 'ioredis';
import { env } from '../config/env.js';

const RedisCtor = IORedis as unknown as new (url: string, options?: { maxRetriesPerRequest?: null }) => any;

export const redis = new RedisCtor(env.REDIS_URL, {
  maxRetriesPerRequest: null
});
