import { Queue } from 'bullmq';
import { redis } from './redis.js';

export const feishuSyncQueue = new Queue('feishu-sync', {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: 1000,
    removeOnFail: 5000
  }
});
