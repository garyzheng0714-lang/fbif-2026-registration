import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

function ensureTestEnv() {
  process.env.NODE_ENV = 'test';
  process.env.WEB_ORIGIN = process.env.WEB_ORIGIN || 'http://localhost:5173';
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/fbif_form';
  process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

  // 32-byte base64 key (test-only).
  process.env.DATA_KEY = process.env.DATA_KEY || 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
  process.env.DATA_HASH_SALT = process.env.DATA_HASH_SALT || 'test_hash_salt_123456';

  // Dummy Feishu config for env validation (worker not started in tests).
  process.env.FEISHU_APP_ID = process.env.FEISHU_APP_ID || 'cli_test';
  process.env.FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || 'secret_test';
  process.env.FEISHU_APP_TOKEN = process.env.FEISHU_APP_TOKEN || 'app_token_test';
  process.env.FEISHU_TABLE_ID = process.env.FEISHU_TABLE_ID || 'tbl_test';

  process.env.RATE_LIMIT_WINDOW_MS = process.env.RATE_LIMIT_WINDOW_MS || '60000';
  process.env.RATE_LIMIT_MAX = process.env.RATE_LIMIT_MAX || '9999';
  process.env.RATE_LIMIT_BURST = process.env.RATE_LIMIT_BURST || '9999';

  // Disabled by default in tests unless a case explicitly enables it.
  process.env.ID_VERIFY_ENABLED = process.env.ID_VERIFY_ENABLED || 'false';
  process.env.ID_VERIFY_APPCODE = process.env.ID_VERIFY_APPCODE || '';
}

let server: any = null;
let prisma: any = null;
let redis: any = null;

test.before(async () => {
  ensureTestEnv();

  const { createServer } = await import('../src/server.ts');
  const app = createServer();

  await new Promise<void>((resolve, reject) => {
    const s = app.listen(0, '127.0.0.1', () => resolve());
    s.on('error', reject);
    server = s;
  });

  prisma = (await import('../src/utils/db.ts')).prisma;
  redis = (await import('../src/queue/redis.ts')).redis;
});

test.after(async () => {
  server?.close();
  server = null;

  await prisma?.$disconnect();
  prisma = null;

  try {
    await redis?.quit();
  } catch {
    // ignore
  }
  redis = null;
});

test.beforeEach(async () => {
  await prisma.submission.deleteMany({});
});

test('GET /api/csrf returns csrf token, cookie, and trace header', async () => {
  const res = await request(server).get('/api/csrf');

  assert.equal(res.status, 200);
  assert.equal(typeof res.body.csrfToken, 'string');
  assert.ok(res.headers['set-cookie']);
  assert.equal(typeof res.headers['x-trace-id'], 'string');
});

test('POST /api/oss/policy returns 503 when OSS is not configured', async () => {
  const csrfRes = await request(server).get('/api/csrf');
  const cookie = csrfRes.headers['set-cookie'][0];
  const token = csrfRes.body.csrfToken;

  const res = await request(server)
    .post('/api/oss/policy')
    .set('Cookie', cookie)
    .set('X-CSRF-Token', token)
    .send({ filename: 'proof.png', size: 123 });

  assert.equal(res.status, 503);
  assert.equal(res.body.error, 'OSSUnavailable');
});

test('POST /api/submissions rejects request without csrf', async () => {
  const res = await request(server)
    .post('/api/submissions')
    .send({
      role: 'consumer',
      idType: 'other',
      idNumber: 'ABCDEF',
      phone: '13800138000',
      name: '张三',
      title: '消费者',
      company: '个人消费者'
    });

  assert.equal(res.status, 403);
});

test('POST /api/id-verify returns 503 when ID verify is disabled', async () => {
  const csrfRes = await request(server).get('/api/csrf');
  const cookie = csrfRes.headers['set-cookie'][0];
  const token = csrfRes.body.csrfToken;

  const res = await request(server)
    .post('/api/id-verify')
    .set('Cookie', cookie)
    .set('X-CSRF-Token', token)
    .send({
      name: '张三',
      idType: 'cn_id',
      idNumber: '11010519491231002X'
    });

  assert.equal(res.status, 503);
  assert.equal(res.body.error, 'ID_VERIFY_DISABLED');
});

test('consumer submission is accepted and returns id + traceId', async () => {
  const csrfRes = await request(server).get('/api/csrf');
  const cookie = csrfRes.headers['set-cookie'][0];
  const token = csrfRes.body.csrfToken;

  const submitRes = await request(server)
    .post('/api/submissions')
    .set('Cookie', cookie)
    .set('X-CSRF-Token', token)
    .send({
      clientRequestId: 'req-00000001',
      role: 'consumer',
      idType: 'passport',
      idNumber: 'ABCDEF-1234',
      phone: '13800138000',
      name: '张三',
      title: '消费者',
      company: '个人消费者'
    });

  assert.equal(submitRes.status, 202);
  assert.equal(typeof submitRes.body.id, 'string');
  assert.equal(typeof submitRes.body.traceId, 'string');
  assert.equal(submitRes.body.syncStatus, 'PENDING');
});

test('clientRequestId is idempotent', async () => {
  const csrfRes = await request(server).get('/api/csrf');
  const cookie = csrfRes.headers['set-cookie'][0];
  const token = csrfRes.body.csrfToken;

  const payload = {
    clientRequestId: 'req-idempotent',
    role: 'consumer',
    idType: 'passport',
    idNumber: 'ABCDEFGH',
    phone: '13800138000',
    name: '张三',
    title: '消费者',
    company: '个人消费者'
  };

  const r1 = await request(server)
    .post('/api/submissions')
    .set('Cookie', cookie)
    .set('X-CSRF-Token', token)
    .send(payload);
  const r2 = await request(server)
    .post('/api/submissions')
    .set('Cookie', cookie)
    .set('X-CSRF-Token', token)
    .send(payload);

  assert.equal(r1.status, 202);
  assert.equal(r2.status, 202);
  assert.equal(r1.body.id, r2.body.id);
  assert.equal(r1.body.traceId, r2.body.traceId);
});

test('industry submission requires proofUrls', async () => {
  const csrfRes = await request(server).get('/api/csrf');
  const cookie = csrfRes.headers['set-cookie'][0];
  const token = csrfRes.body.csrfToken;

  const res = await request(server)
    .post('/api/submissions')
    .set('Cookie', cookie)
    .set('X-CSRF-Token', token)
    .send({
      clientRequestId: 'req-industry-1',
      role: 'industry',
      idType: 'passport',
      idNumber: 'ABCDEFGH',
      phone: '13800138000',
      name: '张三',
      title: '运营负责人',
      company: '测试公司',
      businessType: '食品相关品牌方',
      department: '高管/战略'
    });

  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'ValidationError');
});

test('industry submission accepts proofUrls array', async () => {
  const csrfRes = await request(server).get('/api/csrf');
  const cookie = csrfRes.headers['set-cookie'][0];
  const token = csrfRes.body.csrfToken;

  const res = await request(server)
    .post('/api/submissions')
    .set('Cookie', cookie)
    .set('X-CSRF-Token', token)
    .send({
      clientRequestId: 'req-industry-2',
      role: 'industry',
      idType: 'passport',
      idNumber: 'ABCDEFGH',
      phone: '13800138000',
      name: '张三',
      title: '运营负责人',
      company: '测试公司',
      businessType: '食品相关品牌方',
      department: '高管/战略',
      proofUrls: [
        'https://example.com/a.png'
      ]
    });

  assert.equal(res.status, 202);
  assert.equal(typeof res.body.id, 'string');
});
