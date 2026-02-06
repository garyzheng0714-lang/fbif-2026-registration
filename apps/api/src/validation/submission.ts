import { z } from 'zod';

const phoneRegex = /^1[3-9]\d{9}$/;
const idRegex = /^\d{17}[\dXx]$/;

export function isValidChineseId(id: string): boolean {
  if (!idRegex.test(id)) return false;
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const codes = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];
  const chars = id.toUpperCase().split('');
  const sum = weights.reduce((acc, weight, idx) => acc + weight * Number(chars[idx]), 0);
  const check = codes[sum % 11];
  return check === chars[17];
}

export const submissionSchema = z.object({
  phone: z.string().regex(phoneRegex, '手机号格式不正确'),
  name: z.string().min(2, '姓名至少 2 个字符').max(32),
  title: z.string().min(2, '职位至少 2 个字符').max(32),
  company: z.string().min(2, '公司至少 2 个字符').max(64),
  idNumber: z.string().regex(idRegex, '身份证号格式不正确').refine(isValidChineseId, '身份证号校验失败')
});

export type SubmissionInput = z.infer<typeof submissionSchema>;

export function sanitizeText(value: string): string {
  return value.replace(/[<>]/g, '').trim();
}
