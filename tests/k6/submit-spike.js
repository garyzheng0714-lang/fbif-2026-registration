import http from 'k6/http';
import { check, sleep } from 'k6';

// Spike test: sudden burst of submission requests.
export const options = {
  scenarios: {
    spike: {
      executor: 'ramping-arrival-rate',
      timeUnit: '1s',
      startRate: 0,
      preAllocatedVUs: 200,
      maxVUs: 3000,
      stages: [
        { target: 0, duration: '10s' },
        { target: 300, duration: '10s' }, // spike up fast
        { target: 300, duration: '50s' }, // hold
        { target: 0, duration: '20s' }
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
  const csrfRes = http.get(`${BASE_URL}/api/csrf`, { tags: { name: 'csrf' } });
  const csrfToken = csrfRes.json('csrfToken');
  check(csrfRes, { 'csrf 200': (r) => r.status === 200 });
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
    tags: { name: 'submit' }
  });

  check(res, { 'submit 202': (r) => r.status === 202 || r.status === 429 });
  sleep(0.01);
}

