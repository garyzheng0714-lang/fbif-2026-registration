import { prisma } from '../utils/db.js';
import { encryptField, hashField, decryptField } from '../utils/crypto.js';
import { sanitizeText } from '../validation/submission.js';
import type { Submission } from '@prisma/client';

export async function createSubmission(input: {
  phone: string;
  name: string;
  title: string;
  company: string;
  idNumber: string;
}, meta: { clientIp?: string; userAgent?: string }) {
  const clean = {
    phone: input.phone.trim(),
    name: sanitizeText(input.name),
    title: sanitizeText(input.title),
    company: sanitizeText(input.company),
    idNumber: input.idNumber.trim()
  };

  return prisma.submission.create({
    data: {
      name: clean.name,
      title: clean.title,
      company: clean.company,
      phoneEnc: encryptField(clean.phone),
      phoneHash: hashField(clean.phone),
      idEnc: encryptField(clean.idNumber),
      idHash: hashField(clean.idNumber),
      clientIp: meta.clientIp,
      userAgent: meta.userAgent
    }
  });
}

export async function markSubmissionSuccess(id: string, recordId: string) {
  return prisma.submission.update({
    where: { id },
    data: {
      syncStatus: 'SUCCESS',
      feishuRecordId: recordId,
      syncError: null
    }
  });
}

export async function markSubmissionFailed(id: string, error: string) {
  return prisma.submission.update({
    where: { id },
    data: {
      syncStatus: 'FAILED',
      syncError: error.slice(0, 2000)
    }
  });
}

export async function getSubmissionStatus(id: string) {
  return prisma.submission.findUnique({
    where: { id },
    select: {
      id: true,
      syncStatus: true,
      syncError: true,
      createdAt: true,
      feishuRecordId: true
    }
  });
}

export function decryptSubmissionSensitive(submission: Submission) {
  return {
    phone: decryptField(submission.phoneEnc),
    idNumber: decryptField(submission.idEnc)
  };
}
