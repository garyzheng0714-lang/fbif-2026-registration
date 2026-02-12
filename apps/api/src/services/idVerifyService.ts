import { env } from '../config/env.js';

type RawVerifyResponse = {
  code?: string | number;
  msg?: string;
  data?: {
    result?: number | string;
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

function normalizeProviderResult(value: unknown) {
  const n = Number(value);
  if (n === 1 || n === 2 || n === 3) return n as 1 | 2 | 3;
  return 3 as const;
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

    const providerCode = normalizeProviderCode(payload?.code);
    const providerMsg = String(payload?.msg || '').trim() || `HTTP_${resp.status}`;

    if (!resp.ok) {
      if (resp.status === 429 || providerCode === '6') {
        throw new IdVerifyError('身份证验证请求过于频繁，请稍后重试', 429, 'ID_VERIFY_RATE_LIMIT');
      }
      throw new IdVerifyError('身份证验证服务暂时不可用，请稍后重试', 502, 'ID_VERIFY_UPSTREAM');
    }

    if (providerCode !== '0') {
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

    const result = normalizeProviderResult(payload?.data?.result);
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
