const phoneRegex = /^1[3-9]\d{9}$/;
const idRegex = /^\d{17}[\dXx]$/;

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

  if (!isValidChineseId(idNumber)) {
    return { ok: false, error: '身份证号校验失败' };
  }

  return {
    ok: true,
    data: {
      phone,
      name,
      title,
      company,
      idNumber
    }
  };
}
