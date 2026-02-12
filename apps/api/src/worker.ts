import { Worker } from 'bullmq';
import { env } from './config/env.js';
import { redis } from './queue/redis.js';
import { feishuSyncQueue } from './queue/index.js';
import { getQueuePressure, retryBackoffMultiplier } from './queue/backpressure.js';
import { prisma } from './utils/db.js';
import { logger } from './utils/logger.js';
import {
  createBitableRecord,
  isRetryableFeishuError,
  mapSubmissionToBitableFields,
  updateBitableRecord
} from './services/feishuService.js';
import {
  decryptSubmissionSensitive,
  markSubmissionFailed,
  markSubmissionProcessing,
  markSubmissionRetrying,
  markSubmissionSuccess
} from './services/submissionService.js';
import { feishuApiErrorsTotal, feishuSyncJobsTotal } from './metrics.js';

function computeExponentialBackoffMs(attempt: number, multiplier = 1) {
  const base = Math.max(50, Number(env.FEISHU_SYNC_BACKOFF_MS || 1000));
  const max = Math.max(base, Number(env.FEISHU_SYNC_BACKOFF_MAX_MS || 120000));
  const delay = Math.min(max, base * Math.pow(2, Math.max(0, attempt - 1)) * Math.max(1, multiplier));
  const jitter = Math.floor(Math.random() * 200);
  return delay + jitter;
}

function errorMessage(err: unknown) {
  if (err instanceof Error) return err.message || err.name;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function isJobAlreadyExistsError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err || '');
  return msg.toLowerCase().includes('already exists');
}

const worker = new Worker(
  'feishu-sync',
  async (job) => {
    const submission = await prisma.submission.findUnique({
      where: { id: job.data.submissionId }
    });

    if (!submission) return;
    if (submission.syncStatus === 'SUCCESS') return;

    const attempt = (job.attemptsMade || 0) + 1;
    const maxAttempts = Number(job.opts.attempts || env.FEISHU_SYNC_ATTEMPTS || 1);

    await markSubmissionProcessing(submission.id, attempt);

    try {
      const sensitive = decryptSubmissionSensitive(submission);
      const fields = await mapSubmissionToBitableFields({
        submission,
        sensitive
      });

      let recordId = submission.feishuRecordId || '';
      if (recordId) {
        await updateBitableRecord(recordId, fields);
      } else {
        recordId = await createBitableRecord(fields);
      }

      await markSubmissionSuccess(submission.id, recordId);
      feishuSyncJobsTotal.inc({ result: 'success' });
    } catch (err) {
      const msg = errorMessage(err);
      const retryable = isRetryableFeishuError(err);
      const willRetry = retryable && attempt < maxAttempts;

      if (willRetry) {
        const pressure = await getQueuePressure(feishuSyncQueue);
        const backoffMs = computeExponentialBackoffMs(attempt, retryBackoffMultiplier(pressure.level));
        await markSubmissionRetrying(submission.id, attempt, new Date(Date.now() + backoffMs), msg);
        if (pressure.level !== 'normal') {
          logger.warn(
            {
              submissionId: submission.id,
              traceId: submission.traceId,
              queueLevel: pressure.level,
              queueBacklog: pressure.backlog,
              backoffMs
            },
            'worker retry under queue backpressure'
          );
        }
        feishuSyncJobsTotal.inc({ result: 'retry' });
      } else {
        await markSubmissionFailed(submission.id, msg);
        feishuSyncJobsTotal.inc({ result: 'failed' });
      }

      feishuApiErrorsTotal.inc({ retryable: retryable ? 'true' : 'false' });

      throw err;
    }
  },
  {
    connection: redis,
    concurrency: env.FEISHU_WORKER_CONCURRENCY,
    limiter: {
      max: env.FEISHU_WORKER_QPS,
      duration: 1000
    }
  }
);

async function sweepOrphanSubmissions() {
  const now = new Date();

  // 1) PENDING: accepted but job may not have been enqueued due to a transient Redis outage or process crash.
  // Add a small age buffer to avoid racing with normal enqueue path.
  const pending = await prisma.submission.findMany({
    where: {
      syncStatus: 'PENDING',
      createdAt: { lt: new Date(Date.now() - 10_000) }
    },
    orderBy: { createdAt: 'asc' },
    take: 100,
    select: { id: true, traceId: true }
  });

  // 2) RETRYING: if job got lost (e.g. Redis flush), re-add it respecting nextAttemptAt.
  const retrying = await prisma.submission.findMany({
    where: {
      syncStatus: 'RETRYING',
      nextAttemptAt: { lte: now }
    },
    orderBy: { nextAttemptAt: 'asc' },
    take: 100,
    select: { id: true, traceId: true, nextAttemptAt: true }
  });

  const targets: Array<{ id: string; traceId: string; delayMs?: number }> = [
    ...pending.map((s) => ({ id: s.id, traceId: s.traceId })),
    ...retrying.map((s) => ({ id: s.id, traceId: s.traceId, delayMs: 0 }))
  ];

  if (targets.length === 0) return;

  await Promise.all(
    targets.map(async (t) => {
      try {
        await feishuSyncQueue.add('sync', { submissionId: t.id }, {
          jobId: t.id,
          attempts: env.FEISHU_SYNC_ATTEMPTS,
          backoff: { type: 'exponential', delay: env.FEISHU_SYNC_BACKOFF_MS },
          delay: t.delayMs || 0
        });
      } catch (err) {
        if (isJobAlreadyExistsError(err)) return;
        logger.error({ err, submissionId: t.id, traceId: t.traceId }, 'sweep enqueue failed');
      }
    })
  );
}

const sweepIntervalMs = Math.max(5_000, Number(process.env.SWEEP_PENDING_INTERVAL_MS || 15_000));
const sweepTimer = setInterval(() => {
  void sweepOrphanSubmissions().catch((err) => {
    logger.error({ err }, 'sweepOrphanSubmissions crashed');
  });
}, sweepIntervalMs);
// Don't keep the process alive solely for the sweeper.
sweepTimer.unref();

worker.on('failed', async (job, err) => {
  logger.error(
    {
      err,
      jobId: job?.id,
      submissionId: job?.data?.submissionId
    },
    'Feishu sync job failed'
  );
});

worker.on('completed', (job) => {
  logger.info({ jobId: job.id, submissionId: job.data.submissionId }, 'Feishu sync completed');
});
