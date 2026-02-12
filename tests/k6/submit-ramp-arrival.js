import http from 'k6/http';
import { check, sleep } from 'k6';
import { getCachedCsrfToken } from './lib/csrf.js';

// Submit-only stress test (no OSS upload).
//
// Runs a submission pipeline:
// - GET  /api/csrf
// - POST /api/submissions  (consumer)
//
// Use:
//   k6 run tests/k6/submit-ramp-arrival.js
//   BASE_URL=http://112.124.103.65:8080 k6 run tests/k6/submit-ramp-arrival.js
//
// Note: This test will create rows in PostgreSQL and jobs in Redis.

export const options = {
  noCookiesReset: true,
  scenarios: {
    ramp: {
      executor: 'ramping-arrival-rate',
      timeUnit: '1s',
      startRate: 5,
      preAllocatedVUs: 100,
      maxVUs: 800,
      stages: [
        { target: 10, duration: '30s' },
        { target: 20, duration: '30s' },
        { target: 50, duration: '60s' },
        { target: 100, duration: '60s' },
        { target: 150, duration: '60s' },
        { target: 200, duration: '60s' },
        { target: 250, duration: '60s' },
        { target: 300, duration: '60s' },
        { target: 0, duration: '20s' }
      ]
    }
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<2000']
  }
};

const BASE_URL = __ENV.BASE_URL || 'http://112.124.103.65:8080';

function randomPhone() {
  return `1${Math.floor(3 + Math.random() * 6)}${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
}

function randInt(maxExclusive) {
  return Math.floor(Math.random() * maxExclusive);
}

export default function () {
  const csrfToken = getCachedCsrfToken(BASE_URL, { timeout: __ENV.HTTP_TIMEOUT || '2s' });
  if (!csrfToken) return;

  const idNumber = `K6C-${Date.now()}-${__VU}-${randInt(1e6)}`.slice(0, 20);
  const payload = {
    clientRequestId: `k6-${Date.now()}-${__VU}-${__ITER}`,
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
    timeout: __ENV.HTTP_TIMEOUT || '2s'
  });

  check(res, {
    'submit 202': (r) => r.status === 202
  });

  // Keep a tiny sleep to reduce client-side busy looping.
  sleep(0.01);
}
