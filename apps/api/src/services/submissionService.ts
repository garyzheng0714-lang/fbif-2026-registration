import { prisma } from '../utils/db.js';
import { encryptField, hashField, decryptField } from '../utils/crypto.js';
import { sanitizeText } from '../validation/submission.js';
import type { Submission } from '@prisma/client';
import crypto from 'node:crypto';
import type { SubmissionInput } from '../validation/submission.js';

export async function createSubmission(input: SubmissionInput, meta: { clientIp?: string; userAgent?: string }) {
  const clientRequestId = String(input.clientRequestId || '').trim() || crypto.randomUUID();

  const clean = {
    clientRequestId,
    role: input.role,
    idType: input.idType,
    phone: input.phone.trim(),
    name: sanitizeText(input.name),
    title: sanitizeText(input.title),
    company: sanitizeText(input.company),
    idNumber: input.idNumber.trim(),
    businessType: sanitizeText(input.businessType || ''),
    department: sanitizeText(input.department || ''),
    proofUrls: Array.isArray(input.proofUrls) ? input.proofUrls : []
  };

  try {
    const created = await prisma.submission.create({
      data: {
        clientRequestId: clean.clientRequestId,
        traceId: crypto.randomUUID(),
        role: clean.role,
        idType: clean.idType,
        name: clean.name,
        title: clean.title,
        company: clean.company,
        phoneEnc: encryptField(clean.phone),
        phoneHash: hashField(clean.phone),
        idEnc: encryptField(clean.idNumber),
        idHash: hashField(clean.idNumber),
        businessType: clean.role === 'industry' ? clean.businessType.slice(0, 64) : null,
        department: clean.role === 'industry' ? clean.department.slice(0, 64) : null,
        proofUrls: clean.role === 'industry' ? clean.proofUrls : undefined,
        clientIp: meta.clientIp,
        userAgent: meta.userAgent
      }
    });

    return { submission: created, isNew: true };
  } catch (err: any) {
    // If concurrent requests raced on the same clientRequestId, return the existing row.
    if (err?.code === 'P2002') {
      const row = await prisma.submission.findUnique({
        where: { clientRequestId: clean.clientRequestId }
      });
      if (row) return { submission: row, isNew: false };
    }
    throw err;
  }
}

export async function markSubmissionProcessing(id: string, attempt: number) {
  return prisma.submission.update({
    where: { id },
    data: {
      syncStatus: 'PROCESSING',
      syncAttempts: attempt,
      lastAttemptAt: new Date(),
      nextAttemptAt: null
    }
  });
}

export async function markSubmissionRetrying(id: string, attempt: number, nextAttemptAt: Date, error: string) {
  return prisma.submission.update({
    where: { id },
    data: {
      syncStatus: 'RETRYING',
      syncAttempts: attempt,
      lastAttemptAt: new Date(),
      nextAttemptAt,
      syncError: error.slice(0, 2000)
    }
  });
}

export async function markSubmissionSuccess(id: string, recordId: string) {
  return prisma.submission.update({
    where: { id },
    data: {
      syncStatus: 'SUCCESS',
      feishuRecordId: recordId,
      syncError: null,
      nextAttemptAt: null
    }
  });
}

export async function markSubmissionFailed(id: string, error: string) {
  return prisma.submission.update({
    where: { id },
    data: {
      syncStatus: 'FAILED',
      syncError: error.slice(0, 2000),
      nextAttemptAt: null
    }
  });
}

export async function getSubmissionStatus(id: string) {
  return prisma.submission.findUnique({
    where: { id },
    select: {
      id: true,
      traceId: true,
      syncStatus: true,
      syncError: true,
      createdAt: true,
      updatedAt: true,
      feishuRecordId: true,
      syncAttempts: true,
      lastAttemptAt: true,
      nextAttemptAt: true
    }
  });
}

export function decryptSubmissionSensitive(submission: Submission) {
  return {
    phone: decryptField(submission.phoneEnc),
    idNumber: decryptField(submission.idEnc)
  };
}
