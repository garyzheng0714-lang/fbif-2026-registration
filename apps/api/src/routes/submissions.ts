import { Router } from 'express';
import { submissionSchema } from '../validation/submission.js';
import { createSubmission, getSubmissionStatus } from '../services/submissionService.js';
import { feishuSyncQueue } from '../queue/index.js';
import { burstLimiter } from '../middleware/rateLimit.js';
import { csrfGuard } from './csrf.js';
import { env } from '../config/env.js';
import { submissionsAcceptedTotal } from '../metrics.js';
import { logger } from '../utils/logger.js';
import { computeEnqueueDelayMs, getQueuePressure } from '../queue/backpressure.js';

export const submissionsRouter = Router();

function isJobAlreadyExistsError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err || '');
  return msg.toLowerCase().includes('already exists');
}

submissionsRouter.post('/', burstLimiter, csrfGuard, async (req, res, next) => {
  try {
    const input = submissionSchema.parse(req.body);
    const { submission } = await createSubmission(input, {
      clientIp: req.ip,
      userAgent: req.headers['user-agent']
    });

    res.status(202).json({
      id: submission.id,
      traceId: submission.traceId,
      syncStatus: submission.syncStatus
    });

    submissionsAcceptedTotal.inc({ role: input.role });

    if (submission.syncStatus !== 'SUCCESS') {
      // Do not block the response on Redis/queue health.
      void (async () => {
        try {
          const pressure = await getQueuePressure(feishuSyncQueue);
          const delayMs = computeEnqueueDelayMs(pressure.level);

          if (pressure.level !== 'normal') {
            logger.warn(
              {
                submissionId: submission.id,
                traceId: submission.traceId,
                queueLevel: pressure.level,
                backlog: pressure.backlog,
                enqueueDelayMs: delayMs
              },
              'enqueue with queue backpressure'
            );
          }

          await feishuSyncQueue.add('sync', { submissionId: submission.id }, {
            jobId: submission.id,
            attempts: env.FEISHU_SYNC_ATTEMPTS,
            backoff: { type: 'exponential', delay: env.FEISHU_SYNC_BACKOFF_MS },
            delay: delayMs
          });
        } catch (err) {
          if (isJobAlreadyExistsError(err)) return;
          logger.error(
            { err, submissionId: submission.id, traceId: submission.traceId },
            'enqueue feishu sync job failed'
          );
        }
      })();
    }
  } catch (err) {
    next(err);
  }
});

submissionsRouter.get('/:id/status', async (req, res, next) => {
  try {
    const status = await getSubmissionStatus(req.params.id);
    if (!status) {
      return res.status(404).json({ error: 'Not Found', traceId: res.locals.traceId });
    }
    res.json({
      id: status.id,
      traceId: status.traceId,
      syncStatus: status.syncStatus,
      syncError: status.syncError,
      feishuRecordId: status.feishuRecordId,
      syncAttempts: status.syncAttempts,
      lastAttemptAt: status.lastAttemptAt,
      nextAttemptAt: status.nextAttemptAt,
      createdAt: status.createdAt,
      updatedAt: status.updatedAt
    });
  } catch (err) {
    next(err);
  }
});
