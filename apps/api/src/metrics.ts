import client from 'prom-client';
import type { Queue } from 'bullmq';

export const register = new client.Registry();

client.collectDefaultMetrics({
  register
});

export const httpRequestsTotal = new client.Counter({
  name: 'fbif_http_requests_total',
  help: 'Total number of HTTP requests served by API.',
  labelNames: ['method', 'path', 'status'] as const,
  registers: [register]
});

export const httpRequestDurationSeconds = new client.Histogram({
  name: 'fbif_http_request_duration_seconds',
  help: 'HTTP request duration histogram in seconds.',
  labelNames: ['method', 'path', 'status'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [register]
});

export const submissionsAcceptedTotal = new client.Counter({
  name: 'fbif_submissions_accepted_total',
  help: 'Total number of submissions accepted by API (202).',
  labelNames: ['role'] as const,
  registers: [register]
});

export const feishuSyncJobsTotal = new client.Counter({
  name: 'fbif_feishu_sync_jobs_total',
  help: 'Total number of Feishu sync jobs by result.',
  labelNames: ['result'] as const,
  registers: [register]
});

export const feishuApiErrorsTotal = new client.Counter({
  name: 'fbif_feishu_api_errors_total',
  help: 'Total number of Feishu API errors observed in worker.',
  labelNames: ['retryable'] as const,
  registers: [register]
});

export const feishuQueueJobs = new client.Gauge({
  name: 'fbif_feishu_queue_jobs',
  help: 'BullMQ job counts for feishu-sync queue.',
  labelNames: ['state'] as const,
  registers: [register]
});

export async function updateQueueMetrics(queue: Queue) {
  try {
    const counts: any = await (queue as any).getJobCounts();
    const waiting = Number(counts?.waiting ?? counts?.wait ?? 0);
    const active = Number(counts?.active ?? 0);
    const delayed = Number(counts?.delayed ?? 0);
    const failed = Number(counts?.failed ?? 0);

    feishuQueueJobs.set({ state: 'waiting' }, waiting);
    feishuQueueJobs.set({ state: 'active' }, active);
    feishuQueueJobs.set({ state: 'delayed' }, delayed);
    feishuQueueJobs.set({ state: 'failed' }, failed);
  } catch {
    // Metrics should never crash the API.
  }
}

export async function renderMetrics() {
  return register.metrics();
}
