import crypto from 'crypto';
import { env } from '../config/env.js';

const key = Buffer.from(env.DATA_KEY, 'base64');
if (key.length !== 32) {
  throw new Error('DATA_KEY must be 32-byte base64');
}

const hashSalt = env.DATA_HASH_SALT;

export function encryptField(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    'v1',
    iv.toString('base64'),
    tag.toString('base64'),
    ciphertext.toString('base64')
  ].join(':');
}

export function decryptField(payload: string): string {
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Invalid encrypted payload');
  }
  const iv = Buffer.from(parts[1], 'base64');
  const tag = Buffer.from(parts[2], 'base64');
  const ciphertext = Buffer.from(parts[3], 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plain.toString('utf8');
}

export function hashField(value: string): string {
  return crypto
    .createHash('sha256')
    .update(`${hashSalt}:${value}`)
    .digest('hex');
}
