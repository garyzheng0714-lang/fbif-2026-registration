import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { clearSubmissions } from '../src/store.js';

const app = createApp();

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
  const res = await request(app).get('/api/csrf');

  assert.equal(res.status, 200);
  assert.equal(typeof res.body.csrfToken, 'string');
  assert.ok(res.headers['set-cookie']);
});

test('POST /api/submissions rejects request without csrf', async () => {
  const res = await request(app)
    .post('/api/submissions')
    .send(validPayload);

  assert.equal(res.status, 403);
});

test('POST /api/submissions validates request body', async () => {
  const csrfRes = await request(app).get('/api/csrf');
  const cookie = csrfRes.headers['set-cookie'][0];
  const token = csrfRes.body.csrfToken;

  const res = await request(app)
    .post('/api/submissions')
    .set('Cookie', cookie)
    .set('X-CSRF-Token', token)
    .send({ ...validPayload, phone: '123' });

  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'ValidationError');
});

test('submission can be created and reaches SUCCESS status', async () => {
  const csrfRes = await request(app).get('/api/csrf');
  const cookie = csrfRes.headers['set-cookie'][0];
  const token = csrfRes.body.csrfToken;

  const submitRes = await request(app)
    .post('/api/submissions')
    .set('Cookie', cookie)
    .set('X-CSRF-Token', token)
    .send(validPayload);

  assert.equal(submitRes.status, 202);
  assert.equal(typeof submitRes.body.id, 'string');
  assert.equal(typeof submitRes.body.traceId, 'string');

  let statusRes = await request(app).get(`/api/submissions/${submitRes.body.id}/status`);
  assert.equal(statusRes.status, 200);
  assert.equal(statusRes.body.syncStatus, 'PENDING');

  await sleep(1600);

  statusRes = await request(app).get(`/api/submissions/${submitRes.body.id}/status`);
  assert.equal(statusRes.status, 200);
  assert.equal(statusRes.body.syncStatus, 'SUCCESS');
});

test('industry submissions require proof files', async () => {
  const csrfRes = await request(app).get('/api/csrf');
  const cookie = csrfRes.headers['set-cookie'][0];
  const token = csrfRes.body.csrfToken;

  const res = await request(app)
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

test('industry submissions accept multipart proof files', async () => {
  const csrfRes = await request(app).get('/api/csrf');
  const cookie = csrfRes.headers['set-cookie'][0];
  const token = csrfRes.body.csrfToken;

  const submitRes = await request(app)
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

test('GET /api/submissions/:id/status returns 404 for unknown id', async () => {
  const res = await request(app).get('/api/submissions/not-exists/status');
  assert.equal(res.status, 404);
});
