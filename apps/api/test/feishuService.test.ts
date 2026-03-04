import test from 'node:test';
import assert from 'node:assert/strict';

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function ensureTestEnv() {
  process.env.NODE_ENV = 'test';
  process.env.WEB_ORIGIN = process.env.WEB_ORIGIN || 'http://localhost:5173';
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/fbif_form';
  process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
  process.env.DATA_KEY = process.env.DATA_KEY || 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
  process.env.DATA_HASH_SALT = process.env.DATA_HASH_SALT || 'test_hash_salt_123456';
  process.env.FEISHU_APP_ID = process.env.FEISHU_APP_ID || 'cli_test';
  process.env.FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || 'secret_test';
  process.env.FEISHU_APP_TOKEN = process.env.FEISHU_APP_TOKEN || 'app_token_test';
  process.env.FEISHU_TABLE_ID = process.env.FEISHU_TABLE_ID || 'tbl_test';
}

test('mapSubmissionToBitableFields includes click attribution fields', async () => {
  const originalFetch = global.fetch;
  ensureTestEnv();
  process.env.FEISHU_FIELD_CLICK_ID = '腾讯广告点击ID';
  process.env.FEISHU_FIELD_CLICK_ID_SOURCE_KEY = '腾讯广告点击ID来源字段';

  global.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/auth/v3/tenant_access_token/internal')) {
      return jsonResponse({
        code: 0,
        tenant_access_token: 'tenant-token',
        expire: 3600
      });
    }

    if (url.includes('/fields?page_size=200')) {
      return jsonResponse({
        code: 0,
        data: {
          items: []
        }
      });
    }

    throw new Error(`unexpected fetch url: ${url}`);
  }) as typeof fetch;

  try {
    const { mapSubmissionToBitableFields } = await import(`../src/services/feishuService.ts?test=${Date.now()}`);
    const mapped = await mapSubmissionToBitableFields({
      submission: {
        id: 'submission-id',
        clientRequestId: 'client-request-id',
        traceId: 'trace-id',
        role: 'consumer',
        idType: 'passport',
        name: '张三',
        title: '消费者',
        company: '个人消费者',
        phoneEnc: 'enc-phone',
        phoneHash: 'hash-phone',
        idEnc: 'enc-id',
        idHash: 'hash-id',
        businessType: null,
        department: null,
        proofUrls: null,
        syncStatus: 'SUCCESS',
        syncError: null,
        syncAttempts: 0,
        lastAttemptAt: null,
        nextAttemptAt: null,
        feishuRecordId: null,
        clickId: 'click-abc',
        clickIdSourceKey: 'qz_gdt',
        clientIp: null,
        userAgent: null,
        createdAt: new Date('2026-03-04T00:00:00.000Z'),
        updatedAt: new Date('2026-03-04T00:00:00.000Z')
      } as any,
      sensitive: {
        phone: '+8613800000000',
        idNumber: 'A1234567'
      }
    });

    assert.equal(mapped.readableFields['腾讯广告点击ID'], 'click-abc');
    assert.equal(mapped.readableFields['腾讯广告点击ID来源字段'], 'qz_gdt');
  } finally {
    global.fetch = originalFetch;
    delete process.env.FEISHU_FIELD_CLICK_ID;
    delete process.env.FEISHU_FIELD_CLICK_ID_SOURCE_KEY;
  }
});
