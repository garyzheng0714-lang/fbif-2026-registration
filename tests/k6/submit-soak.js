import http from 'k6/http';
import { check, sleep } from 'k6';

// Soak test: steady load for a longer time window.
//
// Default is 10 minutes at 20 req/s. Override:
//   SOAK_RPS=10 SOAK_MINUTES=30 BASE_URL=... k6 run tests/k6/submit-soak.js
export const options = {
  scenarios: {
    soak: {
      executor: 'constant-arrival-rate',
      timeUnit: '1s',
      rate: Number(__ENV.SOAK_RPS || 20),
      duration: `${Number(__ENV.SOAK_MINUTES || 10)}m`,
      preAllocatedVUs: 200,
      maxVUs: 3000
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
  const csrfRes = http.get(`${BASE_URL}/api/csrf`, { tags: { name: 'csrf' } });
  const csrfToken = csrfRes.json('csrfToken');
  check(csrfRes, { 'csrf 200': (r) => r.status === 200 });
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
    tags: { name: 'submit' }
  });

  check(res, { 'submit 202': (r) => r.status === 202 });
  sleep(0.01);
}

