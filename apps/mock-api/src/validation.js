const phoneRegex = /^1[3-9]\d{9}$/;
const idRegex = /^\d{17}[\dXx]$/;
const otherIdRegex = /^[A-Za-z0-9-]{6,20}$/;

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
  }

  return {
    ok: true,
    data: payload
  };
}
