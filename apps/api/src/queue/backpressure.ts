import type { Queue } from 'bullmq';
import { env } from '../config/env.js';

export type QueuePressureLevel = 'normal' | 'high' | 'critical';

export type QueuePressureSnapshot = {
  level: QueuePressureLevel;
  backlog: number;
  waiting: number;
  active: number;
  delayed: number;
};

let cachedAtMs = 0;
let cachedSnapshot: QueuePressureSnapshot | null = null;

function classifyQueuePressure(backlog: number): QueuePressureLevel {
  if (backlog >= env.FEISHU_QUEUE_CRITICAL_WATERMARK) return 'critical';
  if (backlog >= env.FEISHU_QUEUE_HIGH_WATERMARK) return 'high';
  return 'normal';
}

export async function getQueuePressure(queue: Queue): Promise<QueuePressureSnapshot> {
  const cacheMs = Math.max(0, Number(env.FEISHU_QUEUE_PRESSURE_CACHE_MS || 0));
  const now = Date.now();
  if (cachedSnapshot && now - cachedAtMs < cacheMs) return cachedSnapshot;

  try {
    const counts: any = await (queue as any).getJobCounts('waiting', 'wait', 'active', 'delayed');
    const waiting = Number(counts?.waiting ?? counts?.wait ?? 0);
    const active = Number(counts?.active ?? 0);
    const delayed = Number(counts?.delayed ?? 0);
    const backlog = waiting + active + delayed;
    const level = classifyQueuePressure(backlog);

    cachedSnapshot = { level, backlog, waiting, active, delayed };
    cachedAtMs = now;
    return cachedSnapshot;
  } catch {
    return {
      level: 'normal',
      backlog: 0,
      waiting: 0,
      active: 0,
      delayed: 0
    };
  }
}

export function computeEnqueueDelayMs(level: QueuePressureLevel) {
  if (level === 'critical') {
    const base = Math.max(200, Number(env.FEISHU_ENQUEUE_DELAY_CRITICAL_MS || 0));
    return base + Math.floor(Math.random() * Math.max(100, Math.floor(base / 2)));
  }
  if (level === 'high') {
    const base = Math.max(50, Number(env.FEISHU_ENQUEUE_DELAY_HIGH_MS || 0));
    return base + Math.floor(Math.random() * Math.max(50, Math.floor(base / 2)));
  }
  return 0;
}

export function retryBackoffMultiplier(level: QueuePressureLevel) {
  if (level === 'critical') return Math.max(1, Number(env.FEISHU_RETRY_BACKOFF_CRITICAL_MULTIPLIER || 1));
  if (level === 'high') return Math.max(1, Number(env.FEISHU_RETRY_BACKOFF_HIGH_MULTIPLIER || 1));
  return 1;
}

