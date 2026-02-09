import 'dotenv/config';
import crypto from 'node:crypto';

const FEISHU_BASE = 'https://open.feishu.cn/open-apis';

const API_BASE = process.env.API_BASE || 'http://127.0.0.1:8080';
const RUNS = Number(process.env.RUNS || 5);
const ATTACHMENTS_PER_RUN = Number(process.env.ATTACHMENTS_PER_RUN || 3);
const FILE_MB = Number(process.env.FILE_MB || 11);
const POLL_TIMEOUT_MS = Number(process.env.POLL_TIMEOUT_MS || 4 * 60_000);
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 1500);
const MAX_DELTA_MS = Number(process.env.MAX_DELTA_MS || 120_000);
const CLEANUP = (process.env.CLEANUP || '').trim() === '1';

const appId = process.env.FEISHU_APP_ID || '';
const appSecret = process.env.FEISHU_APP_SECRET || '';
const appToken = process.env.FEISHU_APP_TOKEN || '';
const tableId = process.env.FEISHU_TABLE_ID || '';
const proofFieldName = process.env.FEISHU_FIELD_PROOF || '上传专业观众证明';

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mustJson(resp) {
  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`expected json, got: ${text.slice(0, 200)}`);
  }
}

async function getCsrf() {
  const resp = await fetch(`${API_BASE}/api/csrf`, {
    headers: { accept: 'application/json' }
  });
  const data = await mustJson(resp);
  const setCookie = resp.headers.get('set-cookie') || '';
  const cookie = setCookie.split(';')[0]; // mock_csrf=...
  if (!resp.ok || !data?.csrfToken || !cookie) {
    throw new Error('get csrf failed');
  }
  return { csrfToken: data.csrfToken, cookie };
}

async function submitIndustry({ csrfToken, cookie, idNumber, fileBlob, fileType }) {
  const form = new FormData();
  form.append('phone', '13800138000');
  form.append('name', 'SmokeTest');
  form.append('title', 'Engineer');
  form.append('company', 'TestCo');
  form.append('idType', 'passport');
  form.append('idNumber', idNumber);
  form.append('role', 'industry');

  for (let i = 0; i < ATTACHMENTS_PER_RUN; i += 1) {
    const fileName = `proof_${Date.now()}_${i + 1}.bin`;
    form.append('proofFiles', fileBlob, fileName);
  }

  const resp = await fetch(`${API_BASE}/api/submissions`, {
    method: 'POST',
    headers: {
      cookie,
      'X-CSRF-Token': csrfToken,
      accept: 'application/json'
    },
    body: form,
    duplex: 'half'
  });
  const data = await mustJson(resp);
  if (!resp.ok || !data?.id) {
    throw new Error(`submit failed: ${data?.error || resp.statusText}`);
  }
  return { submissionId: data.id, traceId: data.traceId || '', syncStatus: data.syncStatus || '' };
}

async function pollStatus(submissionId) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const resp = await fetch(`${API_BASE}/api/submissions/${submissionId}/status`, {
      headers: { accept: 'application/json' }
    });
    const data = await mustJson(resp);
    if (!resp.ok) {
      throw new Error(`status failed: ${data?.error || resp.statusText}`);
    }
    if (data.syncStatus === 'SUCCESS' || data.syncStatus === 'FAILED') {
      return data;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error('poll timeout');
}

async function getTenantAccessToken() {
  if (!appId || !appSecret) throw new Error('missing feishu app config');
  const resp = await fetch(`${FEISHU_BASE}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret })
  });
  const data = await mustJson(resp);
  if (!resp.ok || data.code !== 0 || !data?.tenant_access_token) {
    throw new Error(`get tenant token failed: ${data?.msg || resp.statusText}`);
  }
  return data.tenant_access_token;
}

async function getBitableRecord({ token, recordId }) {
  if (!appToken || !tableId) throw new Error('missing bitable config');
  const resp = await fetch(`${FEISHU_BASE}/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await mustJson(resp);
  if (!resp.ok || data.code !== 0) {
    throw new Error(`get record failed: ${data?.msg || resp.statusText}`);
  }
  return data?.data?.record || null;
}

async function deleteBitableRecord({ token, recordId }) {
  const resp = await fetch(`${FEISHU_BASE}/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await mustJson(resp);
  if (!resp.ok || data.code !== 0) {
    throw new Error(`delete record failed: ${data?.msg || resp.statusText}`);
  }
}

async function assertAttachmentUrlsAccessible({ token, attachments, expectedType }) {
  for (const item of attachments) {
    const url = item?.url;
    if (!url) throw new Error('missing attachment url');

    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        // Avoid full download if server supports range.
        Range: 'bytes=0-0'
      }
    });
    if (!resp.ok) {
      throw new Error(`attachment url not accessible: ${resp.status}`);
    }

    const ct = (resp.headers.get('content-type') || '').toLowerCase();
    if (expectedType && !ct.includes(expectedType.toLowerCase())) {
      throw new Error(`content-type mismatch: expected~=${expectedType} got=${ct}`);
    }
    resp.body?.cancel?.();
  }
}

async function main() {
  const idNumber = process.env.TEST_ID_NUMBER || 'TEST001X';
  const idSuffix = String(idNumber).slice(-4);
  const fileType = process.env.FILE_TYPE || 'application/octet-stream';
  const fileBytes = FILE_MB * 1024 * 1024;

  console.log(`${nowIso()} starting smoke: runs=${RUNS} attachments=${ATTACHMENTS_PER_RUN} fileMb=${FILE_MB} idSuffix=${idSuffix} cleanup=${CLEANUP ? '1' : '0'}`);

  const { csrfToken, cookie } = await getCsrf();
  const fileBlob = new Blob([crypto.randomBytes(fileBytes)], { type: fileType });

  const token = await getTenantAccessToken();

  const results = [];
  for (let i = 0; i < RUNS; i += 1) {
    console.log(`${nowIso()} run ${i + 1}/${RUNS}: submitting...`);
    const { submissionId, traceId } = await submitIndustry({ csrfToken, cookie, idNumber, fileBlob, fileType });
    console.log(`${nowIso()} run ${i + 1}/${RUNS}: accepted submissionId=${submissionId} traceId=${traceId}`);

    const status = await pollStatus(submissionId);
    const recordId = status?.feishuRecordId || '';
    console.log(`${nowIso()} run ${i + 1}/${RUNS}: syncStatus=${status?.syncStatus} recordIdSuffix=${String(recordId).slice(-6)} deltaMs=${status?.syncTimings?.attachmentsUploadedAtMs - status?.syncTimings?.recordCreatedAtMs}`);

    if (status?.syncStatus !== 'SUCCESS') {
      throw new Error(`run ${i + 1} failed: ${status?.syncError || 'unknown'}`);
    }
    if (!recordId) {
      throw new Error('missing feishuRecordId');
    }

    const deltaMs = Number(status?.syncTimings?.attachmentsUploadedAtMs || 0) - Number(status?.syncTimings?.recordCreatedAtMs || 0);
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) {
      throw new Error(`invalid timings deltaMs=${deltaMs}`);
    }
    if (deltaMs > MAX_DELTA_MS) {
      throw new Error(`timing regression: deltaMs=${deltaMs} > MAX_DELTA_MS=${MAX_DELTA_MS}`);
    }

    const record = await getBitableRecord({ token, recordId });
    const attachments = record?.fields?.[proofFieldName] || null;
    if (!Array.isArray(attachments) || attachments.length !== ATTACHMENTS_PER_RUN) {
      throw new Error(`attachment count mismatch: want=${ATTACHMENTS_PER_RUN} got=${Array.isArray(attachments) ? attachments.length : 0}`);
    }

    await assertAttachmentUrlsAccessible({ token, attachments, expectedType: fileType });

    results.push({ submissionId, traceId, recordId, deltaMs, attachmentCount: attachments.length });

    if (CLEANUP) {
      await deleteBitableRecord({ token, recordId });
      console.log(`${nowIso()} run ${i + 1}/${RUNS}: cleanup ok recordIdSuffix=${String(recordId).slice(-6)}`);
    }
  }

  const avgDelta = Math.round(results.reduce((sum, r) => sum + r.deltaMs, 0) / Math.max(1, results.length));
  console.log(`${nowIso()} smoke ok: runs=${results.length} avgDeltaMs=${avgDelta}`);
}

main().catch((err) => {
  console.error(`${nowIso()} smoke failed:`, err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});

