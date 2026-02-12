import http from 'k6/http';
import { check, sleep } from 'k6';
import { getCachedCsrfToken } from './lib/csrf.js';

// Spike test: sudden burst of submission requests.
const SPIKE_RATE = Number(__ENV.SPIKE_RATE || 300);
const SPIKE_RISE = String(__ENV.SPIKE_RISE || '10s');
const SPIKE_HOLD = String(__ENV.SPIKE_HOLD || '50s');
const SPIKE_COOL = String(__ENV.SPIKE_COOL || '20s');

export const options = {
  noCookiesReset: true,
  scenarios: {
    spike: {
      executor: 'ramping-arrival-rate',
      timeUnit: '1s',
      startRate: 0,
      preAllocatedVUs: 200,
      maxVUs: 1000,
      stages: [
        { target: 0, duration: '10s' },
        { target: SPIKE_RATE, duration: SPIKE_RISE }, // spike up fast
        { target: SPIKE_RATE, duration: SPIKE_HOLD }, // hold
        { target: 0, duration: SPIKE_COOL }
      ]
    }
  },
  thresholds: {
    http_req_failed: ['rate<0.03'],
    http_req_duration: ['p(95)<3000']
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
    clientRequestId: `k6-spike-${Date.now()}-${__VU}-${__ITER}`,
    role: 'consumer',
    idType: 'other',
    idNumber: `SPK${Date.now()}${__VU}`.slice(0, 20),
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

  check(res, { 'submit 202': (r) => r.status === 202 || r.status === 429 });
  sleep(0.01);
}
