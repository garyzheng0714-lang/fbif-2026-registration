import crypto from 'node:crypto';
import path from 'node:path';
import { env } from '../config/env.js';

function nowIso() {
  return new Date().toISOString();
}

function trim(value: string | undefined) {
  return String(value || '').trim();
}

function sanitizeExt(filename: string) {
  const ext = path.extname(String(filename || '')).slice(0, 16).toLowerCase();
  return /^[a-z0-9.]+$/.test(ext) ? ext : '';
}

function yyyymm(d = new Date()) {
  const y = String(d.getUTCFullYear());
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return { y, m };
}

export function isOssEnabled() {
  return Boolean(
    trim(env.OSS_ACCESS_KEY_ID) &&
      trim(env.OSS_ACCESS_KEY_SECRET) &&
      trim(env.OSS_BUCKET) &&
      (trim(env.OSS_REGION) || trim(env.OSS_HOST))
  );
}

export function buildOssUploadPolicy(input: {
  filename: string;
  sizeBytes?: number;
}) {
  const accessKeyId = trim(env.OSS_ACCESS_KEY_ID);
  const accessKeySecret = trim(env.OSS_ACCESS_KEY_SECRET);
  const bucket = trim(env.OSS_BUCKET);
  const region = trim(env.OSS_REGION);
  const hostOverride = trim(env.OSS_HOST);

  if (!accessKeyId || !accessKeySecret || !bucket || (!region && !hostOverride)) {
    throw new Error('oss config missing');
  }

  const host = hostOverride || `https://${bucket}.oss-${region}.aliyuncs.com`;
  const publicBase = trim(env.OSS_PUBLIC_BASE_URL) || host;
  const prefix = (trim(env.OSS_UPLOAD_PREFIX) || 'fbif-form/proof').replace(/^\/+|\/+$/g, '');

  const maxMb = Math.max(1, Number(env.OSS_MAX_UPLOAD_MB || 50));
  const maxBytes = maxMb * 1024 * 1024;
  const requestedSize = Number(input.sizeBytes || 0);
  if (requestedSize && requestedSize > maxBytes) {
    throw new Error(`oss file too large: max=${maxMb}MB`);
  }

  const ext = sanitizeExt(input.filename);
  const { y, m } = yyyymm();
  const key = `${prefix}/${y}/${m}/${crypto.randomUUID()}${ext}`;

  const expireSeconds = Math.max(60, Number(env.OSS_POLICY_EXPIRE_SECONDS || 10 * 60));
  const expiration = new Date(Date.now() + expireSeconds * 1000).toISOString();

  const conditions: any[] = [
    { bucket },
    { key },
    ['content-length-range', 1, maxBytes]
  ];

  const acl = trim(env.OSS_OBJECT_ACL);
  if (acl) {
    conditions.push({ 'x-oss-object-acl': acl });
  }

  const policyText = JSON.stringify({ expiration, conditions });
  const policy = Buffer.from(policyText).toString('base64');
  const signature = crypto.createHmac('sha1', accessKeySecret).update(policy).digest('base64');

  const fields: Record<string, string> = {
    key,
    policy,
    OSSAccessKeyId: accessKeyId,
    Signature: signature,
    success_action_status: '200'
  };

  if (acl) {
    fields['x-oss-object-acl'] = acl;
  }

  return {
    ok: true,
    host,
    key,
    publicUrl: `${publicBase.replace(/\/+$/g, '')}/${key}`,
    expiresAt: expiration,
    issuedAt: nowIso(),
    fields
  };
}

