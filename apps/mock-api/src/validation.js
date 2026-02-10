const phoneRegex = /^1[3-9]\d{9}$/;
const idRegex = /^\d{17}[\dXx]$/;
const otherIdRegex = /^[A-Za-z0-9-]{6,20}$/;
const maxProofUrls = Math.max(1, Number(process.env.MOCK_API_MAX_PROOF_URLS || 10));

const allowedRoles = new Set(['industry', 'consumer']);
const allowedIdTypes = new Set(['cn_id', 'passport', 'other']);

export function isValidChineseId(id) {
  if (!idRegex.test(id)) return false;

  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const codes = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];
  const chars = id.toUpperCase().split('');
  const sum = weights.reduce((acc, weight, idx) => acc + weight * Number(chars[idx]), 0);
  const check = codes[sum % 11];

  return check === chars[17];
}

function trimText(value) {
  return String(value || '').replace(/[<>]/g, '').trim();
}

function normalizeUrl(value) {
  const text = trimText(value);
  if (!text) return '';
  if (text.length > 2048) return '';

  try {
    const u = new URL(text);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.toString();
  } catch {
    return '';
  }
}

export function normalizeProofUrls(value) {
  let items = [];

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

  const dedup = new Set();
  const urls = [];
  for (const item of items) {
    if (urls.length >= maxProofUrls) break;
    const url = normalizeUrl(item);
    if (!url || dedup.has(url)) continue;
    dedup.add(url);
    urls.push(url);
  }

  return urls;
}

export function validateSubmission(input) {
  const phone = trimText(input.phone);
  const name = trimText(input.name);
  const title = trimText(input.title);
  const company = trimText(input.company);
  const idNumber = trimText(input.idNumber);
  const role = trimText(input.role);
  const businessType = trimText(input.businessType);
  const department = trimText(input.department);
  const idTypeRaw = trimText(input.idType);
  const idType = idTypeRaw ? idTypeRaw : 'cn_id';

  if (!phoneRegex.test(phone)) {
    return { ok: false, error: '手机号格式不正确' };
  }

  if (name.length < 2 || name.length > 32) {
    return { ok: false, error: '姓名长度不合法' };
  }

  if (title.length < 2 || title.length > 32) {
    return { ok: false, error: '职位长度不合法' };
  }

  if (company.length < 2 || company.length > 64) {
    return { ok: false, error: '公司长度不合法' };
  }

  if (idTypeRaw && !allowedIdTypes.has(idType)) {
    return { ok: false, error: '证件类型不合法' };
  }

  if (idType === 'cn_id') {
    if (!isValidChineseId(idNumber)) {
      return { ok: false, error: '身份证号校验失败' };
    }
  } else if (!otherIdRegex.test(idNumber)) {
    return { ok: false, error: '证件号格式不正确（6-20位字母/数字/短横线）' };
  }

  const payload = {
    phone,
    name,
    title,
    company,
    idNumber
  };

  if (allowedRoles.has(role)) {
    payload.role = role;
  }

  if (allowedIdTypes.has(idType)) {
    payload.idType = idType;
  }

  if (payload.role === 'industry') {
    if (!businessType) {
      return { ok: false, error: '贵司的业务类型不能为空' };
    }
    if (!department) {
      return { ok: false, error: '您所处的部门不能为空' };
    }

    payload.businessType = businessType.slice(0, 64);
    payload.department = department.slice(0, 64);
    payload.proofUrls = normalizeProofUrls(input.proofUrls);
  }

  return {
    ok: true,
    data: payload
  };
}
