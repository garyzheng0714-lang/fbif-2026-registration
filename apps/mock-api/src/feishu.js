import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const FEISHU_BASE = 'https://open.feishu.cn/open-apis';
const DRIVE_UPLOAD_ALL_LIMIT = 20 * 1024 * 1024;

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
  identity: process.env.FEISHU_FIELD_IDENTITY || '',
  idType: process.env.FEISHU_FIELD_ID_TYPE || '',
  businessType: process.env.FEISHU_FIELD_BUSINESS_TYPE || '贵司的业务类型',
  department: process.env.FEISHU_FIELD_DEPARTMENT || '您所处的部门（问卷题）',
  proof: process.env.FEISHU_FIELD_PROOF || '',
  proofUrl: process.env.FEISHU_FIELD_PROOF_URL || '专业观众证明（附件链接）',
  submittedAt: process.env.FEISHU_FIELD_SUBMITTED_AT || '',
  syncStatus: process.env.FEISHU_FIELD_SYNC_STATUS || ''
};

let tokenCache = {
  value: '',
  expiresAt: 0
};

let driveRootFolderCache = {
  value: '',
  expiresAt: 0
};

let bitableFieldMetaCache = {
  value: null,
  expiresAt: 0
};

const fileTokenCacheBySha256 = new Map();

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

async function readResponseBody(response) {
  const text = await response.text();
  if (!text) return { json: null, text: '' };
  try {
    return { json: JSON.parse(text), text };
  } catch {
    return { json: null, text };
  }
}

function toAdler32(chunk, state) {
  const MOD = 65521;
  let a = state?.a ?? 1;
  let b = state?.b ?? 0;
  for (let i = 0; i < chunk.length; i += 1) {
    a = (a + chunk[i]) % MOD;
    b = (b + a) % MOD;
  }
  return { a, b, value: ((b << 16) | a) >>> 0 };
}

async function hashFile(filePath) {
  const sha256 = crypto.createHash('sha256');
  let adler = { a: 1, b: 0, value: 1 };

  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => {
      sha256.update(chunk);
      adler = toAdler32(chunk, adler);
    });
    stream.on('end', resolve);
    stream.on('error', reject);
  });

  return {
    sha256: sha256.digest('hex'),
    adler32: String(adler.value)
  };
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

async function getDriveRootFolderToken() {
  const now = Date.now();
  if (driveRootFolderCache.value && driveRootFolderCache.expiresAt > now + 5 * 60 * 1000) {
    return driveRootFolderCache.value;
  }

  const token = await getTenantAccessToken();
  const response = await fetch(`${FEISHU_BASE}/drive/explorer/v2/root_folder/meta`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const data = await response.json();
  if (!response.ok || data.code !== 0 || !data?.data?.token) {
    throw new Error(`get drive root folder failed: ${data.msg || response.statusText}`);
  }

  driveRootFolderCache = {
    value: data.data.token,
    expiresAt: now + 10 * 60 * 1000
  };

  return driveRootFolderCache.value;
}

async function getBitableFieldMetaByName() {
  const now = Date.now();
  if (bitableFieldMetaCache.value && bitableFieldMetaCache.expiresAt > now + 30 * 1000) {
    return bitableFieldMetaCache.value;
  }

  const token = await getTenantAccessToken();
  const response = await fetch(
    `${FEISHU_BASE}/bitable/v1/apps/${appToken}/tables/${tableId}/fields?page_size=200`,
    {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  );

  const data = await response.json();
  if (!response.ok || data.code !== 0) {
    throw new Error(`list fields failed: ${data.msg || response.statusText}`);
  }

  const items = Array.isArray(data?.data?.items) ? data.data.items : [];
  const byName = new Map();

  for (const raw of items) {
    const name = String(raw?.field_name || raw?.name || '').trim();
    if (!name) continue;

    const meta = {
      name,
      type: raw?.type ?? raw?.field_type ?? null,
      uiType: String(raw?.ui_type || ''),
      optionsByName: new Map(),
      optionsById: new Set()
    };

    const options = Array.isArray(raw?.property?.options) ? raw.property.options : [];
    for (const opt of options) {
      const optName = String(opt?.name || opt?.option_name || '').trim();
      const optId = String(opt?.id || opt?.option_id || '').trim();
      if (!optName || !optId) continue;
      meta.optionsByName.set(optName, optId);
      meta.optionsById.add(optId);
    }

    byName.set(name, meta);
  }

  bitableFieldMetaCache = {
    value: byName,
    expiresAt: now + 10 * 60 * 1000
  };

  return byName;
}

function normalizeBusinessTypeOptionText(value) {
  const text = String(value || '').trim();
  if (!text) return '';

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

  return text;
}

function normalizeDepartmentOptionText(value) {
  const text = String(value || '').trim();
  if (!text) return '';

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

function normalizeSelectOptionText(value) {
  // Remove invisible characters that can sneak into copied labels and break exact matching.
  return String(value || '')
    .trim()
    .replace(/[\s\u200B-\u200D\uFEFF]/g, '');
}

function resolveSingleSelectOptionId(meta, rawValue) {
  const value = String(rawValue || '').trim();
  if (!meta || !value) return null;
  if (meta.uiType !== 'SingleSelect' && meta.type !== 3) return null;

  // If caller already passed an option id, accept it if it belongs to this field.
  if (value.startsWith('opt') && meta.optionsById.has(value)) {
    return value;
  }

  const exact = meta.optionsByName.get(value);
  if (exact) return exact;

  // Try exact match after stripping common invisible chars/whitespace.
  const normalizedValue = normalizeSelectOptionText(value);
  if (normalizedValue && normalizedValue !== value) {
    const normalizedExactMatches = [];
    for (const [name, id] of meta.optionsByName.entries()) {
      if (normalizeSelectOptionText(name) === normalizedValue) {
        normalizedExactMatches.push(id);
        if (normalizedExactMatches.length > 1) break;
      }
    }
    if (normalizedExactMatches.length === 1) return normalizedExactMatches[0];
  }

  const matches = [];
  for (const [name, id] of meta.optionsByName.entries()) {
    if (name.includes(value)) {
      matches.push(id);
      if (matches.length > 1) break;
    }
  }

  return matches.length === 1 ? matches[0] : null;
}

async function applySingleSelectMappings(fields, submission) {
  const metaByName = await getBitableFieldMetaByName();
  const traceId = submission?.traceId ? String(submission.traceId) : '';
  const idSuffix = String(submission?.idNumber || '').slice(-4);
  const logPrefix = traceId ? `[trace=${traceId}] [idSuffix=${idSuffix}]` : '';

  for (const [fieldName, value] of Object.entries(fields)) {
    if (typeof value !== 'string' || !value) continue;
    const meta = metaByName.get(fieldName);
    if (!meta) continue;
    if (meta.uiType !== 'SingleSelect' && meta.type !== 3) continue;

    const optionId = resolveSingleSelectOptionId(meta, value);
    if (!optionId) {
      // Keep original value so the request remains best-effort, but log for troubleshooting.
      console.warn(
        new Date().toISOString(),
        'bitable select option not found:',
        logPrefix,
        `field=${fieldName}`,
        `value=${value}`
      );
      continue;
    }

    fields[fieldName] = optionId;
  }

  return fields;
}

async function mapFields(submission) {
  const fields = {
    [fieldMap.name]: submission.name,
    [fieldMap.phone]: submission.phone,
    [fieldMap.title]: submission.title,
    [fieldMap.company]: submission.company,
    [fieldMap.idNumber]: submission.idNumber
  };

  if (fieldMap.identity && submission.role) {
    fields[fieldMap.identity] = submission.role === 'industry'
      ? '我是食品行业相关从业者'
      : '我是消费者';
  }

  if (fieldMap.idType && submission.idType) {
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

  if (fieldMap.proofUrl && Array.isArray(submission.proofUrls) && submission.proofUrls.length > 0) {
    fields[fieldMap.proofUrl] = submission.proofUrls.join(',');
  }

  if (fieldMap.submittedAt) {
    fields[fieldMap.submittedAt] = submission.createdAt;
  }

  if (fieldMap.syncStatus) {
    fields[fieldMap.syncStatus] = '已同步';
  }

  return applySingleSelectMappings(fields, submission);
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
        body: JSON.stringify({ fields: await mapFields(submission) })
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

export async function updateBitableRecord(recordId, fields) {
  if (!hasFeishuConfig()) {
    throw new Error('feishu config missing');
  }

  return retry(async () => {
    const token = await getTenantAccessToken();
    const response = await fetch(
      `${FEISHU_BASE}/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ fields })
      }
    );

    const data = await response.json();
    if (!response.ok || data.code !== 0) {
      throw new Error(`update record failed: ${data.msg || response.statusText}`);
    }
  }, 3);
}

export async function deleteBitableRecord(recordId) {
  if (!hasFeishuConfig()) {
    throw new Error('feishu config missing');
  }

  return retry(async () => {
    const token = await getTenantAccessToken();
    const response = await fetch(
      `${FEISHU_BASE}/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );

    const data = await response.json();
    if (!response.ok || data.code !== 0) {
      throw new Error(`delete record failed: ${data.msg || response.statusText}`);
    }
  }, 3);
}

async function uploadAllToDrive({ filePath, fileName, mimeType, size }) {
  return retry(async () => {
    const { adler32, sha256 } = await hashFile(filePath);
    const cacheKey = `${sha256}:${fileName}`;
    const cached = fileTokenCacheBySha256.get(cacheKey);
    if (cached) {
      return { fileToken: cached, sha256 };
    }

    const token = await getTenantAccessToken();
    const parentType = process.env.FEISHU_MEDIA_PARENT_TYPE || 'bitable_file';
    const parentNode = process.env.FEISHU_MEDIA_PARENT_NODE || appToken;

    // Use undici's native FormData/Blob to avoid stream Content-Length mismatches.
    const form = new FormData();
    form.append('file_name', fileName);
    form.append('parent_type', parentType);
    form.append('parent_node', parentNode);
    form.append('size', String(size));
    form.append('checksum', adler32);
    const fileBuffer = await fs.promises.readFile(filePath);
    form.append('file', new Blob([fileBuffer], {
      type: mimeType || 'application/octet-stream'
    }), fileName);

    const response = await fetch(`${FEISHU_BASE}/drive/v1/medias/upload_all`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`
      },
      body: form,
      duplex: 'half'
    });

    const { json: data, text } = await readResponseBody(response);
    if (!response.ok || !data || data.code !== 0) {
      const msg = data?.msg || text || response.statusText;
      throw new Error(`drive upload_all failed: ${msg}`);
    }

    const fileToken = data?.data?.file_token;
    if (!fileToken) {
      throw new Error('drive upload_all failed: missing file_token');
    }

    fileTokenCacheBySha256.set(cacheKey, fileToken);
    return { fileToken, sha256 };
  }, 3);
}

async function uploadChunkedToDrive({ filePath, fileName, mimeType, size }) {
  const parentType = process.env.FEISHU_MEDIA_PARENT_TYPE || 'bitable_file';
  const parentNode = process.env.FEISHU_MEDIA_PARENT_NODE || appToken;

  const token = await getTenantAccessToken();

  const prepareData = await retry(async () => {
    const prepareResp = await fetch(`${FEISHU_BASE}/drive/v1/medias/upload_prepare`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        file_name: fileName,
        parent_type: parentType,
        parent_node: parentNode,
        size
      })
    });

    const payload = await prepareResp.json();
    if (!prepareResp.ok || payload.code !== 0) {
      throw new Error(`drive upload_prepare failed: ${payload.msg || prepareResp.statusText}`);
    }

    return payload;
  }, 3);

  const uploadId = prepareData?.data?.upload_id;
  const blockSize = Number(prepareData?.data?.block_size || 0);
  const blockNum = Number(prepareData?.data?.block_num || 0);
  if (!uploadId || !blockSize || !blockNum) {
    throw new Error('drive upload_prepare failed: missing upload params');
  }

  const sha256 = crypto.createHash('sha256');
  const fd = await fs.promises.open(filePath, 'r');
  try {
    for (let seq = 0; seq < blockNum; seq += 1) {
      const offset = seq * blockSize;
      const remaining = Math.max(0, size - offset);
      const chunkSize = Math.min(blockSize, remaining);
      const buffer = Buffer.allocUnsafe(chunkSize);
      const { bytesRead } = await fd.read(buffer, 0, chunkSize, offset);
      const chunk = bytesRead === buffer.length ? buffer : buffer.subarray(0, bytesRead);

      sha256.update(chunk);
      const checksum = String(toAdler32(chunk).value);

      await retry(async () => {
        const form = new FormData();
        form.append('upload_id', uploadId);
        form.append('seq', String(seq));
        form.append('size', String(chunk.length));
        form.append('checksum', checksum);
        form.append('file', new Blob([chunk], {
          type: mimeType || 'application/octet-stream'
        }), fileName);

        const partResp = await fetch(`${FEISHU_BASE}/drive/v1/medias/upload_part`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`
          },
          body: form,
          duplex: 'half'
        });

        const { json: partData, text: partText } = await readResponseBody(partResp);
        if (!partResp.ok || !partData || partData.code !== 0) {
          const msg = partData?.msg || partText || partResp.statusText;
          throw new Error(`drive upload_part failed: ${msg}`);
        }
      }, 3);
    }
  } finally {
    await fd.close();
  }

  const finishData = await retry(async () => {
    const finishResp = await fetch(`${FEISHU_BASE}/drive/v1/medias/upload_finish`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        upload_id: uploadId,
        block_num: blockNum
      })
    });

    const payload = await finishResp.json();
    if (!finishResp.ok || payload.code !== 0) {
      throw new Error(`drive upload_finish failed: ${payload.msg || finishResp.statusText}`);
    }

    return payload;
  }, 3);

  const fileToken = finishData?.data?.file_token;
  if (!fileToken) {
    throw new Error('drive upload_finish failed: missing file_token');
  }

  const sha256Hex = sha256.digest('hex');
  fileTokenCacheBySha256.set(`${sha256Hex}:${fileName}`, fileToken);
  return { fileToken, sha256: sha256Hex };
}

export async function uploadProofFilesToDrive(proofUploads) {
  if (!Array.isArray(proofUploads) || proofUploads.length === 0) return [];

  const results = [];
  for (const upload of proofUploads) {
    const filePath = upload.path;
    const fileName = upload.originalName || path.basename(filePath);
    const mimeType = upload.mimeType || 'application/octet-stream';
    const size = Number(upload.size || 0);
    if (!filePath || !size) {
      throw new Error('invalid proof upload');
    }

    const uploaded = size <= DRIVE_UPLOAD_ALL_LIMIT
      ? await uploadAllToDrive({ filePath, fileName, mimeType, size })
      : await uploadChunkedToDrive({ filePath, fileName, mimeType, size });
    results.push(uploaded.fileToken);
  }

  return results;
}

export function buildBitableProofFieldValue(fileTokens) {
  if (!fieldMap.proof || !Array.isArray(fileTokens) || fileTokens.length === 0) return null;
  return {
    fieldName: fieldMap.proof,
    value: fileTokens.map((token) => ({ file_token: token }))
  };
}

export function buildBitableProofUrlFieldValue(proofUrls) {
  if (!fieldMap.proofUrl || !Array.isArray(proofUrls) || proofUrls.length === 0) return null;
  return {
    fieldName: fieldMap.proofUrl,
    value: proofUrls.join(',')
  };
}

export function isFeishuEnabled() {
  return hasFeishuConfig();
}
