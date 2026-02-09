import fs from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

const API_BASE = process.env.API_BASE || 'http://127.0.0.1:8080';
const TOTAL = Number(process.env.TOTAL || 100);
const INDUSTRY = Number(process.env.INDUSTRY || 60);
const ATTACHMENTS_PER_INDUSTRY = Math.max(1, Number(process.env.ATTACHMENTS_PER_INDUSTRY || 1));
const ATTACHMENT_MB_CHOICES = String(process.env.ATTACHMENT_MB_CHOICES || '').trim();
const ATTACHMENT_MIN_MB = Number(process.env.ATTACHMENT_MIN_MB || 0);
const ATTACHMENT_MAX_MB = Number(process.env.ATTACHMENT_MAX_MB || 0);
const ATTACHMENT_BUCKET_STEP_MB = Math.max(1, Number(process.env.ATTACHMENT_BUCKET_STEP_MB || 10));
const ATTACHMENT_PICK = String(process.env.ATTACHMENT_PICK || 'cycle').trim().toLowerCase();
const FILE_MB_LIST = String(process.env.FILE_MB_LIST || '').trim();
const FILE_TYPE = String(process.env.FILE_TYPE || 'application/octet-stream').trim() || 'application/octet-stream';
const PROOF_PATH = process.env.PROOF_PATH || '';
const POLL = (process.env.POLL || '1').trim() === '1';
const POLL_TIMEOUT_MS = Number(process.env.POLL_TIMEOUT_MS || 12 * 60_000);
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 2000);

const RUN_MARK = (process.env.RUN_MARK || '').trim() || `LOAD${new Date().toISOString().replace(/[-:.TZ]/g, '')}`;
const ID_SUFFIX = (process.env.ID_SUFFIX || '001X').trim() || '001X';
const COMPANY_MARK = `压测-${RUN_MARK}`;

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomPhone() {
  return `1${Math.floor(3 + Math.random() * 6)}${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
}

function pad3(n) {
  return String(n).padStart(3, '0');
}

function percentile(values, p) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, idx))];
}

function parseMbCsv(text) {
  return String(text || '')
    .split(',')
    .map((v) => Number(String(v).trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
    .map((n) => Math.round(n * 1000) / 1000); // keep stable decimals
}

async function mustJson(resp) {
  const text = await resp.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text.slice(0, 200) };
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
    throw new Error(`csrf_failed: status=${resp.status} body=${JSON.stringify(data || {})}`);
  }
  return { csrfToken: data.csrfToken, cookie };
}

function makeIdNumber(prefix, idx) {
  // 6-20 chars, [A-Za-z0-9-]
  const base = `${prefix}${pad3(idx)}`;
  const raw = `${base}${ID_SUFFIX}`;
  return raw.slice(0, 20);
}

async function submitOne(idx, pickProofBlob) {
  const role = idx <= INDUSTRY ? 'industry' : 'consumer';
  const startedAt = performance.now();

  let csrf;
  try {
    csrf = await getCsrf();
  } catch (error) {
    return {
      idx,
      role,
      ok: false,
      phase: 'csrf',
      status: 0,
      elapsedMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.message : String(error)
    };
  }

  const idNumber = makeIdNumber(role === 'industry' ? 'K6L' : 'K6C', idx);
  const common = {
    phone: randomPhone(),
    name: role === 'industry' ? `压测行业${idx}` : `压测消费者${idx}`,
    title: role === 'industry' ? '运营负责人' : '消费者',
    company: role === 'industry' ? COMPANY_MARK : '个人消费者',
    idType: 'passport',
    idNumber,
    role
  };

  const headers = {
    cookie: csrf.cookie,
    'X-CSRF-Token': csrf.csrfToken,
    accept: 'application/json'
  };

  try {
    let resp;
    if (role === 'industry') {
      const form = new FormData();
      form.append('phone', common.phone);
      form.append('name', common.name);
      form.append('title', common.title);
      form.append('company', common.company);
      form.append('idType', common.idType);
      form.append('idNumber', common.idNumber);
      form.append('role', common.role);
      form.append('businessType', '食品相关品牌方');
      form.append('department', '高管/战略');

      for (let i = 0; i < ATTACHMENTS_PER_INDUSTRY; i += 1) {
        // Unique filename to bypass sha256+filename cache in the service.
        const fileName = `proof_${RUN_MARK}_${pad3(idx)}_${i + 1}.bin`;
        const proofBlob = pickProofBlob(i);
        form.append('proofFiles', proofBlob, fileName);
      }

      resp = await fetch(`${API_BASE}/api/submissions`, {
        method: 'POST',
        headers,
        body: form,
        duplex: 'half'
      });
    } else {
      const body = JSON.stringify(common);
      resp = await fetch(`${API_BASE}/api/submissions`, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json'
        },
        body
      });
    }

    const data = await mustJson(resp);
    const elapsedMs = Math.round(performance.now() - startedAt);
    return {
      idx,
      role,
      ok: resp.status === 202,
      phase: 'submit',
      status: resp.status,
      elapsedMs,
      submissionId: data?.id || '',
      traceId: data?.traceId || '',
      syncStatus: data?.syncStatus || '',
      error: resp.status === 202 ? '' : JSON.stringify(data || {})
    };
  } catch (error) {
    return {
      idx,
      role,
      ok: false,
      phase: 'submit',
      status: 0,
      elapsedMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function pollStatuses(submissionIds) {
  const pending = new Set(submissionIds.filter(Boolean));
  const statuses = new Map();
  const startedAt = Date.now();

  while (pending.size > 0 && Date.now() - startedAt < POLL_TIMEOUT_MS) {
    const batch = Array.from(pending);
    const respList = await Promise.all(batch.map(async (id) => {
      try {
        const resp = await fetch(`${API_BASE}/api/submissions/${id}/status`, {
          headers: { accept: 'application/json' }
        });
        const data = await mustJson(resp);
        return { id, ok: resp.ok, status: resp.status, data };
      } catch (error) {
        return { id, ok: false, status: 0, data: null, error: error instanceof Error ? error.message : String(error) };
      }
    }));

    for (const item of respList) {
      if (!item.ok) continue;
      const syncStatus = item.data?.syncStatus || '';
      statuses.set(item.id, item.data);
      if (syncStatus === 'SUCCESS' || syncStatus === 'FAILED') {
        pending.delete(item.id);
      }
    }

    const counts = { SUCCESS: 0, FAILED: 0, PROCESSING: 0, PENDING: 0, RETRYING: 0, OTHER: 0 };
    for (const status of statuses.values()) {
      const v = status?.syncStatus || 'OTHER';
      if (counts[v] === undefined) counts.OTHER += 1;
      else counts[v] += 1;
    }

    console.log(
      `${nowIso()} poll: done=${submissionIds.length - pending.size}/${submissionIds.length} ` +
      `SUCCESS=${counts.SUCCESS} FAILED=${counts.FAILED} RETRYING=${counts.RETRYING} PROCESSING=${counts.PROCESSING} PENDING=${counts.PENDING}`
    );

    if (pending.size === 0) break;
    await sleep(POLL_INTERVAL_MS);
  }

  return { statuses, pending };
}

async function buildProofBlobPicker() {
  const pickMode = ATTACHMENT_PICK === 'random' ? 'random' : 'cycle';
  const mbChoicesRaw = parseMbCsv(ATTACHMENT_MB_CHOICES);

  let mbChoices = mbChoicesRaw;
  if (mbChoices.length === 0) {
    const minOk = Number.isFinite(ATTACHMENT_MIN_MB) && ATTACHMENT_MIN_MB > 0;
    const maxOk = Number.isFinite(ATTACHMENT_MAX_MB) && ATTACHMENT_MAX_MB > 0;
    if (minOk && maxOk && ATTACHMENT_MAX_MB >= ATTACHMENT_MIN_MB) {
      const list = [];
      for (let mb = ATTACHMENT_MIN_MB; mb <= ATTACHMENT_MAX_MB + 1e-9; mb += ATTACHMENT_BUCKET_STEP_MB) {
        list.push(Math.round(mb * 1000) / 1000);
      }
      if (list.length === 0 || list[list.length - 1] !== ATTACHMENT_MAX_MB) {
        list.push(Math.round(ATTACHMENT_MAX_MB * 1000) / 1000);
      }
      mbChoices = list;
    }
  }

  if (mbChoices.length > 0) {
    const uniqueSorted = Array.from(new Set(mbChoices)).sort((a, b) => a - b);
    for (const mb of uniqueSorted) {
      if (mb > 100) {
        throw new Error(`attachment mb too large: ${mb} (cap=100MB). Use smaller files or update script cap.`);
      }
    }

    const blobByMb = new Map();
    for (const mb of uniqueSorted) {
      const sizeBytes = Math.floor(mb * 1024 * 1024);
      blobByMb.set(mb, new Blob([Buffer.alloc(sizeBytes, 0)], { type: FILE_TYPE }));
    }

    console.log(
      `${nowIso()} using attachment size choices: ` +
      `choices=${mbChoices.join(',')} unique=${uniqueSorted.join(',')} pick=${pickMode} type=${FILE_TYPE}`
    );

    const pickProofBlob = (attachmentIdx) => {
      const mb = pickMode === 'random'
        ? mbChoices[Math.floor(Math.random() * mbChoices.length)]
        : mbChoices[Math.max(0, attachmentIdx) % mbChoices.length];
      const blob = blobByMb.get(mb);
      if (!blob) throw new Error(`internal: missing blob for mb=${mb}`);
      return blob;
    };

    return { pickProofBlob, mode: 'choices' };
  }

  if (FILE_MB_LIST) {
    const parts = FILE_MB_LIST
      .split(',')
      .map((v) => Number(v.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (parts.length === 0) {
      throw new Error(`invalid FILE_MB_LIST=${FILE_MB_LIST}`);
    }
    const buffers = parts.map((mb) => Buffer.alloc(Math.floor(mb * 1024 * 1024), 0));
    const totalMb = parts.reduce((sum, mb) => sum + mb, 0);
    console.log(`${nowIso()} using in-memory attachment blob: parts=${parts.join(',')} total=${totalMb}MB type=${FILE_TYPE}`);
    const blob = new Blob(buffers, { type: FILE_TYPE });
    return { pickProofBlob: () => blob, mode: 'file_mb_list' };
  }

  if (!PROOF_PATH) {
    throw new Error('missing attachment config: set ATTACHMENT_MB_CHOICES, ATTACHMENT_MIN_MB/ATTACHMENT_MAX_MB, PROOF_PATH, or FILE_MB_LIST');
  }

  const proofBuffer = await fs.readFile(PROOF_PATH);
  console.log(`${nowIso()} using attachment file: path=${PROOF_PATH} bytes=${proofBuffer.length} type=${FILE_TYPE}`);
  const blob = new Blob([proofBuffer], { type: FILE_TYPE });
  return { pickProofBlob: () => blob, mode: 'file_path' };
}

async function main() {
  console.log(`${nowIso()} load test start: api=${API_BASE} total=${TOTAL} industry=${INDUSTRY} attachmentsPerIndustry=${ATTACHMENTS_PER_INDUSTRY} poll=${POLL ? '1' : '0'} mark=${RUN_MARK}`);
  const { pickProofBlob, mode } = await buildProofBlobPicker();
  console.log(`${nowIso()} attachment mode: ${mode}`);

  const startedAt = performance.now();
  const results = await Promise.all(
    Array.from({ length: TOTAL }, (_, idx) => submitOne(idx + 1, pickProofBlob))
  );
  const elapsedAllMs = Math.round(performance.now() - startedAt);

  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  const industryOk = ok.filter((r) => r.role === 'industry').length;
  const consumerOk = ok.filter((r) => r.role === 'consumer').length;

  const latencies = ok.map((r) => Number(r.elapsedMs || 0)).filter((n) => Number.isFinite(n) && n > 0);

  console.log(`${nowIso()} load test accepted: ok=${ok.length}/${results.length} industry_ok=${industryOk} consumer_ok=${consumerOk} wall_ms=${elapsedAllMs}`);
  if (latencies.length) {
    console.log(
      `${nowIso()} submit latency ms: ` +
      `p50=${percentile(latencies, 50)} p90=${percentile(latencies, 90)} p95=${percentile(latencies, 95)} p99=${percentile(latencies, 99)} max=${Math.max(...latencies)}`
    );
  }

  if (failed.length) {
    console.log(`${nowIso()} submit failures (${failed.length}):`);
    for (const item of failed.slice(0, 20)) {
      console.log(`- idx=${item.idx} role=${item.role} phase=${item.phase} status=${item.status} err=${item.error}`);
    }
    if (failed.length > 20) {
      console.log(`...and ${failed.length - 20} more`);
    }
  }

  const submissionIds = ok.map((r) => r.submissionId).filter(Boolean);
  if (!POLL || submissionIds.length === 0) return;

  console.log(`${nowIso()} polling statuses: submissions=${submissionIds.length} timeoutMs=${POLL_TIMEOUT_MS}`);
  const { statuses, pending } = await pollStatuses(submissionIds);

  const final = Array.from(statuses.values());
  const success = final.filter((s) => s?.syncStatus === 'SUCCESS');
  const failedSync = final.filter((s) => s?.syncStatus === 'FAILED');
  const retrying = final.filter((s) => s?.syncStatus === 'RETRYING');

  console.log(`${nowIso()} poll done: SUCCESS=${success.length} FAILED=${failedSync.length} RETRYING=${retrying.length} PENDING=${pending.size}`);
  if (failedSync.length) {
    console.log(`${nowIso()} FAILED examples:`);
    for (const item of failedSync.slice(0, 10)) {
      console.log(`- sub=${item?.id} trace=${item?.traceId} err=${item?.syncError || ''}`);
    }
  }

  if (retrying.length || pending.size) {
    console.log(`${nowIso()} WARNING: some jobs not finished (may still be retrying or queued). mark=${RUN_MARK} company=${COMPANY_MARK}`);
  }
}

main().catch((err) => {
  console.error(`${nowIso()} load test failed:`, err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
