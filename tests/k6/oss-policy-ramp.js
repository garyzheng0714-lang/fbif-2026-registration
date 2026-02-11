import http from 'k6/http';
import { check, sleep } from 'k6';

// OSS policy signing stress test (no actual file upload).
export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-arrival-rate',
      timeUnit: '1s',
      startRate: 5,
      preAllocatedVUs: 100,
      maxVUs: 1500,
      stages: [
        { target: 20, duration: '30s' },
        { target: 50, duration: '30s' },
        { target: 100, duration: '60s' },
        { target: 200, duration: '60s' },
        { target: 300, duration: '60s' },
        { target: 400, duration: '60s' },
        { target: 500, duration: '60s' },
        { target: 0, duration: '20s' }
      ]
    }
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],
    http_req_duration: ['p(95)<1500']
  }
};

const BASE_URL = __ENV.BASE_URL || 'http://112.124.103.65:8080';

export default function () {
  const csrfRes = http.get(`${BASE_URL}/api/csrf`, { tags: { name: 'csrf' } });
  const csrfToken = csrfRes.json('csrfToken');
  check(csrfRes, { 'csrf 200': (r) => r.status === 200 });
  if (!csrfToken) return;

  const body = JSON.stringify({
    filename: `proof-${Date.now()}-${__VU}-${__ITER}.bin`,
    size: 20 * 1024 * 1024
  });

  const res = http.post(`${BASE_URL}/api/oss/policy`, body, {
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken
    },
    tags: { name: 'oss_policy' }
  });

  check(res, { 'policy 200': (r) => r.status === 200 });
  sleep(0.005);
}

