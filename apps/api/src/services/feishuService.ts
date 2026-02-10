import { env } from '../config/env.js';
import type { Submission } from '@prisma/client';
import { logger } from '../utils/logger.js';
import { applySingleSelectMappings } from './bitableSelect.js';
import type { BitableFieldMeta } from './bitableSelect.js';

const FEISHU_BASE = 'https://open.feishu.cn/open-apis';

const fieldMap = {
  name: process.env.FEISHU_FIELD_NAME || '姓名（问卷题）',
  phone: process.env.FEISHU_FIELD_PHONE || '手机号（问卷题）',
  title: process.env.FEISHU_FIELD_TITLE || '职位（问卷题）',
  company: process.env.FEISHU_FIELD_COMPANY || '公司（问卷题）',
  idNumber: process.env.FEISHU_FIELD_ID || '证件号码（问卷题）',
  identity: process.env.FEISHU_FIELD_IDENTITY || '',
  idType: process.env.FEISHU_FIELD_ID_TYPE || '',
  businessType: process.env.FEISHU_FIELD_BUSINESS_TYPE || '贵司的业务类型',
  department: process.env.FEISHU_FIELD_DEPARTMENT || '您所处的部门（问卷题）',
  proofUrl: process.env.FEISHU_FIELD_PROOF_URL || '专业观众证明（附件链接）',
  submittedAt: process.env.FEISHU_FIELD_SUBMITTED_AT || '',
  syncStatus: process.env.FEISHU_FIELD_SYNC_STATUS || ''
};

type TokenCache = { value: string; expiresAt: number };
let tokenCache: TokenCache = { value: '', expiresAt: 0 };

let bitableFieldMetaCache: {
  value: Map<string, BitableFieldMeta> | null;
  expiresAt: number;
  inFlight: Promise<Map<string, BitableFieldMeta>> | null;
} = { value: null, expiresAt: 0, inFlight: null };

export class FeishuApiError extends Error {
  status: number;
  code: number | null;
  retryable: boolean;

  constructor(message: string, options: { status: number; code?: number | null; retryable?: boolean }) {
    super(message);
    this.name = 'FeishuApiError';
    this.status = options.status;
    this.code = options.code ?? null;
    this.retryable = Boolean(options.retryable);
  }
}

function trim(v: unknown) {
  return String(v || '').trim();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJson(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isRetryableByStatus(status: number) {
  return status === 429 || status === 502 || status === 503 || status === 504 || status >= 500;
}

function messageLooksRetryable(message: string) {
  const m = message.toLowerCase();
  return m.includes('rate limit') || m.includes('too many') || m.includes('timeout') || m.includes('temporarily');
}

async function getTenantAccessToken(): Promise<string> {
  const now = Date.now();
  if (tokenCache.value && tokenCache.expiresAt > now + 60_000) {
    return tokenCache.value;
  }

  const response = await fetch(`${FEISHU_BASE}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_id: env.FEISHU_APP_ID,
      app_secret: env.FEISHU_APP_SECRET
    })
  });

  const data = await readJson(response);
  if (!response.ok || !data || data.code !== 0 || !data.tenant_access_token) {
    const msg = data?.msg || response.statusText || 'unknown';
    throw new FeishuApiError(`get tenant token failed: ${msg}`, {
      status: response.status,
      code: data?.code ?? null,
      retryable: isRetryableByStatus(response.status) || messageLooksRetryable(String(msg))
    });
  }

  const expiresInSec = Number(data.expire || data.expires_in || 3600);
  tokenCache = {
    value: String(data.tenant_access_token),
    expiresAt: now + expiresInSec * 1000
  };

  return tokenCache.value;
}

async function withRetry<T>(fn: () => Promise<T>, retries: number) {
  let lastErr: unknown;
  for (let i = 0; i <= retries; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i >= retries) break;
      await sleep(200 * Math.pow(2, i));
    }
  }
  throw lastErr;
}

async function feishuRequest(path: string, init: RequestInit): Promise<any> {
  const doRequest = async () => {
    const token = await getTenantAccessToken();
    const response = await fetch(`${FEISHU_BASE}${path}`, {
      ...init,
      headers: {
        ...(init.headers || {}),
        Authorization: `Bearer ${token}`
      }
    });

    const data = await readJson(response);
    if (!response.ok) {
      const msg = data?.msg || response.statusText || 'unknown';
      throw new FeishuApiError(`feishu http error: ${msg}`, {
        status: response.status,
        code: data?.code ?? null,
        retryable: isRetryableByStatus(response.status) || messageLooksRetryable(String(msg))
      });
    }

    if (data && typeof data === 'object' && 'code' in data && data.code !== 0) {
      const msg = data?.msg || 'unknown';
      throw new FeishuApiError(`feishu api error: ${msg}`, {
        status: response.status,
        code: data?.code ?? null,
        retryable: isRetryableByStatus(response.status) || messageLooksRetryable(String(msg))
      });
    }

    return data;
  };

  // A tiny retry here reduces flakiness for token fetch / transient network blips, while job retries handle the rest.
  return withRetry(doRequest, 1);
}

async function getBitableFieldMetaByName(): Promise<Map<string, BitableFieldMeta>> {
  const now = Date.now();
  if (bitableFieldMetaCache.value && bitableFieldMetaCache.expiresAt > now + 30_000) {
    return bitableFieldMetaCache.value;
  }
  if (bitableFieldMetaCache.inFlight) {
    return bitableFieldMetaCache.inFlight;
  }

  bitableFieldMetaCache.inFlight = (async () => {
    const data = await feishuRequest(
      `/bitable/v1/apps/${env.FEISHU_APP_TOKEN}/tables/${env.FEISHU_TABLE_ID}/fields?page_size=200`,
      { method: 'GET' }
    );

    const items = Array.isArray(data?.data?.items) ? data.data.items : [];
    const byName = new Map<string, BitableFieldMeta>();

    for (const raw of items) {
      const name = trim(raw?.field_name || raw?.name);
      if (!name) continue;

      const meta: BitableFieldMeta = {
        name,
        type: raw?.type ?? raw?.field_type ?? null,
        uiType: trim(raw?.ui_type || ''),
        optionsByName: new Map(),
        optionsById: new Set()
      };

      const options = Array.isArray(raw?.property?.options) ? raw.property.options : [];
      for (const opt of options) {
        const optName = trim(opt?.name || opt?.option_name);
        const optId = trim(opt?.id || opt?.option_id);
        if (!optName || !optId) continue;
        meta.optionsByName.set(optName, optId);
        meta.optionsById.add(optId);
      }

      byName.set(name, meta);
    }

    bitableFieldMetaCache = {
      value: byName,
      expiresAt: now + 10 * 60_000,
      inFlight: null
    };

    return byName;
  })();

  try {
    return await bitableFieldMetaCache.inFlight;
  } finally {
    // Always clear inFlight even if request fails.
    bitableFieldMetaCache.inFlight = null;
  }
}

function normalizeBusinessTypeOptionText(value: unknown) {
  const text = trim(value);
  if (!text) return '';

  if (text === '食品相关品牌方') {
    return '食品饮料品牌方（包括传统的食品加工企业';
  }
  if (text === '食品制造商') {
    return '食品饮料品牌方（包括传统的食品加工企业';
  }
  if (text === '供应链服务商') {
    return '原材料供应商（提供各种食品配料和原材料的企业';
  }
  if (text === '咨询/营销/服务机构') {
    return '设计营销与咨询策划服务提供商';
  }
  if (text === '新兴渠道') {
    return '新零售（前置仓到家';
  }
  if (text === '其他') {
    // Avoid ambiguous substring matching ("其他" appears in multiple options).
    return '其他（包含政府机构、协会、高校、媒体等等）';
  }

  return text;
}

function normalizeDepartmentOptionText(value: unknown) {
  const text = trim(value);
  if (!text) return '';

  if (text === '高管/战略') {
    return '高管、战略部门';
  }
  if (text === '研发/生产/品控') {
    return '研发、产品、包装';
  }
  if (text === '采购/物流/仓储') {
    return '采购、供应链、生产';
  }
  if (text === '采购/市场/生产') {
    return '采购、供应链、生产';
  }
  if (text === '市场/销售/电商') {
    return '渠道、销售、电商';
  }
  if (text === '行政') {
    return '其他（如财务、行政等）';
  }
  if (text === '其他') {
    return '其他（如财务、行政等）';
  }

  return text;
}

export async function mapSubmissionToBitableFields(input: {
  submission: Submission;
  sensitive: { phone: string; idNumber: string };
}): Promise<Record<string, string>> {
  const submission = input.submission;
  const sensitive = input.sensitive;

  const fields: Record<string, string> = {
    [fieldMap.name]: submission.name,
    [fieldMap.phone]: sensitive.phone,
    [fieldMap.title]: submission.title,
    [fieldMap.company]: submission.company,
    [fieldMap.idNumber]: sensitive.idNumber
  };

  if (fieldMap.identity) {
    fields[fieldMap.identity] = submission.role === 'industry' ? '我是食品行业相关从业者' : '我是消费者';
  }

  if (fieldMap.idType) {
    const idTypeValue = submission.idType === 'cn_id'
      ? '中国居民身份证'
      : submission.idType === 'passport'
        ? '护照'
        : '';

    if (idTypeValue) {
      fields[fieldMap.idType] = idTypeValue;
    }
  }

  if (fieldMap.businessType && submission.businessType) {
    fields[fieldMap.businessType] = normalizeBusinessTypeOptionText(submission.businessType);
  }

  if (fieldMap.department && submission.department) {
    fields[fieldMap.department] = normalizeDepartmentOptionText(submission.department);
  }

  const proofUrls = Array.isArray(submission.proofUrls) ? (submission.proofUrls as any[]).map((v) => trim(v)).filter(Boolean) : [];
  if (fieldMap.proofUrl && proofUrls.length > 0) {
    fields[fieldMap.proofUrl] = proofUrls.join(',');
  }

  if (fieldMap.submittedAt) {
    fields[fieldMap.submittedAt] = submission.createdAt.toISOString();
  }

  if (fieldMap.syncStatus) {
    fields[fieldMap.syncStatus] = '已同步';
  }

  const idSuffix = sensitive.idNumber.slice(-4);
  const metaByName = await getBitableFieldMetaByName();
  return applySingleSelectMappings(fields, metaByName, { traceId: submission.traceId, idSuffix }, logger);
}

export async function createBitableRecord(fields: Record<string, string>): Promise<string> {
  const data = await feishuRequest(
    `/bitable/v1/apps/${env.FEISHU_APP_TOKEN}/tables/${env.FEISHU_TABLE_ID}/records`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields })
    }
  );

  const recordId = trim(data?.data?.record?.record_id);
  if (!recordId) {
    throw new FeishuApiError('create record failed: missing record_id', { status: 200, retryable: true });
  }

  return recordId;
}

export async function updateBitableRecord(recordId: string, fields: Record<string, string>) {
  await feishuRequest(
    `/bitable/v1/apps/${env.FEISHU_APP_TOKEN}/tables/${env.FEISHU_TABLE_ID}/records/${recordId}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields })
    }
  );
}

export function isRetryableFeishuError(err: unknown) {
  if (err instanceof FeishuApiError) return err.retryable;
  if (err instanceof Error) return messageLooksRetryable(err.message || '');
  return false;
}
