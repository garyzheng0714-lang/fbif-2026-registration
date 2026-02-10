import { z } from 'zod';
import { env } from '../config/env.js';

const phoneRegex = /^1[3-9]\d{9}$/;
const idRegex = /^\d{17}[\dXx]$/;
const otherIdRegex = /^[A-Za-z0-9-]{6,20}$/;

const maxProofUrls = Math.max(1, Number(env.MAX_PROOF_URLS || 5));
const maxProofUrlLength = Math.max(64, Number(env.MAX_PROOF_URL_LENGTH || 2048));

export function isValidChineseId(id: string): boolean {
  if (!idRegex.test(id)) return false;
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const codes = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];
  const chars = id.toUpperCase().split('');
  const sum = weights.reduce((acc, weight, idx) => acc + weight * Number(chars[idx]), 0);
  const check = codes[sum % 11];
  return check === chars[17];
}

export function sanitizeText(value: string): string {
  return String(value || '').replace(/[<>]/g, '').trim();
}

function normalizeUrl(value: unknown) {
  const text = sanitizeText(String(value || ''));
  if (!text) return '';
  if (text.length > maxProofUrlLength) return '';

  try {
    const u = new URL(text);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.toString();
  } catch {
    return '';
  }
}

export function normalizeProofUrls(value: unknown): string[] {
  let items: unknown[] = [];

  if (Array.isArray(value)) {
    items = value;
  } else if (typeof value === 'string') {
    const text = value.trim();
    if (!text) {
      items = [];
    } else if (text.startsWith('[')) {
      try {
        const parsed = JSON.parse(text);
        items = Array.isArray(parsed) ? parsed : [];
      } catch {
        items = text.split(',');
      }
    } else {
      items = text.split(',');
    }
  }

  const dedup = new Set<string>();
  const urls: string[] = [];
  for (const item of items) {
    if (urls.length >= maxProofUrls) break;
    const url = normalizeUrl(item);
    if (!url || dedup.has(url)) continue;
    dedup.add(url);
    urls.push(url);
  }

  return urls;
}

const roleSchema = z.enum(['industry', 'consumer']);
const idTypeSchema = z.enum(['cn_id', 'passport', 'other']);

export const submissionSchema = z.object({
  clientRequestId: z.string().min(8).max(64).optional(),
  role: roleSchema,
  idType: idTypeSchema,
  idNumber: z.string().min(1).max(64),
  phone: z.string().regex(phoneRegex, '手机号格式不正确'),
  name: z.string().min(2, '姓名至少 2 个字符').max(32),
  title: z.string().min(2, '职位至少 2 个字符').max(32),
  company: z.string().min(2, '公司至少 2 个字符').max(64),
  businessType: z.string().optional(),
  department: z.string().optional(),
  proofUrls: z.any().optional().transform((v) => normalizeProofUrls(v))
}).superRefine((data, ctx) => {
  const idType = data.idType;
  const idNumber = String(data.idNumber || '').trim();

  if (idType === 'cn_id') {
    if (!idRegex.test(idNumber) || !isValidChineseId(idNumber)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['idNumber'],
        message: '身份证号校验失败'
      });
    }
  } else if (!otherIdRegex.test(idNumber)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['idNumber'],
      message: '证件号格式不正确（6-20位字母/数字/短横线）'
    });
  }

  if (data.role === 'industry') {
    if (!String(data.businessType || '').trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['businessType'],
        message: '贵司的业务类型不能为空'
      });
    }
    if (!String(data.department || '').trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['department'],
        message: '您所处的部门不能为空'
      });
    }

    const urls = Array.isArray(data.proofUrls) ? data.proofUrls : [];
    if (urls.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['proofUrls'],
        message: '请上传专业观众证明材料'
      });
    }
  }
});

export type SubmissionInput = z.infer<typeof submissionSchema>;

