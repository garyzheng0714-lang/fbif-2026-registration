import http from 'k6/http';
import { check, sleep } from 'k6';

// NOTE (2026-02-10):
// Production flow has migrated to `apps/api` + OSS direct upload.
// Attachments are uploaded by browser directly to OSS and then submitted as `proofUrls` (JSON),
// so this k6 script (multipart upload to /api/submissions) is kept only for the legacy mock-api path.
// Use:
// - Accept-only: tests/k6/form-submit.js
// - Real OSS upload: tests/load/mixed_oss_100.sh

export const options = {
  scenarios: {
    one_shot_100: {
      executor: 'per-vu-iterations',
      vus: 100,
      iterations: 1,
      maxDuration: '2m'
    }
  },
  thresholds: {
    http_req_failed: ['rate<0.01']
  }
};

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:8080';
const PROOF_FILE_PATH = __ENV.PROOF_FILE_PATH || '/opt/web-fbif-form/current/apps/web/dist/banner.png';

const proofBin = open(PROOF_FILE_PATH, 'b');

function randomPhone() {
  return `1${Math.floor(3 + Math.random() * 6)}${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
}

function pad3(n) {
  return String(n).padStart(3, '0');
}

export default function () {
  const isIndustry = __VU <= 60; // 60 industry, 40 consumer.
  const csrfRes = http.get(`${BASE_URL}/api/csrf`);
  const csrfToken = csrfRes.json('csrfToken');

  if (!csrfToken) {
    check(csrfRes, { 'csrf ok': (r) => r.status === 200 });
    return;
  }

  if (isIndustry) {
    const idNumber = `K6L${pad3(__VU)}001X`; // 6-20 chars, ends with 001X for easier filtering.
    const payload = {
      role: 'industry',
      idType: 'passport',
      idNumber,
      phone: randomPhone(),
      name: `压测行业${__VU}`,
      title: '运营负责人',
      company: '压测公司',
      businessType: '食品相关品牌方',
      department: '高管/战略',
      proofFiles: http.file(proofBin, `proof-${pad3(__VU)}.png`, 'image/png')
    };

    const res = http.post(`${BASE_URL}/api/submissions`, payload, {
      headers: {
        'X-CSRF-Token': csrfToken
      }
    });

    check(res, { 'industry submit accepted': (r) => r.status === 202 });
    sleep(0.1);
    return;
  }

  const idNumber = `K6C${pad3(__VU)}001X`;
  const payload = {
    role: 'consumer',
    idType: 'passport',
    idNumber,
    phone: randomPhone(),
    name: `压测消费者${__VU}`,
    title: '消费者',
    company: '个人消费者'
  };

  const res = http.post(`${BASE_URL}/api/submissions`, JSON.stringify(payload), {
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken
    }
  });

  check(res, { 'consumer submit accepted': (r) => r.status === 202 });
  sleep(0.1);
}
