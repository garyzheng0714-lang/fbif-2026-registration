import http from 'k6/http';
import { check, sleep } from 'k6';
import { getCachedCsrfToken } from './lib/csrf.js';

// Soak test: steady load for a longer time window.
//
// Default is 10 minutes at 20 req/s. Override:
//   SOAK_RPS=10 SOAK_MINUTES=30 BASE_URL=... k6 run tests/k6/submit-soak.js
export const options = {
  noCookiesReset: true,
  scenarios: {
    soak: {
      executor: 'constant-arrival-rate',
      timeUnit: '1s',
      rate: Number(__ENV.SOAK_RPS || 20),
      duration: `${Number(__ENV.SOAK_MINUTES || 10)}m`,
      preAllocatedVUs: Number(__ENV.PREALLOCATED_VUS || 200),
      maxVUs: Number(__ENV.MAX_VUS || 1000)
    }
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1500']
  }
};

const BASE_URL = __ENV.BASE_URL || 'http://112.124.103.65:8080';

function randomPhone() {
  return `1${Math.floor(3 + Math.random() * 6)}${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
}

export default function () {
  const csrfToken = getCachedCsrfToken(BASE_URL, { timeout: __ENV.HTTP_TIMEOUT || '2s' });
  if (!csrfToken) return;

  const payload = {
    clientRequestId: `k6-soak-${Date.now()}-${__VU}-${__ITER}`,
    role: 'consumer',
    idType: 'other',
    idNumber: `SOAK${Date.now()}${__VU}`.slice(0, 20),
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

  check(res, { 'submit 202': (r) => r.status === 202 });
  sleep(0.01);
}
