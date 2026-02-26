const idRegex = /^\d{17}[\dXx]$/;

function normalizeCountryCode(countryCode: string) {
  const raw = String(countryCode || '').trim();
  if (!raw) return '+86';
  const digits = raw.replace(/[^\d]/g, '');
  if (!digits) return '+86';
  return `+${digits}`;
}

function normalizeLocalPhone(phone: string) {
  return String(phone || '').replace(/[^\d]/g, '');
}

export function composeInternationalPhone(countryCode: string, phone: string) {
  const code = normalizeCountryCode(countryCode);
  const local = normalizeLocalPhone(phone);
  return `${code}${local}`;
}

export function validatePhone(phone: string, countryCode = '+86') {
  const local = normalizeLocalPhone(phone);
  const code = normalizeCountryCode(countryCode);
  if (!local) return '手机号格式不正确';

  if (code === '+86') {
    if (!/^1[3-9]\d{9}$/.test(local)) return '手机号格式不正确';
    return '';
  }

  if (local.length < 6 || local.length > 20) return '手机号格式不正确';
  return '';
}

export function validateChineseId(id: string) {
  if (!idRegex.test(id)) return '身份证号格式不正确';
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const codes = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];
  const chars = id.toUpperCase().split('');
  const sum = weights.reduce((acc, weight, idx) => acc + weight * Number(chars[idx]), 0);
  const check = codes[sum % 11];
  if (check !== chars[17]) return '身份证号校验失败';
  return '';
}

export function validateRequired(value: string, label: string, min = 2, max = 64) {
  if (!value || value.trim().length < min) return `${label}至少 ${min} 个字符`;
  if (value.trim().length > max) return `${label}不能超过 ${max} 个字符`;
  return '';
}
