import http from 'k6/http';
import { check, sleep } from 'k6';
import { getCachedCsrfToken } from './lib/csrf.js';

// Controlled ramp-to-failure test (guardrails for small instances).
//
// Example:
//   BASE_URL=http://112.124.103.65:8080 MAX_RATE=200 STEP=20 STEP_DURATION=20s docker run --rm -i -v "$PWD":/work -w /work grafana/k6:1.6.0 run tests/k6/submit-step-ramp.js
//
// Notes:
// - Each iteration does: POST /api/submissions (consumer)
// - CSRF token is cached per VU (default TTL 5m).

const BASE_URL = __ENV.BASE_URL || 'http://112.124.103.65:8080';
const HTTP_TIMEOUT = __ENV.HTTP_TIMEOUT || '2s';

const MAX_RATE = Number(__ENV.MAX_RATE || 160);
const STEP = Number(__ENV.STEP || 20);
const STEP_DURATION = String(__ENV.STEP_DURATION || '20s');

const stages = [];
for (let r = STEP; r <= MAX_RATE; r += STEP) stages.push({ target: r, duration: STEP_DURATION });
stages.push({ target: 0, duration: '10s' });

export const options = {
  noCookiesReset: true,
  scenarios: {
    step_ramp: {
      executor: 'ramping-arrival-rate',
      timeUnit: '1s',
      startRate: 0,
      preAllocatedVUs: Number(__ENV.PREALLOCATED_VUS || 100),
      maxVUs: Number(__ENV.MAX_VUS || 800),
      stages
    }
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<2000']
  }
};

function randomPhone() {
  return `1${Math.floor(3 + Math.random() * 6)}${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
}

function randInt(maxExclusive) {
  return Math.floor(Math.random() * maxExclusive);
}

export default function () {
  const csrfToken = getCachedCsrfToken(BASE_URL, { timeout: HTTP_TIMEOUT });
  if (!csrfToken) return;

  const idNumber = `K6STEP-${Date.now()}-${__VU}-${randInt(1e6)}`.slice(0, 20);
  const payload = {
    clientRequestId: `k6-step-${Date.now()}-${__VU}-${__ITER}`,
    role: 'consumer',
    idType: 'other',
    idNumber,
    phone: randomPhone(),
    name: '压测用户',
    title: '消费者',
    company: '个人消费者'
  };

  const res = http.post(`${BASE_URL}/api/submissions`, JSON.stringify(payload), {
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken
    },
    tags: { name: 'submit' },
    timeout: HTTP_TIMEOUT
  });

  check(res, { 'submit 202': (r) => r.status === 202 });
  sleep(0.005);
}
