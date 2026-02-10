import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 100,
  duration: '30s'
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';

const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
const codes = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];

function makeId(base17) {
  let sum = 0;
  for (let i = 0; i < 17; i += 1) {
    sum += Number(base17[i]) * weights[i];
  }
  return `${base17}${codes[sum % 11]}`;
}

function randomPhone() {
  return `1${Math.floor(3 + Math.random() * 6)}${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
}

export default function () {
  const csrfRes = http.get(`${BASE_URL}/api/csrf`);
  const csrfToken = csrfRes.json('csrfToken');

  const base17 = `11010119900307${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`;
  const payload = {
    role: 'consumer',
    idType: 'cn_id',
    idNumber: makeId(base17),
    phone: randomPhone(),
    name: '压测用户',
    title: '消费者',
    company: '个人消费者'
  };

  const res = http.post(`${BASE_URL}/api/submissions`, JSON.stringify(payload), {
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken
    }
  });

  check(res, { 'submit ok': (r) => r.status === 202 });
  sleep(0.5);
}
