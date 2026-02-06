import 'dotenv/config';

const FEISHU_BASE = 'https://open.feishu.cn/open-apis';

const appId = process.env.FEISHU_APP_ID || '';
const appSecret = process.env.FEISHU_APP_SECRET || '';
const appToken = process.env.FEISHU_APP_TOKEN || '';
const tableId = process.env.FEISHU_TABLE_ID || '';

const fieldMap = {
  name: process.env.FEISHU_FIELD_NAME || '姓名（问卷题）',
  phone: process.env.FEISHU_FIELD_PHONE || '手机号（问卷题）',
  title: process.env.FEISHU_FIELD_TITLE || '职位（问卷题）',
  company: process.env.FEISHU_FIELD_COMPANY || '公司（问卷题）',
  idNumber: process.env.FEISHU_FIELD_ID || '证件号码（问卷题）',
  submittedAt: process.env.FEISHU_FIELD_SUBMITTED_AT || '',
  syncStatus: process.env.FEISHU_FIELD_SYNC_STATUS || ''
};

let tokenCache = {
  value: '',
  expiresAt: 0
};

function hasFeishuConfig() {
  return Boolean(appId && appSecret && appToken && tableId);
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retry(fn, retries = 3) {
  let lastError;
  for (let i = 0; i <= retries; i += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i === retries) break;
      await sleep(300 * Math.pow(2, i));
    }
  }
  throw lastError;
}

async function getTenantAccessToken() {
  const now = Date.now();
  if (tokenCache.value && tokenCache.expiresAt > now + 60 * 1000) {
    return tokenCache.value;
  }

  const response = await fetch(`${FEISHU_BASE}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      app_id: appId,
      app_secret: appSecret
    })
  });

  const data = await response.json();
  if (!response.ok || data.code !== 0) {
    throw new Error(`get tenant token failed: ${data.msg || response.statusText}`);
  }

  const expiresInSec = data.expire || data.expires_in || 3600;
  tokenCache = {
    value: data.tenant_access_token,
    expiresAt: now + expiresInSec * 1000
  };

  return tokenCache.value;
}

function mapFields(submission) {
  const fields = {
    [fieldMap.name]: submission.name,
    [fieldMap.phone]: submission.phone,
    [fieldMap.title]: submission.title,
    [fieldMap.company]: submission.company,
    [fieldMap.idNumber]: submission.idNumber
  };

  if (fieldMap.submittedAt) {
    fields[fieldMap.submittedAt] = submission.createdAt;
  }

  if (fieldMap.syncStatus) {
    fields[fieldMap.syncStatus] = '已同步';
  }

  return fields;
}

export async function createBitableRecord(submission) {
  if (!hasFeishuConfig()) {
    throw new Error('feishu config missing');
  }

  return retry(async () => {
    const token = await getTenantAccessToken();
    const response = await fetch(
      `${FEISHU_BASE}/bitable/v1/apps/${appToken}/tables/${tableId}/records`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ fields: mapFields(submission) })
      }
    );

    const data = await response.json();
    if (!response.ok || data.code !== 0) {
      throw new Error(`create record failed: ${data.msg || response.statusText}`);
    }

    const recordId = data?.data?.record?.record_id;
    if (!recordId) {
      throw new Error('create record failed: missing record_id');
    }

    return recordId;
  }, 3);
}

export function isFeishuEnabled() {
  return hasFeishuConfig();
}
