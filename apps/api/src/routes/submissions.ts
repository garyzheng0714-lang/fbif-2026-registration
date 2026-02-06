import { Router } from 'express';
import { submissionSchema } from '../validation/submission.js';
import { createSubmission, getSubmissionStatus } from '../services/submissionService.js';
import { feishuSyncQueue } from '../queue/index.js';
import { burstLimiter } from '../middleware/rateLimit.js';
import { csrfGuard } from './csrf.js';

export const submissionsRouter = Router();

submissionsRouter.post('/', burstLimiter, csrfGuard, async (req, res, next) => {
  try {
    const input = submissionSchema.parse(req.body);
    const submission = await createSubmission(input, {
      clientIp: req.ip,
      userAgent: req.headers['user-agent']
    });

    await feishuSyncQueue.add('sync', { submissionId: submission.id }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 }
    });

    res.status(202).json({ id: submission.id, syncStatus: submission.syncStatus });
  } catch (err) {
    next(err);
  }
});

submissionsRouter.get('/:id/status', async (req, res, next) => {
  try {
    const status = await getSubmissionStatus(req.params.id);
    if (!status) {
      return res.status(404).json({ error: 'Not Found' });
    }
    res.json({
      id: status.id,
      syncStatus: status.syncStatus,
      syncError: status.syncError,
      feishuRecordId: status.feishuRecordId,
      createdAt: status.createdAt
    });
  } catch (err) {
    next(err);
  }
});
