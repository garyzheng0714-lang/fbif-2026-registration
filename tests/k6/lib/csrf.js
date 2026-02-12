import http from 'k6/http';
import { check } from 'k6';

let cachedToken = null;
let cachedAtMs = 0;

function nowMs() {
  return Date.now();
}

export function getCachedCsrfToken(baseUrl, opts = {}) {
  const ttlMs = Number(opts.ttlMs || (__ENV.CSRF_TTL_SECONDS ? Number(__ENV.CSRF_TTL_SECONDS) * 1000 : 300_000));
  const timeout = String(opts.timeout || (__ENV.HTTP_TIMEOUT || '2s'));

  if (cachedToken && nowMs() - cachedAtMs < ttlMs) return cachedToken;

  const res = http.get(`${baseUrl}/api/csrf`, { tags: { name: 'csrf' }, timeout });
  check(res, { 'csrf 200': (r) => r.status === 200 });
  if (res.status !== 200) return null;

  let token = null;
  try {
    token = res.json('csrfToken');
  } catch {
    token = null;
  }
  if (!token) return null;

  cachedToken = token;
  cachedAtMs = nowMs();
  return cachedToken;
}

