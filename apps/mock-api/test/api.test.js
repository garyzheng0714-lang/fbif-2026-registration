import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { clearSubmissions } from '../src/store.js';

const app = createApp();
let server = null;

test.before(async () => {
  // Supertest auto-binds to 0.0.0.0 when given an express app, which is blocked in
  // the Codex sandbox. Bind explicitly to localhost instead.
  await new Promise((resolve, reject) => {
    const s = app.listen(0, '127.0.0.1', resolve);
    s.on('error', reject);
    server = s;
  });
});

test.after(() => {
  server?.close();
  server = null;
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const validPayload = {
  phone: '13800138000',
  name: '张三',
  title: '运营负责人',
  company: '飞书科技',
  idNumber: '11010119900307803X'
};

test.afterEach(() => {
  clearSubmissions();
});

test('GET /api/csrf returns csrf token and cookie', async () => {
  const res = await request(server).get('/api/csrf');

  assert.equal(res.status, 200);
  assert.equal(typeof res.body.csrfToken, 'string');
  assert.ok(res.headers['set-cookie']);
});

test('POST /api/submissions rejects request without csrf', async () => {
  const res = await request(server)
    .post('/api/submissions')
    .send(validPayload);

  assert.equal(res.status, 403);
});

test('POST /api/submissions validates request body', async () => {
  const csrfRes = await request(server).get('/api/csrf');
  const cookie = csrfRes.headers['set-cookie'][0];
  const token = csrfRes.body.csrfToken;

  const res = await request(server)
    .post('/api/submissions')
    .set('Cookie', cookie)
    .set('X-CSRF-Token', token)
    .send({ ...validPayload, phone: '123' });

  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'ValidationError');
});

test('submission can be created and reaches SUCCESS status', async () => {
  const csrfRes = await request(server).get('/api/csrf');
  const cookie = csrfRes.headers['set-cookie'][0];
  const token = csrfRes.body.csrfToken;

  const submitRes = await request(server)
    .post('/api/submissions')
    .set('Cookie', cookie)
    .set('X-CSRF-Token', token)
    .send(validPayload);

  assert.equal(submitRes.status, 202);
  assert.equal(typeof submitRes.body.id, 'string');
  assert.equal(typeof submitRes.body.traceId, 'string');

  let statusRes = await request(server).get(`/api/submissions/${submitRes.body.id}/status`);
  assert.equal(statusRes.status, 200);
  assert.equal(statusRes.body.syncStatus, 'PENDING');

  await sleep(1600);

  statusRes = await request(server).get(`/api/submissions/${submitRes.body.id}/status`);
  assert.equal(statusRes.status, 200);
  assert.equal(statusRes.body.syncStatus, 'SUCCESS');
});

test('industry submissions require proof files', async () => {
  const csrfRes = await request(server).get('/api/csrf');
  const cookie = csrfRes.headers['set-cookie'][0];
  const token = csrfRes.body.csrfToken;

  const res = await request(server)
    .post('/api/submissions')
    .set('Cookie', cookie)
    .set('X-CSRF-Token', token)
    .send({
      ...validPayload,
      role: 'industry',
      businessType: '食品相关品牌方',
      department: '高管/战略'
    });

  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'ValidationError');
});

test('industry submissions accept proof urls in JSON payload', async () => {
  const csrfRes = await request(server).get('/api/csrf');
  const cookie = csrfRes.headers['set-cookie'][0];
  const token = csrfRes.body.csrfToken;

  const submitRes = await request(server)
    .post('/api/submissions')
    .set('Cookie', cookie)
    .set('X-CSRF-Token', token)
    .send({
      ...validPayload,
      role: 'industry',
      idType: 'cn_id',
      businessType: '食品相关品牌方',
      department: '高管/战略',
      proofUrls: [
        'https://fbif-feishu-base.oss-cn-shanghai.aliyuncs.com/fbif-attachment-to-url/2026/02/a.png'
      ]
    });

  assert.equal(submitRes.status, 202);
  assert.equal(typeof submitRes.body.id, 'string');
});

test('industry submissions accept multipart proof files', async () => {
  const csrfRes = await request(server).get('/api/csrf');
  const cookie = csrfRes.headers['set-cookie'][0];
  const token = csrfRes.body.csrfToken;

  const submitRes = await request(server)
    .post('/api/submissions')
    .set('Cookie', cookie)
    .set('X-CSRF-Token', token)
    .field('phone', validPayload.phone)
    .field('name', validPayload.name)
    .field('title', validPayload.title)
    .field('company', validPayload.company)
    .field('idNumber', validPayload.idNumber)
    .field('role', 'industry')
    .field('idType', 'cn_id')
    .field('businessType', '食品相关品牌方')
    .field('department', '高管/战略')
    .attach('proofFiles', Buffer.from('fake-png'), {
      filename: 'proof.png',
      contentType: 'image/png'
    });

  assert.equal(submitRes.status, 202);
  assert.equal(typeof submitRes.body.id, 'string');
});

test('POST /api/oss/policy returns 503 when OSS is not configured', async () => {
  const csrfRes = await request(server).get('/api/csrf');
  const cookie = csrfRes.headers['set-cookie'][0];
  const token = csrfRes.body.csrfToken;

  const res = await request(server)
    .post('/api/oss/policy')
    .set('Cookie', cookie)
    .set('X-CSRF-Token', token)
    .send({
      filename: 'proof.png',
      size: 1024
    });

  assert.equal(res.status, 503);
  assert.equal(res.body.error, 'OSSUnavailable');
});

test('GET /api/submissions/:id/status returns 404 for unknown id', async () => {
  const res = await request(server).get('/api/submissions/not-exists/status');
  assert.equal(res.status, 404);
});
