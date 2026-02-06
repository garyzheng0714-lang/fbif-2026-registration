import { Worker } from 'bullmq';
import { redis } from './queue/redis.js';
import { prisma } from './utils/db.js';
import { logger } from './utils/logger.js';
import { createBitableRecord, mapToBitableFields } from './services/feishuService.js';
import { decryptSubmissionSensitive, markSubmissionFailed, markSubmissionSuccess } from './services/submissionService.js';

const worker = new Worker(
  'feishu-sync',
  async (job) => {
    const submission = await prisma.submission.findUnique({
      where: { id: job.data.submissionId }
    });

    if (!submission) {
      return;
    }

    const sensitive = decryptSubmissionSensitive(submission);
    const fields = mapToBitableFields({
      name: submission.name,
      phone: sensitive.phone,
      title: submission.title,
      company: submission.company,
      idNumber: sensitive.idNumber,
      submittedAt: submission.createdAt.toISOString(),
      syncStatus: '已同步'
    });

    const recordId = await createBitableRecord(fields);
    await markSubmissionSuccess(submission.id, recordId);
  },
  { connection: redis }
);

worker.on('failed', async (job, err) => {
  if (!job) return;
  logger.error({ err, jobId: job.id }, 'Feishu sync failed');
  await markSubmissionFailed(job.data.submissionId, err.message || 'Unknown error');
});

worker.on('completed', (job) => {
  logger.info({ jobId: job.id }, 'Feishu sync completed');
});
