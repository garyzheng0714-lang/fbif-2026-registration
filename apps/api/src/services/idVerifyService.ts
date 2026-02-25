import { env } from '../config/env.js';

type RawVerifyResponse = {
  code?: string | number;
  status?: string | number;
  message?: string;
  msg?: string;
  result?: number | string;
  success?: boolean | string | number;
  data?: {
    result?: number | string;
    res?: number | string;
    status?: number | string;
    verifyResult?: number | string;
    birthday?: string;
    gender?: number;
    age?: number;
    province?: string;
    city?: string;
    district?: string;
    area?: string;
  } | null;
};

export class IdVerifyError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 502, code = 'ID_VERIFY_ERROR') {
    super(message);
    this.name = 'IdVerifyError';
    this.status = status;
    this.code = code;
  }
}

function normalizeProviderCode(value: unknown) {
  return String(value ?? '').trim();
}

function normalizeProviderResult(value: unknown): 1 | 2 | 3 {
  const n = Number(value);
  if (n === 1 || n === 2 || n === 3) return n as 1 | 2 | 3;
  return 3 as const;
}

function isProviderSuccessCode(code: string) {
  const normalized = String(code || '').trim().toLowerCase();
  if (!normalized) return true;
  return normalized === '0' || normalized === '200' || normalized === 'ok' || normalized === 'success';
}

function parseProviderResult(payload: RawVerifyResponse | null): 1 | 2 | 3 | null {
  const candidates = [
    payload?.data?.result,
    payload?.data?.res,
    payload?.data?.verifyResult,
    payload?.data?.status,
    payload?.result
  ];

  for (const candidate of candidates) {
    if (candidate == null || String(candidate).trim() === '') continue;
    const n = Number(candidate);
    if (n === 1 || n === 2 || n === 3) {
      return n as 1 | 2 | 3;
    }

    const text = String(candidate).trim().toLowerCase();
    if (['pass', 'passed', 'match', 'matched', 'success', 'true'].includes(text)) return 1;
    if (['mismatch', 'not_match', 'unmatch', 'false'].includes(text)) return 2;
    if (['not_found', 'no_record', 'unknown'].includes(text)) return 3;
  }

  return null;
}

export async function verifyIdentityByAliyun(input: { name: string; idCard: string }) {
  if (!env.ID_VERIFY_ENABLED) {
    throw new IdVerifyError('身份证实名验证未启用', 503, 'ID_VERIFY_DISABLED');
  }
  if (!env.ID_VERIFY_APPCODE) {
    throw new IdVerifyError('身份证实名验证未配置 APPCODE', 503, 'ID_VERIFY_NOT_CONFIGURED');
  }

  const host = String(env.ID_VERIFY_ALIYUN_HOST || '').trim().replace(/\/+$/, '');
  const path = String(env.ID_VERIFY_ALIYUN_PATH || '/idcard/check').trim();
  const url = new URL(`${host}${path.startsWith('/') ? path : `/${path}`}`);
  url.searchParams.set('name', input.name);
  url.searchParams.set('idCard', input.idCard);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), Number(env.ID_VERIFY_TIMEOUT_MS || 5000));

  try {
    const resp = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `APPCODE ${env.ID_VERIFY_APPCODE}`
      },
      signal: controller.signal
    });

    let payload: RawVerifyResponse | null = null;
    try {
      payload = (await resp.json()) as RawVerifyResponse;
    } catch {
      payload = null;
    }

    const providerCode = normalizeProviderCode(payload?.code ?? payload?.status);
    const providerMsg = String(payload?.msg || payload?.message || '').trim() || `HTTP_${resp.status}`;

    if (!resp.ok) {
      if (resp.status === 429 || providerCode === '6') {
        throw new IdVerifyError('身份证验证请求过于频繁，请稍后重试', 429, 'ID_VERIFY_RATE_LIMIT');
      }
      throw new IdVerifyError('身份证验证服务暂时不可用，请稍后重试', 502, 'ID_VERIFY_UPSTREAM');
    }

    const parsedResult = parseProviderResult(payload);
    if (!isProviderSuccessCode(providerCode) && parsedResult == null) {
      if (providerCode === '1') {
        throw new IdVerifyError(providerMsg || '身份证验证参数错误', 400, 'ID_VERIFY_BAD_REQUEST');
      }
      if (providerCode === '6') {
        throw new IdVerifyError('身份证验证请求过于频繁，请稍后重试', 429, 'ID_VERIFY_RATE_LIMIT');
      }
      if (providerCode === '3' || providerCode === '11') {
        throw new IdVerifyError('身份证验证服务暂时不可用，请稍后重试', 502, 'ID_VERIFY_UPSTREAM');
      }
      throw new IdVerifyError(providerMsg || '身份证验证失败', 502, 'ID_VERIFY_FAILED');
    }

    const result = parsedResult ?? normalizeProviderResult(payload?.data?.result);
    const verified = result === 1;

    return {
      verified,
      result,
      providerCode: providerCode || '0',
      providerMessage: providerMsg || '成功',
      area: String(payload?.data?.area || ''),
      province: String(payload?.data?.province || ''),
      city: String(payload?.data?.city || ''),
      district: String(payload?.data?.district || '')
    };
  } catch (err) {
    if (err instanceof IdVerifyError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new IdVerifyError('身份证验证超时，请稍后重试', 504, 'ID_VERIFY_TIMEOUT');
    }
    throw new IdVerifyError('身份证验证服务异常，请稍后重试', 502, 'ID_VERIFY_NETWORK');
  } finally {
    clearTimeout(timeoutId);
  }
}
