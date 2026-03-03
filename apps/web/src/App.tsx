import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { useThrottleCallback } from './hooks/useThrottleCallback';
import {
  FeishuButton,
  FeishuCard,
  FeishuDialog,
  FeishuField,
  FeishuInput,
  FeishuLoading,
  FeishuSelect
} from './components/feishu/FeishuPrimitives';
import {
  composeInternationalPhone,
  validateChineseId,
  validatePhone,
  validateRequired
} from './utils/validation';

function defaultApiBase() {
  // Production should use same-origin /api reverse proxy.
  // Only fallback to :8080 for local development hosts.
  if (typeof window !== 'undefined' && window.location) {
    const protocol = window.location.protocol || 'http:';
    const hostname = window.location.hostname || 'localhost';
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0'
    ) {
      return `${protocol}//${hostname}:8080`;
    }
    return '';
  }
  return '';
}

const API_BASE = import.meta.env.VITE_API_URL || defaultApiBase();
function apiUrl(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const base = String(API_BASE || '').trim().replace(/\/+$/, '');
  if (!base) return normalizedPath;
  if (base.endsWith('/api') && normalizedPath.startsWith('/api/')) {
    return `${base}${normalizedPath.slice(4)}`;
  }
  return `${base}${normalizedPath}`;
}
const FORM_DRAFT_KEY = 'fbif_form_draft_v2';
const TOP_BANNER_URL =
  'https://fbif-feishu-base.oss-cn-shanghai.aliyuncs.com/fbif-attachment-to-url/2026/02/tblMQeXvSGd7Hebf_YHcyINOqnzM9YxjJToK2RA_1770366619961/img_v3_02ul_3790aefe-c6b6-473f-9c05-97aa380983bg_1770366621905.jpg';
const SUCCESS_VERTICAL_BANNER_URL =
  'https://fbif-feishu-base.oss-cn-shanghai.aliyuncs.com/fbif-attachment-to-url/2026/02/tblu5FXYOkS5dTd9_gbuDN4Q9JoJvSEnQZzkedw_1771995529125/img_v3_02v8_5f987292-5078-4999-b5c1-45f30e9db97g_1771995529400.png';
const CARRIE_WECHAT_QR_URL =
  'https://fbif-feishu-base.oss-cn-shanghai.aliyuncs.com/fbif-attachment-to-url/2026/02/tblu5FXYOkS5dTd9_4n_OhFZpJMUwWmIfeukVLQ_1771982405432/img_v3_02v8_558254bb-fd95-4e88-8eed-da8e5bc2b20g_1771982405633.jpg';
const MAX_PROOF_UPLOAD_CONCURRENCY = 3;

type Identity = '' | 'industry' | 'consumer';
type SubmittedRole = 'industry' | 'consumer';
type IdType =
  | ''
  | 'cn_id'
  | 'hk_macao_mainland_permit'
  | 'taiwan_mainland_permit'
  | 'passport'
  | 'foreign_permanent_resident_id'
  | 'hmt_residence_permit';

function createClientRequestId() {
  try {
    if (globalThis.crypto?.randomUUID) {
      return globalThis.crypto.randomUUID();
    }
  } catch {
    // Ignore crypto errors and fallback.
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const industryBusinessOptions = [
  '食品饮料品牌方',
  '原材料供应商',
  '包装与设备公司',
  '设计营销与咨询策划服务提供商',
  '线下零售',
  '线上零售',
  '新零售',
  '进出口贸易',
  '国内贸易',
  '餐饮及酒店',
  '其他'
] as const;

const departmentOptions = [
  '高管、战略部门',
  '研发、产品、包装',
  '品牌、市场、营销',
  '采购、供应链、生产',
  '渠道、销售、电商',
  '高校',
  '其他（如财务、行政等）'
] as const;

const idTypeOptions = [
  { value: 'cn_id', label: '中国居民身份证' },
  { value: 'hk_macao_mainland_permit', label: '港澳居民来往内地通行证' },
  { value: 'taiwan_mainland_permit', label: '台湾居民来往大陆通行证' },
  { value: 'passport', label: '护照' },
  { value: 'foreign_permanent_resident_id', label: '外国人永久居留身份证' },
  { value: 'hmt_residence_permit', label: '港澳台居民居住证' }
] as const;

const phoneCountryCodeOptions = [
  { value: '+86', label: '中国', code: '+86' },
  { value: '+852', label: '中国香港', code: '+852' },
  { value: '+853', label: '中国澳门', code: '+853' },
  { value: '+886', label: '中国台湾', code: '+886' },
  { value: '+1', label: '美国/加拿大', code: '+1' },
  { value: '+7', label: '俄罗斯/哈萨克斯坦', code: '+7' },
  { value: '+20', label: '埃及', code: '+20' },
  { value: '+27', label: '南非', code: '+27' },
  { value: '+30', label: '希腊', code: '+30' },
  { value: '+31', label: '荷兰', code: '+31' },
  { value: '+32', label: '比利时', code: '+32' },
  { value: '+33', label: '法国', code: '+33' },
  { value: '+34', label: '西班牙', code: '+34' },
  { value: '+36', label: '匈牙利', code: '+36' },
  { value: '+39', label: '意大利', code: '+39' },
  { value: '+40', label: '罗马尼亚', code: '+40' },
  { value: '+41', label: '瑞士', code: '+41' },
  { value: '+43', label: '奥地利', code: '+43' },
  { value: '+44', label: '英国', code: '+44' },
  { value: '+45', label: '丹麦', code: '+45' },
  { value: '+46', label: '瑞典', code: '+46' },
  { value: '+47', label: '挪威', code: '+47' },
  { value: '+48', label: '波兰', code: '+48' },
  { value: '+49', label: '德国', code: '+49' },
  { value: '+52', label: '墨西哥', code: '+52' },
  { value: '+54', label: '阿根廷', code: '+54' },
  { value: '+55', label: '巴西', code: '+55' },
  { value: '+56', label: '智利', code: '+56' },
  { value: '+57', label: '哥伦比亚', code: '+57' },
  { value: '+60', label: '马来西亚', code: '+60' },
  { value: '+61', label: '澳大利亚', code: '+61' },
  { value: '+62', label: '印度尼西亚', code: '+62' },
  { value: '+63', label: '菲律宾', code: '+63' },
  { value: '+64', label: '新西兰', code: '+64' },
  { value: '+65', label: '新加坡', code: '+65' },
  { value: '+66', label: '泰国', code: '+66' },
  { value: '+81', label: '日本', code: '+81' },
  { value: '+82', label: '韩国', code: '+82' },
  { value: '+84', label: '越南', code: '+84' },
  { value: '+90', label: '土耳其', code: '+90' },
  { value: '+91', label: '印度', code: '+91' },
  { value: '+92', label: '巴基斯坦', code: '+92' },
  { value: '+93', label: '阿富汗', code: '+93' },
  { value: '+94', label: '斯里兰卡', code: '+94' },
  { value: '+95', label: '缅甸', code: '+95' },
  { value: '+98', label: '伊朗', code: '+98' },
  { value: '+212', label: '摩洛哥', code: '+212' },
  { value: '+213', label: '阿尔及利亚', code: '+213' },
  { value: '+216', label: '突尼斯', code: '+216' },
  { value: '+218', label: '利比亚', code: '+218' },
  { value: '+220', label: '冈比亚', code: '+220' },
  { value: '+221', label: '塞内加尔', code: '+221' },
  { value: '+223', label: '马里', code: '+223' },
  { value: '+225', label: '科特迪瓦', code: '+225' },
  { value: '+227', label: '尼日尔', code: '+227' },
  { value: '+228', label: '多哥', code: '+228' },
  { value: '+230', label: '毛里求斯', code: '+230' },
  { value: '+231', label: '利比里亚', code: '+231' },
  { value: '+233', label: '加纳', code: '+233' },
  { value: '+234', label: '尼日利亚', code: '+234' },
  { value: '+254', label: '肯尼亚', code: '+254' },
  { value: '+255', label: '坦桑尼亚', code: '+255' },
  { value: '+256', label: '乌干达', code: '+256' },
  { value: '+260', label: '赞比亚', code: '+260' },
  { value: '+263', label: '津巴布韦', code: '+263' },
  { value: '+351', label: '葡萄牙', code: '+351' },
  { value: '+353', label: '爱尔兰', code: '+353' },
  { value: '+358', label: '芬兰', code: '+358' },
  { value: '+359', label: '保加利亚', code: '+359' },
  { value: '+370', label: '立陶宛', code: '+370' },
  { value: '+371', label: '拉脱维亚', code: '+371' },
  { value: '+372', label: '爱沙尼亚', code: '+372' },
  { value: '+380', label: '乌克兰', code: '+380' },
  { value: '+385', label: '克罗地亚', code: '+385' },
  { value: '+386', label: '斯洛文尼亚', code: '+386' },
  { value: '+420', label: '捷克', code: '+420' },
  { value: '+421', label: '斯洛伐克', code: '+421' },
  { value: '+960', label: '马尔代夫', code: '+960' },
  { value: '+966', label: '沙特阿拉伯', code: '+966' },
  { value: '+971', label: '阿联酋', code: '+971' },
  { value: '+972', label: '以色列', code: '+972' },
  { value: '+974', label: '卡塔尔', code: '+974' },
  { value: '+975', label: '不丹', code: '+975' },
  { value: '+976', label: '蒙古', code: '+976' },
  { value: '+977', label: '尼泊尔', code: '+977' }
] as const;

const initialIndustryForm = {
  name: '',
  idType: 'cn_id' as IdType,
  idNumber: '',
  phoneCountryCode: '+86',
  phone: '',
  company: '',
  title: '',
  businessType: '',
  department: '',
  proofFiles: [] as string[]
};

const initialConsumerForm = {
  name: '',
  idType: 'cn_id' as IdType,
  idNumber: '',
  phoneCountryCode: '+86',
  phone: ''
};

type IndustryForm = typeof initialIndustryForm;
type ConsumerForm = typeof initialConsumerForm;
type IndustryErrors = Record<keyof IndustryForm, string>;
type ConsumerErrors = Record<keyof ConsumerForm, string>;
type IdVerifyState = {
  status: 'idle' | 'verifying' | 'passed' | 'failed';
  message: string;
  token: string;
  verifiedName: string;
  verifiedIdNumber: string;
};
type Notice = string;

function normalizeDraftIdType(value: unknown): IdType {
  const text = String(value || '').trim();
  const allowed: IdType[] = [
    'cn_id',
    'hk_macao_mainland_permit',
    'taiwan_mainland_permit',
    'passport',
    'foreign_permanent_resident_id',
    'hmt_residence_permit'
  ];
  return (allowed as string[]).includes(text) ? (text as IdType) : 'cn_id';
}

const initialIdVerifyState: IdVerifyState = {
  status: 'idle',
  message: '',
  token: '',
  verifiedName: '',
  verifiedIdNumber: ''
};

const otherIdRegex = /^[A-Za-z0-9-]{6,20}$/;

async function parseJsonIfPossible(response: Response): Promise<any | null> {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return null;
  }
  try {
    return await response.json();
  } catch {
    return null;
  }
}

type OssPolicy = {
  host: string;
  key: string;
  publicUrl: string;
  fields: Record<string, string>;
};

async function createOssPolicy(file: File, csrfToken: string): Promise<OssPolicy> {
  const resp = await fetch(apiUrl('/api/oss/policy'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken
    },
    credentials: 'include',
    body: JSON.stringify({
      filename: file.name,
      size: file.size
    })
  });

  const data = await parseJsonIfPossible(resp);
  if (!resp.ok) {
    const msg = String(data?.message || data?.error || '').trim();
    throw new Error(msg ? `oss_policy_failed:${resp.status}:${msg}` : `oss_policy_failed:${resp.status}`);
  }
  if (!data?.host || !data?.publicUrl || !data?.fields) {
    throw new Error('oss_policy_failed:bad_response');
  }

  return {
    host: String(data.host),
    key: String(data.key || ''),
    publicUrl: String(data.publicUrl),
    fields: data.fields as Record<string, string>
  };
}

function uploadFileToOss(
  file: File,
  policy: OssPolicy,
  onProgress: (loadedBytes: number) => void,
  onXhrReady?: (xhr: XMLHttpRequest) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    Object.entries(policy.fields || {}).forEach(([k, v]) => {
      form.append(k, String(v));
    });
    if (!policy.fields?.key && policy.key) {
      form.append('key', policy.key);
    }
    form.append('file', file, file.name);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', policy.host);
    onXhrReady?.(xhr);

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      onProgress(Math.max(0, Math.min(file.size, Number(event.loaded || 0))));
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(file.size);
        resolve(policy.publicUrl);
        return;
      }
      reject(new Error(`oss_upload_failed:${xhr.status}`));
    };

    xhr.onerror = () => reject(new Error('oss_upload_network_error'));
    xhr.onabort = () => reject(new Error('oss_upload_aborted'));
    xhr.send(form);
  });
}

function formatUploadError(message: string) {
  const raw = String(message || '').trim();

  if (!raw) return '转换失败，请删除后重传';

  if (raw === 'csrf_failed') {
    return '授权失败，请刷新页面后重试';
  }

  if (raw.startsWith('oss_policy_failed')) {
    // Common case: oversize / OSS not configured / CSRF failure.
    if (raw.includes('too large') || raw.includes('max=')) {
      return '文件过大（单个文件最大 50MB），请压缩后重试';
    }
    return '获取上传签名失败，请刷新页面后重试';
  }

  if (raw.startsWith('oss_upload_failed:')) {
    const code = raw.split(':')[1] || '';
    if (code === '403') return 'OSS 拒绝上传（403），请稍后重试';
    if (code === '400') return 'OSS 上传参数错误（400），请重试';
    if (code) return `OSS 上传失败（${code}），请重试`;
    return 'OSS 上传失败，请重试';
  }

  if (raw === 'oss_upload_network_error') {
    return '网络错误或 OSS 跨域失败，请更换网络后重试';
  }

  return '转换失败，请删除后重传';
}

function validateIdNumber(idType: IdType, idNumber: string, role?: 'industry' | 'consumer') {
  const normalized = idNumber.trim();
  if (!idType) return '请选择证件类型';
  if (!normalized) return '请输入证件号码';
  if (idType === 'cn_id') {
    const idError = validateChineseId(normalized);
    if (idError) return '请输入正确的身份证号';
    if (role) {
      const ageCheck = checkAgeLimit(role, idType, normalized);
      if (!ageCheck.ok) return ageCheck.message;
    }
    return '';
  }
  if (!otherIdRegex.test(normalized)) {
    return '证件号格式不正确（6-20位字母/数字/短横线）';
  }
  return '';
}

function getAgeFromChineseId(idNumber: string) {
  const normalized = String(idNumber || '').trim().toUpperCase();
  if (validateChineseId(normalized)) return null;
  const raw = normalized.slice(6, 14);
  if (!/^\d{8}$/.test(raw)) return null;

  const year = Number(raw.slice(0, 4));
  const month = Number(raw.slice(4, 6));
  const day = Number(raw.slice(6, 8));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;

  const birthday = new Date(year, month - 1, day);
  if (
    birthday.getFullYear() !== year ||
    birthday.getMonth() !== month - 1 ||
    birthday.getDate() !== day
  ) {
    return null;
  }

  const now = new Date();
  let age = now.getFullYear() - year;
  const beforeBirthday =
    now.getMonth() + 1 < month ||
    (now.getMonth() + 1 === month && now.getDate() < day);
  if (beforeBirthday) age -= 1;
  return age;
}

function checkAgeLimit(role: 'industry' | 'consumer', idType: IdType, idNumber: string) {
  if (idType !== 'cn_id') {
    return { ok: true as const };
  }
  const age = getAgeFromChineseId(idNumber);
  if (age == null) {
    return { ok: true as const };
  }
  if (role === 'consumer' && (age < 16 || age > 50)) {
    return { ok: false as const, message: '因场内人流管控需要，16岁以下、50岁以上群体暂无法报名，感谢您的理解。' };
  }
  if (role === 'industry' && age < 16) {
    return { ok: false as const, message: '16岁以下观众禁止入场，请勿报名，感谢您的理解' };
  }
  return { ok: true as const };
}

function fieldKey(identity: Exclude<Identity, ''>, field: string) {
  return `${identity}.${field}`;
}

type ProofPreview = {
  id: string;
  name: string;
  size: number;
  type: string;
  previewUrl?: string;
  status: 'pending' | 'uploading' | 'success' | 'error';
  progress: number;
  ossUrl: string;
  error?: string;
};

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let idx = 0;
  let value = bytes;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function canPreviewImage(file: File) {
  return Boolean(file.type && file.type.startsWith('image/'));
}

function isPdfFile(file: File) {
  const name = (file.name || '').toLowerCase();
  const type = (file.type || '').toLowerCase();
  return type === 'application/pdf' || name.endsWith('.pdf');
}

function proofFileKey(file: File) {
  return `${file.name}::${file.size}::${file.lastModified}`;
}

function IndustryCardIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 9.25c0-1.8 1.45-3.25 3.25-3.25h9.5A3.25 3.25 0 0 1 20 9.25v7.5A3.25 3.25 0 0 1 16.75 20h-9.5A3.25 3.25 0 0 1 4 16.75v-7.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M8 6V4.75A1.75 1.75 0 0 1 9.75 3h4.5A1.75 1.75 0 0 1 16 4.75V6"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path d="M4 12.5h16" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function ConsumerCardIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="8.5" r="3.5" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M5 19.5c0-3.3 2.95-5.5 7-5.5s7 2.2 7 5.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M7 18.5h10a4 4 0 0 0 .65-7.95A5.5 5.5 0 0 0 6.5 9.7 4 4 0 0 0 7 18.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path d="M12 8.5v6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path
        d="m9.5 11 2.5-2.5 2.5 2.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3v10"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="m8 11 4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5 20h14"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SectionPersonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4s-4 1.79-4 4s1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v1c0 .55.45 1 1 1h14c.55 0 1-.45 1-1v-1c0-2.66-5.33-4-8-4z" />
    </svg>
  );
}

function SectionVerifiedUserIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M11.19 1.36l-7 3.11C3.47 4.79 3 5.51 3 6.3V11c0 5.55 3.84 10.74 9 12c5.16-1.26 9-6.45 9-12V6.3c0-.79-.47-1.51-1.19-1.83l-7-3.11c-.51-.23-1.11-.23-1.62 0zm-1.9 14.93L6.7 13.7a.996.996 0 1 1 1.41-1.41L10 14.17l5.88-5.88a.996.996 0 1 1 1.41 1.41l-6.59 6.59a.996.996 0 0 1-1.41 0z" />
    </svg>
  );
}

function SectionBusinessIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 7V5c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V9c0-1.1-.9-2-2-2h-8zM6 19H4v-2h2v2zm0-4H4v-2h2v2zm0-4H4V9h2v2zm0-4H4V5h2v2zm4 12H8v-2h2v2zm0-4H8v-2h2v2zm0-4H8V9h2v2zm0-4H8V5h2v2zm9 12h-7v-2h2v-2h-2v-2h2v-2h-2V9h7c.55 0 1 .45 1 1v8c0 .55-.45 1-1 1zm-1-8h-2v2h2v-2zm0 4h-2v2h2v-2z" />
    </svg>
  );
}

function CloudUploadRoundIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5c0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l4.65-4.65c.2-.2.51-.2.71 0L17 13h-3z" />
    </svg>
  );
}

function CheckCircleRoundIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10s10-4.48 10-10S17.52 2 12 2zM9.29 16.29L5.7 12.7a.996.996 0 1 1 1.41-1.41L10 14.17l6.88-6.88a.996.996 0 1 1 1.41 1.41l-7.59 7.59a.996.996 0 0 1-1.41 0z" />
    </svg>
  );
}

function CancelRoundIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10s10-4.47 10-10S17.53 2 12 2zm4.3 14.3a.996.996 0 0 1-1.41 0L12 13.41L9.11 16.3a.996.996 0 1 1-1.41-1.41L10.59 12L7.7 9.11A.996.996 0 1 1 9.11 7.7L12 10.59l2.89-2.89a.996.996 0 1 1 1.41 1.41L13.41 12l2.89 2.89c.38.38.38 1.02 0 1.41z" />
    </svg>
  );
}

function PendingActionsRoundIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17 12c-1.1 0-2 .9-2 2s.9 2 2 2s2-.9 2-2s-.9-2-2-2zm0-10H7c-1.1 0-2 .9-2 2v16l4-4h8c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-6 9H8V9h3v2zm5-4H8V5h8v2z" />
    </svg>
  );
}

function EventAvailableRoundIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V10h14v9zm-7.06-1.29l4.24-4.24l-1.41-1.41l-2.83 2.83l-1.41-1.41l-1.41 1.41l2.82 2.82z" />
    </svg>
  );
}

function SupportAgentRoundIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 1a9 9 0 0 0-9 9v5a3 3 0 0 0 3 3h1v-8H5v-1a7 7 0 1 1 14 0v1h-2v8h2a3 3 0 0 0 3-3v-5a9 9 0 0 0-9-9zm-3 17a1.5 1.5 0 0 0 1.5 1.5h3A1.5 1.5 0 0 0 15.5 18H9z" />
    </svg>
  );
}

function ChatRoundIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H7l-5 4V6a2 2 0 0 1 2-2zm3 6h10V8H7v2zm0 3h7v-2H7v2z" />
    </svg>
  );
}

function OpenInNewSmallIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M9.5 2.5h4v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.5 2.5 7.5 8.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6.5 3.5h-2a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function QrCodeSmallIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.5 2.5h3v3h-3zm8 0h3v3h-3zm-8 8h3v3h-3zm5-5h1v1h-1zm1 1h1v1h-1zm-1 1h1v1h-1zm2 0h1v1h-1zm1 1h1v1h-1zm-3 2h1v1h-1zm1 1h1v1h-1zm2-1h2v2h-2z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2 2h4v4H2zm8 0h4v4h-4zM2 10h4v4H2z" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function ChevronLeftSmallIcon() {
  return (
    <svg viewBox="0 0 1152 1024" fill="none" aria-hidden="true">
      <path
        d="M55.364267 501.464178c-11.241244 0-22.596267-4.346311-31.197867-13.061689a45.033244 45.033244 0 0 1 0-63.0784L421.091556 23.483733a43.713422 43.713422 0 0 1 62.327466 0 45.033244 45.033244 0 0 1 0 63.101156L86.471111 488.402489a43.576889 43.576889 0 0 1-31.1296 13.061689z m396.856889 401.840355c-11.264 0-22.641778-4.369067-31.220623-13.061689L24.1664 488.402489a45.033244 45.033244 0 0 1 0-63.0784 43.713422 43.713422 0 0 1 62.327467 0L483.419022 827.164444a45.033244 45.033244 0 0 1 0 63.0784 43.645156 43.645156 0 0 1-31.220622 13.061689z"
        fill="currentColor"
      />
    </svg>
  );
}

export default function App() {
  const [page, setPage] = useState<'identity' | 'form' | 'submitted'>('identity');
  const [identity, setIdentity] = useState<Identity>('');
  const [submittedRole, setSubmittedRole] = useState<SubmittedRole | null>(null);
  const [industryForm, setIndustryForm] = useState(initialIndustryForm);
  const [consumerForm, setConsumerForm] = useState(initialConsumerForm);
  const [industryIdVerify, setIndustryIdVerify] = useState<IdVerifyState>(initialIdVerifyState);
  const [consumerIdVerify, setConsumerIdVerify] = useState<IdVerifyState>(initialIdVerifyState);
  const [clientRequestId, setClientRequestId] = useState(() => createClientRequestId());
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [notice, setNotice] = useState<Notice>('');
  const [isSwitching, setIsSwitching] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [proofPreviews, setProofPreviews] = useState<ProofPreview[]>([]);
  const proofPreviewUrlsRef = useRef<string[]>([]);
  const proofUploadXhrsRef = useRef<Map<string, XMLHttpRequest>>(new Map());
  const csrfTokenCacheRef = useRef<{ token: string; expiresAt: number }>({
    token: '',
    expiresAt: 0
  });
  const csrfTokenRequestRef = useRef<Promise<string> | null>(null);
  const switchTimerRef = useRef<number | null>(null);
  const proofInputRef = useRef<HTMLInputElement | null>(null);
  const proofUploadsRef = useRef<File[]>([]);
  const toastTimerRef = useRef<number | null>(null);
  const [toast, setToast] = useState<{ open: boolean; message: string }>({
    open: false,
    message: ''
  });
  const [qrDialogOpen, setQrDialogOpen] = useState(false);
  const [ticketPolicyAccepted, setTicketPolicyAccepted] = useState(false);
  const [submitDialog, setSubmitDialog] = useState<{
    open: boolean;
    status: 'submitting' | 'success' | 'error';
    submissionId: string;
    traceId: string;
  }>({
    open: false,
    status: 'submitting',
    submissionId: '',
    traceId: ''
  });

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(FORM_DRAFT_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (typeof parsed.clientRequestId === 'string' && parsed.clientRequestId.trim()) {
        setClientRequestId(parsed.clientRequestId.trim());
      }
      if (parsed.identity === 'industry' || parsed.identity === 'consumer') {
        setIdentity(parsed.identity);
      }
      if (parsed.industryForm) {
        const { proofFiles: _proofFiles, ...rest } = parsed.industryForm;
        setIndustryForm((prev) => ({
          ...prev,
          ...rest,
          idType: normalizeDraftIdType(rest?.idType),
          proofFiles: []
        }));
      }
      if (parsed.consumerForm) {
        setConsumerForm((prev) => ({
          ...prev,
          ...parsed.consumerForm,
          idType: normalizeDraftIdType(parsed.consumerForm?.idType)
        }));
      }
    } catch {
      // Ignore invalid local draft.
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const draft = {
          clientRequestId,
          identity,
          industryForm: { ...industryForm, proofFiles: [] },
          consumerForm
        };
        window.localStorage.setItem(FORM_DRAFT_KEY, JSON.stringify(draft));
      } catch {
        // Ignore temporary storage write failure.
      }
    }, 250);

    return () => window.clearTimeout(timer);
  }, [clientRequestId, identity, industryForm, consumerForm]);

  useEffect(() => {
    return () => {
      if (switchTimerRef.current) {
        window.clearTimeout(switchTimerRef.current);
      }
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
      proofUploadXhrsRef.current.forEach((xhr) => {
        try {
          xhr.abort();
        } catch {
          // Ignore abort failures.
        }
      });
      proofUploadXhrsRef.current.clear();
      proofPreviewUrlsRef.current.forEach((url) => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // Ignore revoke failures.
        }
      });
      proofPreviewUrlsRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (page !== 'form') return;

    // Warm up CSRF token on form entry and keep it fresh in background.
    // This cuts submit-time token fetch latency under peak traffic.
    void fetchCsrfToken().catch(() => {
      // Ignore warmup failure; submit path still retries.
    });

    const renewTimer = window.setInterval(() => {
      const ttlLeftMs = csrfTokenCacheRef.current.expiresAt - Date.now();
      if (ttlLeftMs > 90_000) return;
      void fetchCsrfToken().catch(() => {
        // Ignore renewal failure; submit path still retries.
      });
    }, 30_000);

    return () => {
      window.clearInterval(renewTimer);
    };
  }, [page]);

  const industryErrors: IndustryErrors = useMemo(() => {
    const hasProofFiles = proofPreviews.length > 0;
    const hasFailedProof = proofPreviews.some((item) => item.status === 'error');

    let proofError = '';
    if (!hasProofFiles) {
      proofError = '请上传专业观众证明材料';
    } else if (hasFailedProof) {
      proofError = '有附件转换失败，请删除后重传';
    }

    return {
      name: validateRequired(industryForm.name, '姓名', 2, 32),
      idType: industryForm.idType ? '' : '请选择证件类型',
      idNumber: validateIdNumber(industryForm.idType, industryForm.idNumber, 'industry'),
      phoneCountryCode: '',
      phone: validatePhone(industryForm.phone, industryForm.phoneCountryCode),
      company: validateRequired(industryForm.company, '公司', 2, 64),
      title: validateRequired(industryForm.title, '职位', 2, 32),
      businessType: industryForm.businessType ? '' : '请选择业务类型',
      department: industryForm.department ? '' : '请选择所在部门',
      proofFiles: proofError
    };
  }, [industryForm, proofPreviews]);

  const consumerErrors: ConsumerErrors = useMemo(() => {
    return {
      name: validateRequired(consumerForm.name, '姓名', 2, 32),
      idType: consumerForm.idType ? '' : '请选择证件类型',
      idNumber: validateIdNumber(consumerForm.idType, consumerForm.idNumber, 'consumer'),
      phoneCountryCode: '',
      phone: validatePhone(consumerForm.phone, consumerForm.phoneCountryCode)
    };
  }, [consumerForm]);

  const activeErrors = identity === 'industry'
    ? industryErrors
    : identity === 'consumer'
      ? consumerErrors
      : null;

  const industryNeedsIdVerify = industryForm.idType === 'cn_id';
  const consumerNeedsIdVerify = consumerForm.idType === 'cn_id';
  const needsIdVerify = identity === 'industry'
    ? industryNeedsIdVerify
    : identity === 'consumer'
      ? consumerNeedsIdVerify
      : false;
  const activeIdVerifyState = identity === 'industry'
    ? industryIdVerify
    : identity === 'consumer'
      ? consumerIdVerify
      : initialIdVerifyState;
  const isIdVerifyPassed = identity === 'industry'
    ? industryIdVerify.status === 'passed'
    : identity === 'consumer'
      ? consumerIdVerify.status === 'passed'
      : false;
  const hasFieldError = Boolean(activeErrors ? Object.values(activeErrors).some(Boolean) : true);

  const markTouched = (key: string) => {
    setTouched((prev) => ({ ...prev, [key]: true }));
  };

  const shouldShowError = (key: string) => submitAttempted || touched[key];

  const handleIndustryChange =
    (field: keyof IndustryForm) =>
    (
      event: ChangeEvent<HTMLInputElement> | ChangeEvent<HTMLSelectElement>
    ) => {
      const value = event.target.value;
      setIndustryForm((prev) => ({ ...prev, [field]: value }));
      if (field === 'name' || field === 'idType' || field === 'idNumber') {
        setIndustryIdVerify(initialIdVerifyState);
      }
    };

  const handleConsumerChange =
    (field: keyof ConsumerForm) =>
    (
      event: ChangeEvent<HTMLInputElement> | ChangeEvent<HTMLSelectElement>
    ) => {
      const value = event.target.value;
      setConsumerForm((prev) => ({ ...prev, [field]: value }));
      if (field === 'name' || field === 'idType' || field === 'idNumber') {
        setConsumerIdVerify(initialIdVerifyState);
      }
    };

  const clearProofFiles = () => {
    proofUploadsRef.current = [];
    proofUploadXhrsRef.current.forEach((xhr) => {
      try {
        xhr.abort();
      } catch {
        // Ignore abort failures.
      }
    });
    proofUploadXhrsRef.current.clear();
    proofPreviewUrlsRef.current.forEach((url) => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // Ignore revoke failures.
      }
    });
    proofPreviewUrlsRef.current = [];
    setProofPreviews([]);
    if (proofInputRef.current) {
      proofInputRef.current.value = '';
    }
    setIndustryForm((prev) => ({ ...prev, proofFiles: [] }));
  };

  const fetchCsrfToken = async (force = false) => {
    if (!force && csrfTokenCacheRef.current.token && csrfTokenCacheRef.current.expiresAt > Date.now()) {
      return csrfTokenCacheRef.current.token;
    }

    if (!force && csrfTokenRequestRef.current) {
      return csrfTokenRequestRef.current;
    }

    const requestPromise = (async () => {
      const csrfResp = await fetch(apiUrl('/api/csrf'), {
        credentials: 'include'
      });

      const csrfData = await parseJsonIfPossible(csrfResp);
      if (!csrfResp.ok || !csrfData?.csrfToken) {
        throw new Error('csrf_failed');
      }

      const token = String(csrfData.csrfToken);
      csrfTokenCacheRef.current = {
        token,
        expiresAt: Date.now() + 3 * 60 * 1000
      };
      return token;
    })();

    csrfTokenRequestRef.current = requestPromise;
    try {
      return await requestPromise;
    } finally {
      if (csrfTokenRequestRef.current === requestPromise) {
        csrfTokenRequestRef.current = null;
      }
    }
  };

  const showToast = (message: string) => {
    if (!message) return;
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    setToast({ open: true, message });
    toastTimerRef.current = window.setTimeout(() => {
      setToast({ open: false, message: '' });
      toastTimerRef.current = null;
    }, 2200);
  };

  const verifyCnIdFor = async (
    role: 'industry' | 'consumer'
  ): Promise<{ ok: boolean; message?: string; token?: string }> => {
    const form = role === 'industry' ? industryForm : consumerForm;
    const name = form.name.trim();
    const idType = form.idType;
    const idNumber = form.idNumber.trim().toUpperCase();
    const setState = role === 'industry' ? setIndustryIdVerify : setConsumerIdVerify;

    if (idType !== 'cn_id') {
      setState(initialIdVerifyState);
      return { ok: true };
    }

    const nameError = validateRequired(name, '姓名', 2, 32);
    const idError = validateChineseId(idNumber);
    if (nameError || idError) {
      setState({
        ...initialIdVerifyState,
        status: 'failed',
        message: nameError || '请输入正确的身份证号'
      });
      return { ok: false, message: nameError || '请输入正确的身份证号' };
    }

    setState((prev) => ({
      ...prev,
      status: 'verifying',
      message: '正在验证，请稍候...'
    }));

    try {
      let csrfToken = await fetchCsrfToken();
      let verifyData: any = null;
      let completed = false;

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const resp = await fetch(apiUrl('/api/id-verify'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken
          },
          credentials: 'include',
          body: JSON.stringify({
            name,
            idType: 'cn_id',
            idNumber
          })
        });

        verifyData = await parseJsonIfPossible(resp);
        if (resp.ok) {
          completed = true;
          break;
        }

        if (resp.status === 403 && attempt === 0) {
          csrfTokenCacheRef.current = { token: '', expiresAt: 0 };
          csrfToken = await fetchCsrfToken(true);
          continue;
        }

        const message = String(verifyData?.message || verifyData?.error || '').trim();
        if (resp.status === 429) {
          throw new Error(message || '验证过于频繁，请稍后再试');
        }
        throw new Error(
          message ||
            (resp.status >= 500
              ? '实名验证服务暂时不可用，请稍后重试'
              : '身份证与姓名不匹配')
        );
      }

      if (!completed) {
        throw new Error('身份证与姓名不匹配');
      }

      const verified = Boolean(verifyData?.verified);
      if (!verified || !verifyData?.verificationToken) {
        setState({
          ...initialIdVerifyState,
          status: 'failed',
          message: '身份证与姓名不匹配'
        });
        return { ok: false, message: '身份证与姓名不匹配' };
      }

      setState({
        status: 'passed',
        message: '实名验证通过',
        token: String(verifyData.verificationToken),
        verifiedName: name,
        verifiedIdNumber: idNumber
      });
      setNotice('');
      return { ok: true, token: String(verifyData.verificationToken) };
    } catch (error) {
      const message = error instanceof Error ? error.message : '身份证与姓名不匹配';
      const normalizedMessage = message.includes('请输入正确的身份证号')
        ? '请输入正确的身份证号'
        : message.includes('验证过于频繁')
          ? '验证过于频繁，请稍后再试'
          : '身份证与姓名不匹配';
      setState({
        ...initialIdVerifyState,
        status: 'failed',
        message: normalizedMessage
      });
      return { ok: false, message: normalizedMessage };
    }
  };

  const updateProofPreview = (id: string, patch: Partial<ProofPreview>) => {
    setProofPreviews((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch } : item))
    );
  };

  const uploadProofFile = async (id: string, file: File) => {
    updateProofPreview(id, { status: 'uploading', progress: 0, error: '', ossUrl: '' });

    try {
      let csrfToken = await fetchCsrfToken();
      let policy: OssPolicy;
      try {
        policy = await createOssPolicy(file, csrfToken);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.startsWith('oss_policy_failed:403')) {
          throw error;
        }
        csrfTokenCacheRef.current = { token: '', expiresAt: 0 };
        csrfToken = await fetchCsrfToken(true);
        policy = await createOssPolicy(file, csrfToken);
      }
      const ossUrl = await uploadFileToOss(
        file,
        policy,
        (loadedBytes) => {
          const progress = Math.max(1, Math.min(99, Math.round((loadedBytes / Math.max(1, file.size)) * 100)));
          updateProofPreview(id, { status: 'uploading', progress });
        },
        (xhr) => {
          proofUploadXhrsRef.current.set(id, xhr);
        }
      );

      proofUploadXhrsRef.current.delete(id);
      setProofPreviews((prev) =>
        prev.map((item) =>
          item.id === id
            ? {
                ...item,
                status: 'success',
                progress: 100,
                ossUrl,
                error: ''
              }
            : item
        )
      );
      return ossUrl;
    } catch (error) {
      proofUploadXhrsRef.current.delete(id);
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('aborted')) {
        updateProofPreview(id, { status: 'pending', progress: 0 });
        throw new Error('oss_upload_aborted');
      }

      setProofPreviews((prev) =>
        prev.map((item) =>
          item.id === id
            ? {
                ...item,
                status: 'error',
                progress: 0,
                ossUrl: '',
                error: formatUploadError(message)
              }
            : item
        )
      );
      throw new Error(message);
    }
  };

  const uploadProofFilesBeforeSubmit = async () => {
    const urlById = new Map<string, string>();
    for (const item of proofPreviews) {
      if (item.status === 'success' && item.ossUrl) {
        urlById.set(item.id, item.ossUrl);
      }
    }

    const fileById = new Map<string, File>();
    for (const file of proofUploadsRef.current) {
      fileById.set(proofFileKey(file), file);
    }

    const toUpload = proofPreviews
      .filter((item) => !(item.status === 'success' && item.ossUrl))
      .map((item) => ({ id: item.id, file: fileById.get(item.id) }))
      .filter((item): item is { id: string; file: File } => Boolean(item.file));

    if (toUpload.length === 0) {
      return proofPreviews
        .map((item) => urlById.get(item.id))
        .filter((value): value is string => Boolean(value));
    }

    let cursor = 0;
    const workerCount = Math.max(1, Math.min(MAX_PROOF_UPLOAD_CONCURRENCY, toUpload.length));
    const workers = Array.from({ length: workerCount }, async () => {
      while (cursor < toUpload.length) {
        const idx = cursor;
        cursor += 1;
        const { id, file } = toUpload[idx];
        const url = await uploadProofFile(id, file);
        urlById.set(id, url);
      }
    });

    try {
      await Promise.all(workers);
    } catch (error) {
      // Abort other in-flight uploads ASAP to reduce wasted bandwidth.
      proofUploadXhrsRef.current.forEach((xhr) => {
        try {
          xhr.abort();
        } catch {
          // Ignore abort failures.
        }
      });
      proofUploadXhrsRef.current.clear();
      throw error;
    }

    return proofPreviews
      .map((item) => urlById.get(item.id))
      .filter((value): value is string => Boolean(value));
  };

  const handleIdentitySelect = (next: Exclude<Identity, ''>) => {
    if (switchTimerRef.current) {
      window.clearTimeout(switchTimerRef.current);
    }

    if (next !== 'industry') {
      clearProofFiles();
    }

    setIdentity(next);
    setPage('form');
    setNotice('');
    setSubmitAttempted(false);
    setTouched({});
    setIsSwitching(true);
    switchTimerRef.current = window.setTimeout(() => {
      setIsSwitching(false);
    }, 420);
  };

  const handleBackToIdentity = () => {
    if (switchTimerRef.current) {
      window.clearTimeout(switchTimerRef.current);
    }

    clearProofFiles();

    setPage('identity');
    setSubmittedRole(null);
    setQrDialogOpen(false);
    setNotice('');
    setSubmitAttempted(false);
    setTouched({});
    setIsSwitching(false);
  };

  const handleBackFromSubmitted = () => {
    if (switchTimerRef.current) {
      window.clearTimeout(switchTimerRef.current);
    }
    setPage('identity');
    setSubmittedRole(null);
    setNotice('');
    setSubmitAttempted(false);
    setTouched({});
    setIsSwitching(false);
  };

  const addProofFiles = (files: FileList | File[] | null) => {
    const selected = Array.isArray(files) ? files : Array.from(files || []);

    if (proofInputRef.current) {
      // Allow selecting the same file again after removing it.
      proofInputRef.current.value = '';
    }

    if (selected.length === 0) return;

    const existingKeys = new Set(proofUploadsRef.current.map((file) => proofFileKey(file)));
    const nextUploads = [...proofUploadsRef.current];
    const nextPreviews: ProofPreview[] = [];

    for (const file of selected) {
      const id = proofFileKey(file);
      if (existingKeys.has(id)) continue;
      existingKeys.add(id);
      nextUploads.push(file);

      let previewUrl: string | undefined;
      try {
        previewUrl = URL.createObjectURL(file);
        proofPreviewUrlsRef.current.push(previewUrl);
      } catch {
        previewUrl = undefined;
      }

      nextPreviews.push({
        id,
        name: file.name,
        size: file.size,
        type: file.type || (isPdfFile(file) ? 'application/pdf' : 'application/octet-stream'),
        previewUrl,
        status: 'pending',
        progress: 0,
        ossUrl: ''
      });
    }

    if (nextPreviews.length === 0) return;

    proofUploadsRef.current = nextUploads;
    setIndustryForm((prev) => ({ ...prev, proofFiles: nextUploads.map((file) => file.name) }));
    setProofPreviews((prev) => [...prev, ...nextPreviews]);
    markTouched(fieldKey('industry', 'proofFiles'));
  };

  const removeProofFile = (id: string) => {
    const active = proofUploadXhrsRef.current.get(id);
    if (active) {
      try {
        active.abort();
      } catch {
        // Ignore abort failures.
      }
      proofUploadXhrsRef.current.delete(id);
    }

    const nextUploads = proofUploadsRef.current.filter((file) => proofFileKey(file) !== id);
    proofUploadsRef.current = nextUploads;
    setIndustryForm((prev) => ({ ...prev, proofFiles: nextUploads.map((file) => file.name) }));
    setProofPreviews((prev) => {
      const removed = prev.find((item) => item.id === id);
      if (removed?.previewUrl) {
        try {
          URL.revokeObjectURL(removed.previewUrl);
        } catch {
          // Ignore revoke failures.
        }
        proofPreviewUrlsRef.current = proofPreviewUrlsRef.current.filter((url) => url !== removed.previewUrl);
      }
      return prev.filter((item) => item.id !== id);
    });
    markTouched(fieldKey('industry', 'proofFiles'));
  };

  const downloadProofFile = (preview: ProofPreview) => {
    if (!preview.previewUrl) return;
    const link = document.createElement('a');
    link.href = preview.previewUrl;
    link.download = preview.name || 'attachment';
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const submit = useThrottleCallback(async () => {
    if (isSubmitting) return;
    if (!identity) {
      setNotice('请选择观展身份');
      return;
    }

    setSubmitAttempted(true);

    if (hasFieldError) {
      setNotice('请先修正表单错误');
      requestAnimationFrame(() => {
        const firstError = document.querySelector('.fs-field .error');
        if (firstError) {
          firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
      return;
    }

    if (!ticketPolicyAccepted) {
      setNotice('请先阅读并同意《FBIF2026 购票及参会协议》');
      requestAnimationFrame(() => {
        const policyRow = document.querySelector('.submit-policy-row');
        if (policyRow) {
          policyRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
      return;
    }

    let idVerifyTokenForSubmit = identity === 'industry' ? industryIdVerify.token : consumerIdVerify.token;
    if (needsIdVerify) {
      const currentName = (identity === 'industry' ? industryForm.name : consumerForm.name).trim();
      let verifiedToken = idVerifyTokenForSubmit;
      const canReuseVerifiedToken = Boolean(
        activeIdVerifyState.status === 'passed' &&
        verifiedToken &&
        activeIdVerifyState.verifiedName === currentName &&
        activeIdVerifyState.verifiedIdNumber === currentIdNumber
      );

      if (!canReuseVerifiedToken) {
        const verifyResult = await verifyCnIdFor(identity);
        if (!verifyResult.ok) {
          setNotice(verifyResult.message || '身份证与姓名不匹配');
          return;
        }
        verifiedToken = String(verifyResult.token || '').trim();
        if (!verifiedToken) {
          setNotice('身份证与姓名不匹配');
          return;
        }
      }

      if (identity === 'industry') {
        setIndustryIdVerify((prev) => ({ ...prev, token: verifiedToken }));
      } else {
        setConsumerIdVerify((prev) => ({ ...prev, token: verifiedToken }));
      }
      idVerifyTokenForSubmit = verifiedToken;
    }

    setNotice('');
    setIsSubmitting(true);
    setSubmitDialog((prev) => ({
      ...prev,
      open: true,
      status: 'submitting',
      submissionId: '',
      traceId: ''
    }));

    try {
      let csrfToken = await fetchCsrfToken();

      const payload =
        identity === 'industry'
          ? {
              clientRequestId,
              phone: composeInternationalPhone(industryForm.phoneCountryCode, industryForm.phone),
              name: industryForm.name.trim(),
              title: industryForm.title.trim(),
              company: industryForm.company.trim(),
              idNumber: industryForm.idNumber.trim().toUpperCase(),
              role: 'industry' as const,
              idType: industryForm.idType,
              businessType: industryForm.businessType,
              department: industryForm.department,
              idVerifyToken: industryForm.idType === 'cn_id'
                ? (String(idVerifyTokenForSubmit || '').trim() || undefined)
                : undefined,
              proofUrls: [] as string[]
            }
          : {
              clientRequestId,
              phone: composeInternationalPhone(consumerForm.phoneCountryCode, consumerForm.phone),
              name: consumerForm.name.trim(),
              title: '消费者',
              company: '个人消费者',
              idNumber: consumerForm.idNumber.trim().toUpperCase(),
              role: 'consumer' as const,
              idType: consumerForm.idType,
              idVerifyToken: consumerForm.idType === 'cn_id'
                ? (String(idVerifyTokenForSubmit || '').trim() || undefined)
                : undefined
            };

      if (identity === 'industry') {
        // Upload attachments only when user clicks submit.
        const urls = await uploadProofFilesBeforeSubmit();
        if (urls.length === 0) {
          throw new Error('proof_upload_failed');
        }
        payload.proofUrls = urls;
      }

      let submitData: any = null;
      let accepted = false;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const resp = await fetch(apiUrl('/api/submissions'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken
          },
          credentials: 'include',
          body: JSON.stringify(payload)
        });
        submitData = await parseJsonIfPossible(resp);

        if (resp.ok && submitData?.id) {
          accepted = true;
          break;
        }

        // Token may be stale if cookie rotated. Refresh token once and retry.
        if (resp.status === 403 && attempt === 0) {
          csrfTokenCacheRef.current = { token: '', expiresAt: 0 };
          csrfToken = await fetchCsrfToken(true);
          continue;
        }

        const errMsg = String(
          submitData?.message ||
            submitData?.details?.fieldErrors?.idVerifyToken?.[0] ||
            submitData?.error ||
            ''
        ).trim();
        throw new Error(errMsg ? `submit_failed:${errMsg}` : 'submit_failed');
      }

      if (!accepted || !submitData?.id) {
        throw new Error('submit_failed');
      }

      setSubmittedRole(identity);
      setPage('submitted');
      setSubmitDialog((prev) => ({
        ...prev,
        open: false,
        status: 'submitting',
        submissionId: String(submitData.id || ''),
        traceId: String(submitData.traceId || '')
      }));

      setIndustryForm(initialIndustryForm);
      setConsumerForm(initialConsumerForm);
      setIndustryIdVerify(initialIdVerifyState);
      setConsumerIdVerify(initialIdVerifyState);
      const nextClientRequestId = createClientRequestId();
      setClientRequestId(nextClientRequestId);
      clearProofFiles();
      setTouched({});
      setSubmitAttempted(false);
      setTicketPolicyAccepted(false);
      setNotice('');
      try {
        window.localStorage.setItem(
          FORM_DRAFT_KEY,
          JSON.stringify({
            clientRequestId: nextClientRequestId,
            identity,
            industryForm: initialIndustryForm,
            consumerForm: initialConsumerForm
          })
        );
      } catch {
        // Ignore temporary storage write failure.
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const submitErrorMessage = message.startsWith('submit_failed:')
        ? message.slice('submit_failed:'.length).trim()
        : '';
      if (
        identity === 'industry' &&
        (message === 'proof_upload_failed' ||
          message === 'csrf_failed' ||
          message.startsWith('oss_policy_failed') ||
          message.startsWith('oss_upload_') ||
          message.startsWith('oss_upload_failed'))
      ) {
        setNotice('有附件转换失败，请删除失败的附件后重试');
      } else if (submitErrorMessage.includes('年龄过小')) {
        setNotice('');
        showToast('年龄过小');
      } else if (submitErrorMessage.includes('年龄过大')) {
        setNotice('');
        showToast('年龄过大');
      } else if (
        submitErrorMessage.includes('身份证实名验证') ||
        submitErrorMessage.includes('姓名与身份证') ||
        submitErrorMessage.includes('身份证与姓名')
      ) {
        setNotice('身份证与姓名不匹配');
      } else {
        setNotice('提交失败，请稍后重试');
      }
      setSubmitDialog((prev) => ({
        ...prev,
        open: true,
        status: 'error'
      }));
    } finally {
      setIsSubmitting(false);
    }
  }, 1500);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit();
  };

  const identityLabel = identity === 'industry' ? '专业观众注册' : '消费者注册';
  const identityAgeNotice =
    identity === 'industry'
      ? '16岁以下观众禁止入场，请勿注册！'
      : '16岁以下及50岁以上观众禁止入场，请勿注册！';
  const canCloseSubmitDialog = !(submitDialog.status === 'submitting' && isSubmitting);
  const closeSubmitDialog = () => {
    if (!canCloseSubmitDialog) return;
    setSubmitDialog((prev) => ({ ...prev, open: false }));
  };
  const submitActionBlock = (
    <div className="form-submit-section" role="region" aria-label="提交操作区">
      <div className="submit-dock-inner">
        <div className={`submit-policy-row ${submitAttempted && !ticketPolicyAccepted ? 'is-error' : ''}`}>
          <label className="submit-policy-check">
            <input
              className="submit-policy-input"
              type="checkbox"
              checked={ticketPolicyAccepted}
              onChange={(event) => {
                const checked = event.target.checked;
                setTicketPolicyAccepted(checked);
                if (checked && notice.includes('购票及参会协议')) {
                  setNotice('');
                }
              }}
            />
            <span className="submit-policy-indicator" aria-hidden="true" />
            <span className="submit-policy-text">我已阅读并同意</span>
          </label>
          <a
            className="submit-policy-link"
            href="https://tickets.foodtalks.cn/policy/ticket?policyCode=gpxy"
            target="_blank"
            rel="noopener noreferrer"
          >
            《FBIF2026 购票及参会协议》
          </a>
        </div>
        {notice && (
          <p className="notice notice-error submit-dock-notice">{notice}</p>
        )}
        <FeishuButton
          className="submit-button"
          type="submit"
          form="fbif-ticket-form"
          size="lg"
          block
          disabled={!identity || isSubmitting}
        >
          {isSubmitting ? '提交中...' : '领取观展票'}
        </FeishuButton>
      </div>
    </div>
  );

  return (
    <div
      className={`page ${page === 'submitted' ? 'page-submitted' : ''} ${identity ? `page-${identity}` : ''}`}
    >
      <div className="frame">
        {page !== 'submitted' && (
          <img className="banner" src={TOP_BANNER_URL} alt="FBIF 食品创新展" />
        )}

        {page === 'identity' && (
          <>
            <FeishuCard className="role-card">
              <h2>请选择您的观展身份</h2>
            <p className="tips">
              我们将为您发放对应观展票，权益说明如下：
              <br />
              【专业观众】需审核，通过后发放 2026 年 4 月 27-29 日展区票（3日票）。
              <br />
              【消费者】无需审核，直接发放 2026 年 4 月 29 日展区票（1日票）。
            </p>

            <div className="role-options">
              <button
                type="button"
                className={`role-option ${identity === 'industry' ? 'is-active' : ''}`}
                onClick={() => handleIdentitySelect('industry')}
                aria-pressed={identity === 'industry'}
                aria-label="专业观众注册"
              >
                <span className="role-icon" aria-hidden="true">
                  <IndustryCardIcon />
                </span>
                <span className="role-content">
                  <span className="role-title">专业观众注册</span>
                  <span className="role-desc">需审核身份，通过后发放3日展区票</span>
                </span>
              </button>
              <button
                type="button"
                className={`role-option ${identity === 'consumer' ? 'is-active' : ''}`}
                onClick={() => handleIdentitySelect('consumer')}
                aria-pressed={identity === 'consumer'}
                aria-label="消费者注册"
              >
                <span className="role-icon" aria-hidden="true">
                  <ConsumerCardIcon />
                </span>
                <span className="role-content">
                  <span className="role-title">消费者注册</span>
                  <span className="role-desc">无需审核，直接发放 1 日展区票</span>
                </span>
              </button>
            </div>
            </FeishuCard>
          </>
        )}

        {page === 'form' && (
          <>
            <FeishuCard className="stage-head">
              <FeishuButton
                type="button"
                className="stage-back"
                variant="text"
                icon={<ChevronLeftSmallIcon />}
                aria-label="返回选择身份"
                onClick={handleBackToIdentity}
              />
              <div className="stage-current-group" aria-live="polite">
                <p className="stage-current stage-current-centered">
                  <span className="stage-current-value">{identityLabel}</span>
                </p>
              </div>
            </FeishuCard>

            <p className="age-notice-bar">{identityAgeNotice}</p>

            <FeishuCard
              className={`form-shell ${isSwitching ? 'form-shell-reveal' : ''}`}
              aria-live="polite"
            >
              {identity === 'industry' && (
                <form className="dynamic-form" id="fbif-ticket-form" onSubmit={onSubmit}>
                  <div className="form-page-layout industry-layout">
                    <section className="form-section-card section-personal" aria-labelledby="section-personal-title">
                      <div className="form-section-head">
                        <span className="form-section-icon" aria-hidden="true"><SectionPersonIcon /></span>
                        <h3 className="form-section-title" id="section-personal-title">个人信息</h3>
                      </div>
                  <FeishuField
                    label="姓名"
                    htmlFor="industry-name"
                    required
                    error={shouldShowError(fieldKey('industry', 'name')) ? industryErrors.name : ''}
                  >
                    <FeishuInput
                      id="industry-name"
                      type="text"
                      autoComplete="name"
                      placeholder="请输入姓名"
                      value={industryForm.name}
                      status={shouldShowError(fieldKey('industry', 'name')) && industryErrors.name ? 'error' : 'default'}
                      onChange={handleIndustryChange('name')}
                      onBlur={() => markTouched(fieldKey('industry', 'name'))}
                    />
                  </FeishuField>

                  <FeishuField
                    label="证件类型"
                    htmlFor="industry-idType"
                    required
                    error={shouldShowError(fieldKey('industry', 'idType')) ? industryErrors.idType : ''}
                  >
                    <FeishuSelect
                      id="industry-idType"
                      value={industryForm.idType}
                      status={shouldShowError(fieldKey('industry', 'idType')) && industryErrors.idType ? 'error' : 'default'}
                      onChange={handleIndustryChange('idType')}
                      onBlur={() => markTouched(fieldKey('industry', 'idType'))}
                    >
                      <option value="">请选择证件类型</option>
                      {idTypeOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </FeishuSelect>
                  </FeishuField>

                  <FeishuField
                    label="证件号码"
                    htmlFor="industry-idNumber"
                    required
                    error={shouldShowError(fieldKey('industry', 'idNumber')) ? industryErrors.idNumber : ''}
                  >
                    <FeishuInput
                      id="industry-idNumber"
                      type="text"
                      autoComplete="off"
                      inputMode="text"
                      placeholder="请输入证件号码"
                      value={industryForm.idNumber}
                      status={shouldShowError(fieldKey('industry', 'idNumber')) && industryErrors.idNumber ? 'error' : 'default'}
                      onChange={handleIndustryChange('idNumber')}
                      onBlur={() => markTouched(fieldKey('industry', 'idNumber'))}
                    />
                  </FeishuField>
                  {industryNeedsIdVerify && industryIdVerify.status !== 'idle' && (
                    <div className="field">
                      <div className="id-verify-row">
                        <span
                          className={`id-verify-status ${
                            industryIdVerify.status === 'passed'
                              ? 'is-ok'
                              : industryIdVerify.status === 'failed'
                                ? 'is-error'
                                : ''
                          }`}
                          aria-live="polite"
                        >
                          {industryIdVerify.status === 'passed'
                            ? (industryIdVerify.message || '实名验证通过')
                            : industryIdVerify.status === 'failed'
                              ? (industryIdVerify.message || '身份证与姓名不匹配')
                              : industryIdVerify.status === 'verifying'
                                ? (industryIdVerify.message || '正在验证身份证信息，请稍候...')
                                : ''}
                        </span>
                      </div>
                    </div>
                  )}

                  <FeishuField
                    label="手机号"
                    htmlFor="industry-phone"
                    required
                    error={shouldShowError(fieldKey('industry', 'phone')) ? industryErrors.phone : ''}
                  >
                    <div className="phone-input-row">
                      <FeishuSelect
                        id="industry-phone-countryCode"
                        aria-label="国家区号"
                        className="phone-country-code-select"
                        value={industryForm.phoneCountryCode}
                        onChange={handleIndustryChange('phoneCountryCode')}
                        onBlur={() => markTouched(fieldKey('industry', 'phone'))}
                      >
                        {phoneCountryCodeOptions.map((option) => (
                          <option key={`${option.value}-${option.label}`} value={option.value}>
                            {`${option.label} ${option.code}`}
                          </option>
                        ))}
                      </FeishuSelect>
                      <FeishuInput
                        id="industry-phone"
                        className="phone-number-input"
                        type="tel"
                        autoComplete="tel"
                        inputMode="tel"
                        placeholder="请输入手机号（不含区号）"
                        value={industryForm.phone}
                        status={shouldShowError(fieldKey('industry', 'phone')) && industryErrors.phone ? 'error' : 'default'}
                        onChange={handleIndustryChange('phone')}
                        onBlur={() => markTouched(fieldKey('industry', 'phone'))}
                      />
                    </div>
                  </FeishuField>

                    </section>

                    <section className="form-section-card section-proof" aria-labelledby="section-proof-title">
                      <div className="form-section-head">
                        <span className="form-section-icon" aria-hidden="true"><SectionVerifiedUserIcon /></span>
                        <h3 className="form-section-title" id="section-proof-title">专业观众身份审核</h3>
                      </div>
                  <FeishuField
                    label="上传专业观众证明"
                    htmlFor="industry-proof"
                    required
                    error={shouldShowError(fieldKey('industry', 'proofFiles')) ? industryErrors.proofFiles : ''}
                  >
                    <input
                      id="industry-proof"
                      ref={proofInputRef}
                      className="upload-input"
                      type="file"
                      accept=".jpg,.jpeg,.png,.pdf"
                      multiple
                      onChange={(event) => addProofFiles(event.target.files)}
                      onBlur={() => markTouched(fieldKey('industry', 'proofFiles'))}
                    />
                    <div
                      className={`upload-panel ${proofPreviews.length === 0 ? 'is-empty' : ''} ${isSubmitting ? 'is-disabled' : ''}`}
                      aria-disabled={isSubmitting}
                    >
                      {proofPreviews.length === 0 ? (
                        <button
                          type="button"
                          className="upload-empty-trigger"
                          onClick={() => {
                            if (isSubmitting) return;
                            proofInputRef.current?.click();
                          }}
                          disabled={isSubmitting}
                          aria-label="点击上传文件"
                        >
                          <span className="upload-empty-icon" aria-hidden="true">
                            <CloudUploadRoundIcon />
                          </span>
                          <span className="upload-empty-title">点击上传文件</span>
                          <span className="upload-empty-subtitle">支持 JPG, PNG, PDF (最大 50MB)</span>
                        </button>
                      ) : (
                        <FeishuButton
                          type="button"
                          variant="secondary"
                          className="upload-panel-button"
                          onClick={() => {
                            if (isSubmitting) return;
                            proofInputRef.current?.click();
                          }}
                          disabled={isSubmitting}
                        >
                          添加本地文件
                        </FeishuButton>
                      )}

                      {proofPreviews.length > 0 ? (
                        <ul className="proof-file-list-plain" role="list" aria-label="已选择的证明文件">
                          {proofPreviews.map((file) => {
                            const isUploading = file.status === 'uploading';
                            const isFailed = file.status === 'error';
                            const displayPercent = Math.min(100, Math.max(0, Math.round(file.progress || 0)));
                            const statusText = isUploading
                              ? `上传中 ${displayPercent}%`
                              : isFailed
                                ? (file.error || '上传失败，请重试')
                                : file.status === 'success'
                                  ? '已上传'
                                  : '';

                            return (
                              <li
                                key={file.id}
                                className={`proof-file-row ${isFailed ? 'is-error' : ''}`}
                                role="listitem"
                              >
                                <div className="proof-file-main">
                                  <p className="proof-file-name" title={file.name}>{file.name}</p>
                                  <p className="proof-file-meta">
                                    <span>{formatBytes(file.size)}</span>
                                    {statusText ? (
                                      <span
                                        className={`proof-file-status ${isUploading ? 'is-uploading' : ''} ${isFailed ? 'is-error' : ''}`}
                                      >
                                        {statusText}
                                      </span>
                                    ) : null}
                                  </p>
                                </div>
                                <div className="proof-file-actions">
                                  {file.previewUrl && (
                                    <button
                                      type="button"
                                      className="proof-file-link"
                                      onClick={() => downloadProofFile(file)}
                                      disabled={isSubmitting}
                                    >
                                      下载
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    className="proof-file-remove"
                                    aria-label={`移除 ${file.name}`}
                                    onClick={() => removeProofFile(file.id)}
                                    disabled={isSubmitting}
                                  >
                                    删除
                                  </button>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      ) : null}
                    </div>
                    <div className="proof-guidelines" aria-label="专业观众证明上传说明">
                      <div className="proof-guideline-row">
                        <span className="proof-guideline-row-icon is-accept" aria-hidden="true">
                          <CheckCircleRoundIcon />
                        </span>
                        <div className="proof-guideline-row-content">
                          <p className="proof-guideline-copy">
                            <strong className="proof-guideline-title is-accept">请提交：</strong>
                            能够体现您为食品行业从业人员的证明材料，包含“姓名公司职位”，包括但不限于：名片、工作软件截图（如钉钉、飞书、企微）、工作证、企业邮箱截图等
                            {' '}
                            <a
                              href="https://www.foodtalks.cn/news/55602"
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              查看示例
                            </a>
                          </p>
                        </div>
                      </div>

                      <div className="proof-guideline-row">
                        <span className="proof-guideline-row-icon is-reject" aria-hidden="true">
                          <CancelRoundIcon />
                        </span>
                        <div className="proof-guideline-row-content">
                          <p className="proof-guideline-copy">
                            <strong className="proof-guideline-title is-reject">请勿提交：</strong>
                            证件照片、自拍、形象照、产品图、工厂图、聊天截图等为无效证明，将无法通过审核。
                          </p>
                        </div>
                      </div>

                      <ul className="proof-guideline-meta-list">
                        <li>审核需要 1-3 个工作日，审核通过的出席人员方可入场</li>
                        <li>如有任何问题，请联系工作人员 Carrie（微信：lovelyFBIFer1）</li>
                        <li className="is-warn">如在现场发现为非专业观众，我们有权请您离开现场</li>
                      </ul>
                    </div>
                  </FeishuField>

                    </section>

                    <section className="form-section-card section-work" aria-labelledby="section-work-title">
                      <div className="form-section-head">
                        <span className="form-section-icon" aria-hidden="true"><SectionBusinessIcon /></span>
                        <h3 className="form-section-title" id="section-work-title">职业信息</h3>
                      </div>
                  <FeishuField
                    label="公司"
                    htmlFor="industry-company"
                    required
                    error={shouldShowError(fieldKey('industry', 'company')) ? industryErrors.company : ''}
                  >
                    <FeishuInput
                      id="industry-company"
                      type="text"
                      autoComplete="organization"
                      placeholder="请输入公司名称"
                      value={industryForm.company}
                      status={shouldShowError(fieldKey('industry', 'company')) && industryErrors.company ? 'error' : 'default'}
                      onChange={handleIndustryChange('company')}
                      onBlur={() => markTouched(fieldKey('industry', 'company'))}
                    />
                  </FeishuField>

                  <FeishuField
                    label="职位"
                    htmlFor="industry-title"
                    required
                    error={shouldShowError(fieldKey('industry', 'title')) ? industryErrors.title : ''}
                  >
                    <FeishuInput
                      id="industry-title"
                      type="text"
                      autoComplete="organization-title"
                      placeholder="请输入职位"
                      value={industryForm.title}
                      status={shouldShowError(fieldKey('industry', 'title')) && industryErrors.title ? 'error' : 'default'}
                      onChange={handleIndustryChange('title')}
                      onBlur={() => markTouched(fieldKey('industry', 'title'))}
                    />
                  </FeishuField>

                  <FeishuField
                    label="贵司业务类型"
                    htmlFor="industry-businessType"
                    required
                    error={shouldShowError(fieldKey('industry', 'businessType')) ? industryErrors.businessType : ''}
                  >
                    <FeishuSelect
                      id="industry-businessType"
                      className="compact-select-text"
                      value={industryForm.businessType}
                      status={shouldShowError(fieldKey('industry', 'businessType')) && industryErrors.businessType ? 'error' : 'default'}
                      onChange={handleIndustryChange('businessType')}
                      onBlur={() => markTouched(fieldKey('industry', 'businessType'))}
                    >
                      <option value="">请选择业务类型</option>
                      {industryBusinessOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </FeishuSelect>
                  </FeishuField>

                  <FeishuField
                    label="您所处部门"
                    htmlFor="industry-department"
                    required
                    error={shouldShowError(fieldKey('industry', 'department')) ? industryErrors.department : ''}
                  >
                    <FeishuSelect
                      id="industry-department"
                      className="compact-select-text"
                      value={industryForm.department}
                      status={shouldShowError(fieldKey('industry', 'department')) && industryErrors.department ? 'error' : 'default'}
                      onChange={handleIndustryChange('department')}
                      onBlur={() => markTouched(fieldKey('industry', 'department'))}
                    >
                      <option value="">请选择所在部门</option>
                      {departmentOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </FeishuSelect>
                  </FeishuField>
                    </section>
                  </div>
                  {submitActionBlock}
                </form>
              )}

              {identity === 'consumer' && (
                <form className="dynamic-form" id="fbif-ticket-form" onSubmit={onSubmit}>
                  <div className="form-page-layout consumer-layout">
                    <section className="form-section-card section-personal" aria-labelledby="section-consumer-personal-title">
                      <div className="form-section-head">
                        <span className="form-section-icon" aria-hidden="true"><SectionPersonIcon /></span>
                        <h3 className="form-section-title" id="section-consumer-personal-title">个人信息</h3>
                      </div>
                  <FeishuField
                    label="姓名"
                    htmlFor="consumer-name"
                    required
                    error={shouldShowError(fieldKey('consumer', 'name')) ? consumerErrors.name : ''}
                  >
                    <FeishuInput
                      id="consumer-name"
                      type="text"
                      autoComplete="name"
                      placeholder="请输入姓名"
                      value={consumerForm.name}
                      status={shouldShowError(fieldKey('consumer', 'name')) && consumerErrors.name ? 'error' : 'default'}
                      onChange={handleConsumerChange('name')}
                      onBlur={() => markTouched(fieldKey('consumer', 'name'))}
                    />
                  </FeishuField>

                  <FeishuField
                    label="证件类型"
                    htmlFor="consumer-idType"
                    required
                    error={shouldShowError(fieldKey('consumer', 'idType')) ? consumerErrors.idType : ''}
                  >
                    <FeishuSelect
                      id="consumer-idType"
                      value={consumerForm.idType}
                      status={shouldShowError(fieldKey('consumer', 'idType')) && consumerErrors.idType ? 'error' : 'default'}
                      onChange={handleConsumerChange('idType')}
                      onBlur={() => markTouched(fieldKey('consumer', 'idType'))}
                    >
                      <option value="">请选择证件类型</option>
                      {idTypeOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </FeishuSelect>
                  </FeishuField>

                  <FeishuField
                    label="证件号码"
                    htmlFor="consumer-idNumber"
                    required
                    error={shouldShowError(fieldKey('consumer', 'idNumber')) ? consumerErrors.idNumber : ''}
                  >
                    <FeishuInput
                      id="consumer-idNumber"
                      type="text"
                      autoComplete="off"
                      inputMode="text"
                      placeholder="请输入证件号码"
                      value={consumerForm.idNumber}
                      status={shouldShowError(fieldKey('consumer', 'idNumber')) && consumerErrors.idNumber ? 'error' : 'default'}
                      onChange={handleConsumerChange('idNumber')}
                      onBlur={() => markTouched(fieldKey('consumer', 'idNumber'))}
                    />
                  </FeishuField>
                  {consumerNeedsIdVerify && consumerIdVerify.status !== 'idle' && (
                    <div className="field">
                      <div className="id-verify-row">
                        <span
                          className={`id-verify-status ${
                            consumerIdVerify.status === 'passed'
                              ? 'is-ok'
                              : consumerIdVerify.status === 'failed'
                                ? 'is-error'
                                : ''
                          }`}
                          aria-live="polite"
                        >
                          {consumerIdVerify.status === 'passed'
                            ? (consumerIdVerify.message || '实名验证通过')
                            : consumerIdVerify.status === 'failed'
                              ? (consumerIdVerify.message || '身份证与姓名不匹配')
                              : consumerIdVerify.status === 'verifying'
                                ? (consumerIdVerify.message || '正在验证身份证信息，请稍候...')
                                : ''}
                        </span>
                      </div>
                    </div>
                  )}

                  <FeishuField
                    label="手机号"
                    htmlFor="consumer-phone"
                    required
                    error={shouldShowError(fieldKey('consumer', 'phone')) ? consumerErrors.phone : ''}
                  >
                    <div className="phone-input-row">
                      <FeishuSelect
                        id="consumer-phone-countryCode"
                        aria-label="国家区号"
                        className="phone-country-code-select"
                        value={consumerForm.phoneCountryCode}
                        onChange={handleConsumerChange('phoneCountryCode')}
                        onBlur={() => markTouched(fieldKey('consumer', 'phone'))}
                      >
                        {phoneCountryCodeOptions.map((option) => (
                          <option key={`${option.value}-${option.label}`} value={option.value}>
                            {`${option.label} ${option.code}`}
                          </option>
                        ))}
                      </FeishuSelect>
                      <FeishuInput
                        id="consumer-phone"
                        className="phone-number-input"
                        type="tel"
                        autoComplete="tel"
                        inputMode="tel"
                        placeholder="请输入手机号（不含区号）"
                        value={consumerForm.phone}
                        status={shouldShowError(fieldKey('consumer', 'phone')) && consumerErrors.phone ? 'error' : 'default'}
                        onChange={handleConsumerChange('phone')}
                        onBlur={() => markTouched(fieldKey('consumer', 'phone'))}
                      />
                    </div>
                  </FeishuField>
                    </section>
                  </div>
                  {submitActionBlock}
                </form>
              )}
            </FeishuCard>
          </>
        )}

        {page === 'submitted' && (
          <>
            <img className="banner" src={TOP_BANNER_URL} alt="FBIF 食品创新展" />

            <FeishuCard className="success-card">
              <div className="success-hero">
                <div className="success-hero-icon">
                  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <h2 className="success-hero-title">
                  {submittedRole === 'consumer' ? '报名成功' : '申请已提交'}
                </h2>
                <p className="success-hero-desc">
                  {submittedRole === 'consumer'
                    ? 'FBIF 食品创新展 2026 消费者观展票'
                    : 'FBIF 食品创新展 2026 专业观众观展票'}
                </p>
              </div>

              <div className="success-steps">
                {submittedRole === 'industry' ? (
                  <>
                    <div className="success-step">
                      <div className="success-step-num">1</div>
                      <div className="success-step-body">
                        <h3>等待审核</h3>
                        <p>审核结果将在 <strong>1-3 个工作日</strong> 内通过短信通知</p>
                      </div>
                    </div>
                    <div className="success-step">
                      <div className="success-step-num">2</div>
                      <div className="success-step-body">
                        <h3>获取门票</h3>
                        <p>审核通过后，电子门票将于展前 3 天通过短信/邮件发放</p>
                      </div>
                    </div>
                    <div className="success-step">
                      <div className="success-step-num">3</div>
                      <div className="success-step-body">
                        <h3>入场观展</h3>
                        <p>凭 <strong>大陆身份证原件 + 电子门票</strong> 免签到入场</p>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="success-step">
                      <div className="success-step-num">1</div>
                      <div className="success-step-body">
                        <h3>获取门票</h3>
                        <p>电子门票将于展前 3 天通过短信/邮件统一发放</p>
                      </div>
                    </div>
                    <div className="success-step">
                      <div className="success-step-num">2</div>
                      <div className="success-step-body">
                        <h3>入场观展</h3>
                        <p>凭 <strong>大陆身份证原件 + 电子门票</strong>，于 <strong>4 月 29 日</strong> 入场观展（不含论坛）</p>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {submittedRole === 'industry' && (
                <div className="success-query-link">
                  <a
                    href="https://foodtalks.feishu.cn/share/base/query/shrcn8O5GMUDVRBMIGBQfWHZeGb?from=navigation"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    查询审核结果
                    <OpenInNewSmallIcon />
                  </a>
                </div>
              )}

              <div className="success-contact">
                <SupportAgentRoundIcon />
                <span>如有疑问，请联系 FBIF 工作人员 Carrie</span>
                <code>lovelyFBIFer1</code>
                <button type="button" className="success-qr-btn" onClick={() => setQrDialogOpen(true)}>
                  <QrCodeSmallIcon />
                  二维码
                </button>
              </div>
            </FeishuCard>

            <a
              className="success-cta"
              href="https://www.foodtalks.cn/news/57680"
              target="_blank"
              rel="noopener noreferrer"
            >
              查看展会介绍
              <OpenInNewSmallIcon />
            </a>
          </>
        )}
      </div>

      <footer className="legal-footer" aria-label="网站备案信息">
        <div className="legal-footer-bar">
          <p className="legal-footer-copy">© Copyright 2026 Simba. All rights reserved. 上海辛巴商务咨询有限公司 版权所有</p>
          <p className="legal-footer-copy legal-footer-icp">沪ICP备19035501号-1</p>
        </div>
      </footer>

      <FeishuDialog
        open={qrDialogOpen}
        title="工作人员微信二维码"
        ariaLabel="工作人员微信二维码"
        className="submit-qr-dialog"
        onClose={() => setQrDialogOpen(false)}
        closeOnEsc
        closeOnMask
        body={
          <div className="submit-qr-dialog-body">
            <img className="submit-qr-dialog-image" src={CARRIE_WECHAT_QR_URL} alt="FBIF 工作人员 Carrie 微信二维码" />
            <p className="submit-qr-dialog-caption">Carrie（微信：lovelyFBIFer1）</p>
          </div>
        }
        footer={
          <FeishuButton type="button" className="modal-button" onClick={() => setQrDialogOpen(false)}>
            关闭
          </FeishuButton>
        }
      />

      <FeishuDialog
        open={submitDialog.open}
        title={
          submitDialog.status === 'submitting'
            ? '正在提交'
            : submitDialog.status === 'success'
              ? '提交成功'
              : '提交失败'
        }
        ariaLabel="提交状态"
        className={
          submitDialog.status === 'success'
            ? 'is-success'
            : submitDialog.status === 'error'
              ? 'is-error'
              : 'is-submitting'
        }
        onClose={canCloseSubmitDialog ? closeSubmitDialog : undefined}
        closeOnEsc={canCloseSubmitDialog}
        closeOnMask={false}
        body={
          <>
            {submitDialog.status === 'submitting' && (
              <div className="modal-loading-wrap">
                <FeishuLoading size="md" text="正在提交，请稍候" />
                {identity === 'industry' && proofPreviews.length > 0 ? (
                  <p className="modal-body-copy">
                    正在上传附件（
                    {proofPreviews.filter((item) => item.status === 'success').length}/{proofPreviews.length}
                    ，
                    {Math.round(
                      proofPreviews.reduce((sum, item) => {
                        if (item.status === 'success') return sum + 100;
                        if (item.status === 'uploading') return sum + Math.max(0, Math.min(99, item.progress || 0));
                        return sum;
                      }, 0) / Math.max(1, proofPreviews.length)
                    )}
                    %），请勿关闭页面。
                  </p>
                ) : (
                  <p className="modal-body-copy">我们正在接收您的信息，请勿关闭页面。</p>
                )}
              </div>
            )}
            {submitDialog.status === 'success' && (
              <>
                <div className="modal-success-icon" aria-hidden="true">
                  <span>✓</span>
                </div>
                <p className="modal-body-copy">
                  {identity === 'industry' ? '您已提交成功，专业观众将进入人工审核流程（1-3个工作日）。' : '您已提交成功。'}
                  <br />
                  【入场方式】凭大陆身份证原件+电子门票免签到入场（电子门票会在展前3天通过短信/邮件统一发放）
                </p>
              </>
            )}
            {submitDialog.status === 'error' && (
              <p className="modal-body-copy">请稍后重试。如持续失败，请联系工作人员。</p>
            )}
          </>
        }
        footer={
          <FeishuButton
            className="modal-button"
            type="button"
            variant={submitDialog.status === 'submitting' ? 'secondary' : 'primary'}
            onClick={closeSubmitDialog}
            disabled={!canCloseSubmitDialog}
          >
            {submitDialog.status === 'submitting' ? '隐藏' : '确定'}
          </FeishuButton>
        }
      />

      {toast.open && (
        <div className="toast" role="status" aria-live="assertive">
          {toast.message}
        </div>
      )}
    </div>
  );
}
