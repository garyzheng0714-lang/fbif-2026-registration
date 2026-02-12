import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { hashField } from './crypto.js';

type TokenPayload = {
  v: 1;
  nh: string;
  ih: string;
  iat: number;
  exp: number;
};

function getSignKey() {
  return Buffer.from(env.DATA_KEY, 'base64');
}

function sign(input: string) {
  return crypto
    .createHmac('sha256', getSignKey())
    .update(input, 'utf8')
    .digest('base64url');
}

function safeEqual(a: string, b: string) {
  const aa = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function normalizeName(name: string) {
  return String(name || '').trim();
}

function normalizeIdNumber(idNumber: string) {
  return String(idNumber || '').trim().toUpperCase();
}

export function createIdVerifyToken(name: string, idNumber: string) {
  const nowSec = Math.floor(Date.now() / 1000);
  const payload: TokenPayload = {
    v: 1,
    nh: hashField(normalizeName(name)),
    ih: hashField(normalizeIdNumber(idNumber)),
    iat: nowSec,
    exp: nowSec + Number(env.ID_VERIFY_TOKEN_TTL_SECONDS || 900)
  };

  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = sign(encoded);
  return `${encoded}.${signature}`;
}

export function verifyIdVerifyToken(
  token: string,
  name: string,
  idNumber: string
): { ok: true } | { ok: false; reason: string } {
  const raw = String(token || '').trim();
  if (!raw) return { ok: false, reason: 'missing_token' };

  const [encoded, signature] = raw.split('.');
  if (!encoded || !signature) return { ok: false, reason: 'invalid_format' };

  const expected = sign(encoded);
  if (!safeEqual(signature, expected)) return { ok: false, reason: 'invalid_signature' };

  let payload: TokenPayload | null = null;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as TokenPayload;
  } catch {
    return { ok: false, reason: 'invalid_payload' };
  }

  if (!payload || payload.v !== 1) return { ok: false, reason: 'invalid_version' };

  const nowSec = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(payload.exp) || payload.exp < nowSec) return { ok: false, reason: 'expired' };

  const expectedNameHash = hashField(normalizeName(name));
  const expectedIdHash = hashField(normalizeIdNumber(idNumber));
  if (payload.nh !== expectedNameHash || payload.ih !== expectedIdHash) {
    return { ok: false, reason: 'payload_mismatch' };
  }

  return { ok: true };
}
