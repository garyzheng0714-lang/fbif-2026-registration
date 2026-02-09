import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildBitableProofFieldValue,
  createBitableRecord,
  isFeishuEnabled,
  updateBitableRecord,
  uploadProofFilesToDrive
} from './feishu.js';
import { createDiskQueue } from './queue.js';

const submissions = new Map();

const failRate = Number(process.env.MOCK_API_FAIL_RATE || 0);
const forceSyncStatus = (process.env.MOCK_API_FORCE_SYNC_STATUS || '').toUpperCase();
const syncDelayMs = Number(process.env.MOCK_API_SYNC_DELAY_MS || 1200);
const syncProvider = (process.env.MOCK_API_SYNC_PROVIDER || (isFeishuEnabled() ? 'feishu' : 'mock')).toLowerCase();

const queueDir = process.env.MOCK_API_QUEUE_DIR || path.resolve(process.cwd(), 'data', 'queue');
const queueConcurrency = Math.max(1, Number(process.env.MOCK_API_QUEUE_CONCURRENCY || 2));
const queueMaxAttempts = Math.max(1, Number(process.env.MOCK_API_QUEUE_MAX_ATTEMPTS || 10));
const queueBackoffBaseMs = Math.max(200, Number(process.env.MOCK_API_QUEUE_BACKOFF_BASE_MS || 1000));
const queueBackoffMaxMs = Math.max(queueBackoffBaseMs, Number(process.env.MOCK_API_QUEUE_BACKOFF_MAX_MS || 5 * 60 * 1000));

function resolveMockFinalStatus() {
  if (forceSyncStatus === 'SUCCESS') return 'SUCCESS';
  if (forceSyncStatus === 'FAILED') return 'FAILED';
  if (Math.random() < failRate) return 'FAILED';
  return 'SUCCESS';
}

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function logError(...args) {
  console.error(new Date().toISOString(), ...args);
}

function cleanupProofUploads(latest) {
  if (!Array.isArray(latest.proofUploads)) return;
  for (const file of latest.proofUploads) {
    if (!file?.path) continue;
    try {
      fs.unlinkSync(file.path);
    } catch {
      // Ignore cleanup errors.
    }
  }
  latest.proofUploads = [];
  latest.proofFileTokens = [];
}

async function runFeishuSync(latest) {
  if (!latest) return null;

  const traceId = latest.traceId || '';
  const idSuffix = String(latest.idNumber || '').slice(-4);
  const logPrefix = `[trace=${traceId}] [idSuffix=${idSuffix}] [sub=${latest.id}]`;
  const startedAtMs = Date.now();
  let recordId = latest.feishuRecordId || null;

  try {
    log('multitable sync start:', logPrefix, `files=${Array.isArray(latest.proofUploads) ? latest.proofUploads.length : 0}`);

    latest.syncTimings = {
      ...latest.syncTimings,
      startedAtMs: Date.now(),
      finishedAtMs: null
    };

    if (!recordId) {
      recordId = await createBitableRecord(latest);
      latest.syncTimings = {
        ...latest.syncTimings,
        recordCreatedAtMs: Date.now()
      };
      latest.feishuRecordId = recordId;
      log('multitable record created:', logPrefix, `record_id_suffix=${String(recordId).slice(-6)}`, `ms=${Date.now() - startedAtMs}`);
    }

    if (recordId && Array.isArray(latest.proofUploads) && latest.proofUploads.length > 0) {
      const existingTokens = Array.isArray(latest.proofFileTokens) ? latest.proofFileTokens : [];
      const fileTokens = existingTokens.length === latest.proofUploads.length
        ? existingTokens
        : await uploadProofFilesToDrive(latest.proofUploads);

      if (fileTokens !== existingTokens) {
        latest.proofFileTokens = fileTokens;
        latest.syncTimings = {
          ...latest.syncTimings,
          attachmentsUploadedAtMs: Date.now()
        };
        log('multitable attachment upload ok:', logPrefix, `count=${fileTokens.length}`, `ms=${Date.now() - startedAtMs}`);
      }

      const proofField = buildBitableProofFieldValue(fileTokens);
      if (proofField) {
        await updateBitableRecord(recordId, {
          [proofField.fieldName]: proofField.value
        });
        log('multitable record updated:', logPrefix, `ms=${Date.now() - startedAtMs}`);
      }
    }

    latest.syncError = null;
    latest.updatedAt = new Date().toISOString();
    latest.syncTimings = {
      ...latest.syncTimings,
      finishedAtMs: Date.now()
    };
    log('multitable sync ok:', logPrefix, `record_id_suffix=${String(recordId).slice(-6)}`, `ms=${Date.now() - startedAtMs}`);
    return recordId;
  } catch (error) {
    latest.syncError = error instanceof Error ? error.message : 'multitable sync failed';
    latest.updatedAt = new Date().toISOString();
    latest.syncTimings = {
      ...latest.syncTimings,
      finishedAtMs: Date.now()
    };
    logError('multitable sync failed:', logPrefix, latest.syncError);
    throw error;
  }
}

function runMockSync(id) {
  const latest = submissions.get(id);
  if (!latest) return;

  const finalStatus = resolveMockFinalStatus();
  latest.syncStatus = finalStatus;
  latest.syncError = finalStatus === 'FAILED' ? 'mock sync failed' : null;
  latest.updatedAt = new Date().toISOString();
}

async function processFeishuJob(job) {
  const submission = job?.submission;
  if (!submission?.id) {
    throw new Error('invalid job payload');
  }

  submissions.set(submission.id, submission);

  submission.syncStatus = 'PROCESSING';
  submission.syncError = null;
  submission.updatedAt = new Date().toISOString();

  try {
    await runFeishuSync(submission);
    submission.syncStatus = 'SUCCESS';
    submission.syncError = null;
    submission.updatedAt = new Date().toISOString();
    cleanupProofUploads(submission);
  } catch (error) {
    submission.syncStatus = 'RETRYING';
    submission.syncError = error instanceof Error ? error.message : 'multitable sync failed';
    submission.updatedAt = new Date().toISOString();
    throw error;
  }
}

const feishuQueue = syncProvider === 'feishu'
  ? createDiskQueue({
      dir: queueDir,
      concurrency: queueConcurrency,
      tickMs: 1000,
      maxAttempts: queueMaxAttempts,
      backoffBaseMs: queueBackoffBaseMs,
      backoffMaxMs: queueBackoffMaxMs,
      logger: {
        log,
        error: logError
      },
      processJob: processFeishuJob
    })
  : null;

if (feishuQueue) {
  void feishuQueue.start().catch((error) => {
    logError('queue start failed:', error instanceof Error ? error.message : String(error));
  });
}

export function createSubmission(record) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const submission = {
    id,
    ...record,
    syncStatus: 'PENDING',
    syncError: null,
    feishuRecordId: null,
    proofFileTokens: [],
    createdAt: now,
    updatedAt: now,
    syncTimings: {
      startedAtMs: Date.now(),
      recordCreatedAtMs: null,
      attachmentsUploadedAtMs: null,
      finishedAtMs: null
    }
  };

  submissions.set(id, submission);

  if (syncProvider === 'feishu') {
    if (!feishuQueue) {
      throw new Error('queue not initialized');
    }
    feishuQueue.enqueue(id, {
      id,
      submission,
      attempts: 0,
      maxAttempts: queueMaxAttempts,
      nextRunAtMs: Date.now() + syncDelayMs,
      createdAt: now,
      updatedAt: now
    });
  } else {
    setTimeout(() => {
      runMockSync(id);
    }, syncDelayMs);
  }

  return submission;
}

export function getSubmission(id) {
  return submissions.get(id) || null;
}

export function clearSubmissions() {
  submissions.clear();
}
