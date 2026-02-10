import crypto from 'node:crypto';
import path from 'node:path';

function nowIso() {
  return new Date().toISOString();
}

function sanitizeExt(filename) {
  const ext = path.extname(String(filename || '')).slice(0, 16).toLowerCase();
  return /^[a-z0-9.]+$/.test(ext) ? ext : '';
}

function yyyymm(d = new Date()) {
  const y = String(d.getUTCFullYear());
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return { y, m };
}

function getRequiredEnv(name) {
  const v = String(process.env[name] || '').trim();
  return v ? v : null;
}

export function isOssEnabled() {
  return Boolean(
    getRequiredEnv('OSS_ACCESS_KEY_ID') &&
    getRequiredEnv('OSS_ACCESS_KEY_SECRET') &&
    getRequiredEnv('OSS_BUCKET') &&
    (getRequiredEnv('OSS_REGION') || getRequiredEnv('OSS_HOST'))
  );
}

export function buildOssUploadPolicy({ filename, sizeBytes }) {
  const accessKeyId = getRequiredEnv('OSS_ACCESS_KEY_ID');
  const accessKeySecret = getRequiredEnv('OSS_ACCESS_KEY_SECRET');
  const bucket = getRequiredEnv('OSS_BUCKET');
  const region = getRequiredEnv('OSS_REGION');
  const hostOverride = getRequiredEnv('OSS_HOST');

  if (!accessKeyId || !accessKeySecret || !bucket || (!region && !hostOverride)) {
    throw new Error('oss config missing');
  }

  const host = hostOverride || `https://${bucket}.oss-${region}.aliyuncs.com`;
  const publicBase = String(process.env.OSS_PUBLIC_BASE_URL || '').trim() || host;
  const prefix = String(process.env.OSS_UPLOAD_PREFIX || 'fbif-form/proof').trim().replace(/^\/+|\/+$/g, '');
  const maxMb = Math.max(1, Number(process.env.OSS_MAX_UPLOAD_MB || 100));
  const maxBytes = maxMb * 1024 * 1024;
  const requestedSize = Number(sizeBytes || 0);
  if (requestedSize && requestedSize > maxBytes) {
    throw new Error(`oss file too large: max=${maxMb}MB`);
  }

  const ext = sanitizeExt(filename);
  const { y, m } = yyyymm();
  const key = `${prefix}/${y}/${m}/${crypto.randomUUID()}${ext}`;

  const expireSeconds = Math.max(60, Number(process.env.OSS_POLICY_EXPIRE_SECONDS || 10 * 60));
  const expiration = new Date(Date.now() + expireSeconds * 1000).toISOString();

  const conditions = [
    { bucket },
    { key },
    ['content-length-range', 1, maxBytes],
    ...(String(process.env.OSS_OBJECT_ACL || '').trim()
      ? [{ 'x-oss-object-acl': String(process.env.OSS_OBJECT_ACL).trim() }]
      : [])
  ];

  const policyText = JSON.stringify({ expiration, conditions });
  const policy = Buffer.from(policyText).toString('base64');
  const signature = crypto.createHmac('sha1', accessKeySecret).update(policy).digest('base64');

  const fields = {
    key,
    policy,
    OSSAccessKeyId: accessKeyId,
    Signature: signature,
    success_action_status: '200'
  };

  if (String(process.env.OSS_OBJECT_ACL || '').trim()) {
    fields['x-oss-object-acl'] = String(process.env.OSS_OBJECT_ACL).trim();
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

