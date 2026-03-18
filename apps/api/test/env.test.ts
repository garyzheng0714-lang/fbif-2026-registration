import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';

// We test the exported schema directly rather than re-importing env.ts
// (which triggers dotenv + parse on import and would conflict with process.env
// manipulation in tests). Instead we copy the schema and preprocessor logic
// and verify their behavior in isolation.

function parseEnvBool(value: unknown, fallback = false) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') return true;
  if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false;
  return fallback;
}

// Minimal schema subset for unit testing — mirrors the real schema's
// TRUST_PROXY_HOPS, boolean, and webhook fields.
const testSchema = z.object({
  TRUST_PROXY_HOPS: z.coerce.number().int().min(1).max(5).default(2),
  ID_VERIFY_ENABLED: z.boolean().default(false),
  FEISHU_ALERT_ENABLED: z.boolean().default(true),
  FEISHU_ALERT_WEBHOOK: z.string().url().optional(),
});

function preprocessAndParse(raw: Record<string, string | undefined>) {
  return testSchema.parse({
    ...raw,
    ID_VERIFY_ENABLED: parseEnvBool(raw.ID_VERIFY_ENABLED, false),
    FEISHU_ALERT_ENABLED: parseEnvBool(raw.FEISHU_ALERT_ENABLED, true),
    FEISHU_ALERT_WEBHOOK: raw.FEISHU_ALERT_WEBHOOK || undefined,
  });
}

// ── TRUST_PROXY_HOPS ──────────────────────────────────────────────

test('TRUST_PROXY_HOPS: normal value (3) is parsed correctly', () => {
  const result = preprocessAndParse({ TRUST_PROXY_HOPS: '3' });
  assert.equal(result.TRUST_PROXY_HOPS, 3);
});

test('TRUST_PROXY_HOPS: defaults to 2 when not set', () => {
  const result = preprocessAndParse({});
  assert.equal(result.TRUST_PROXY_HOPS, 2);
});

test('TRUST_PROXY_HOPS: rejects 0 (below min)', () => {
  assert.throws(
    () => preprocessAndParse({ TRUST_PROXY_HOPS: '0' }),
    (err: unknown) => err instanceof z.ZodError
  );
});

test('TRUST_PROXY_HOPS: rejects 6 (above max)', () => {
  assert.throws(
    () => preprocessAndParse({ TRUST_PROXY_HOPS: '6' }),
    (err: unknown) => err instanceof z.ZodError
  );
});

// ── parseEnvBool (ID_VERIFY_ENABLED) ──────────────────────────────

test('parseEnvBool: "true" parses to true', () => {
  const result = preprocessAndParse({ ID_VERIFY_ENABLED: 'true' });
  assert.equal(result.ID_VERIFY_ENABLED, true);
});

test('parseEnvBool: "yes" parses to true', () => {
  const result = preprocessAndParse({ ID_VERIFY_ENABLED: 'yes' });
  assert.equal(result.ID_VERIFY_ENABLED, true);
});

test('parseEnvBool: unset uses fallback (false for ID_VERIFY, true for ALERT)', () => {
  const result = preprocessAndParse({});
  assert.equal(result.ID_VERIFY_ENABLED, false);
  assert.equal(result.FEISHU_ALERT_ENABLED, true);
});

// ── FEISHU_ALERT_WEBHOOK ──────────────────────────────────────────

test('FEISHU_ALERT_WEBHOOK: empty string becomes undefined', () => {
  const result = preprocessAndParse({ FEISHU_ALERT_WEBHOOK: '' });
  assert.equal(result.FEISHU_ALERT_WEBHOOK, undefined);
});
