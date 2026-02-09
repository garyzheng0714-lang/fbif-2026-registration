import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  buildBitableProofFieldValue,
  createBitableRecord,
  deleteBitableRecord,
  isFeishuEnabled,
  updateBitableRecord,
  uploadProofFilesToDrive
} from './feishu.js';

const submissions = new Map();

const failRate = Number(process.env.MOCK_API_FAIL_RATE || 0);
const forceSyncStatus = (process.env.MOCK_API_FORCE_SYNC_STATUS || '').toUpperCase();
const syncDelayMs = Number(process.env.MOCK_API_SYNC_DELAY_MS || 1200);
const syncProvider = (process.env.MOCK_API_SYNC_PROVIDER || (isFeishuEnabled() ? 'feishu' : 'mock')).toLowerCase();

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

async function runFeishuSync(id) {
  const latest = submissions.get(id);
  if (!latest) return;

  const traceId = latest.traceId || '';
  const idSuffix = String(latest.idNumber || '').slice(-4);
  const logPrefix = `[trace=${traceId}] [idSuffix=${idSuffix}] [sub=${id}]`;
  const startedAtMs = Date.now();
  let recordId = null;

  try {
    log('multitable sync start:', logPrefix, `files=${Array.isArray(latest.proofUploads) ? latest.proofUploads.length : 0}`);

    recordId = await createBitableRecord(latest);
    latest.syncTimings = {
      ...latest.syncTimings,
      recordCreatedAtMs: Date.now()
    };
    log('multitable record created:', logPrefix, `record_id_suffix=${String(recordId).slice(-6)}`, `ms=${Date.now() - startedAtMs}`);

    if (recordId && Array.isArray(latest.proofUploads) && latest.proofUploads.length > 0) {
      const fileTokens = await uploadProofFilesToDrive(latest.proofUploads);
      latest.syncTimings = {
        ...latest.syncTimings,
        attachmentsUploadedAtMs: Date.now()
      };
      log('multitable attachment upload ok:', logPrefix, `count=${fileTokens.length}`, `ms=${Date.now() - startedAtMs}`);

      const proofField = buildBitableProofFieldValue(fileTokens);
      if (proofField) {
        await updateBitableRecord(recordId, {
          [proofField.fieldName]: proofField.value
        });
        log('multitable record updated:', logPrefix, `ms=${Date.now() - startedAtMs}`);
      }
    }

    latest.syncStatus = 'SUCCESS';
    latest.syncError = null;
    latest.feishuRecordId = recordId;
    latest.updatedAt = new Date().toISOString();
    latest.syncTimings = {
      ...latest.syncTimings,
      finishedAtMs: Date.now()
    };
    log('multitable sync ok:', logPrefix, `record_id_suffix=${String(recordId).slice(-6)}`, `ms=${Date.now() - startedAtMs}`);
  } catch (error) {
    if (recordId && Array.isArray(latest.proofUploads) && latest.proofUploads.length > 0) {
      // Keep table consistency: if record was created but attachment flow failed, rollback.
      try {
        await deleteBitableRecord(recordId);
        recordId = null;
      } catch (rollbackError) {
        logError('multitable rollback failed:', logPrefix, rollbackError instanceof Error ? rollbackError.message : String(rollbackError));
      }
    }

    latest.syncStatus = 'FAILED';
    latest.syncError = error instanceof Error ? error.message : 'feishu sync failed';
    latest.updatedAt = new Date().toISOString();
    latest.syncTimings = {
      ...latest.syncTimings,
      finishedAtMs: Date.now()
    };
    logError('multitable sync failed:', logPrefix, latest.syncError);
  } finally {
    if (Array.isArray(latest.proofUploads)) {
      for (const file of latest.proofUploads) {
        if (!file?.path) continue;
        try {
          fs.unlinkSync(file.path);
        } catch {
          // Ignore cleanup errors.
        }
      }
      latest.proofUploads = [];
    }
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

export function createSubmission(record) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const submission = {
    id,
    ...record,
    syncStatus: 'PENDING',
    syncError: null,
    feishuRecordId: null,
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

  setTimeout(() => {
    if (syncProvider === 'feishu') {
      void runFeishuSync(id);
      return;
    }

    runMockSync(id);
  }, syncDelayMs);

  return submission;
}

export function getSubmission(id) {
  return submissions.get(id) || null;
}

export function clearSubmissions() {
  submissions.clear();
}
