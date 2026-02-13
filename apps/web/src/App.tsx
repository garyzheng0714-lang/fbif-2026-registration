import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent, FormEvent, KeyboardEvent } from 'react';
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
  validateChineseId,
  validatePhone,
  validateRequired
} from './utils/validation';

function defaultApiBase() {
  // In production we usually host web on :3001 and API on :8080 on the same hostname.
  // This runtime fallback prevents "localhost" mistakes when VITE_API_URL is not set at build time.
  if (typeof window !== 'undefined' && window.location) {
    const protocol = window.location.protocol || 'http:';
    const hostname = window.location.hostname || 'localhost';
    return `${protocol}//${hostname}:8080`;
  }
  return 'http://localhost:8080';
}

const API_BASE = import.meta.env.VITE_API_URL || defaultApiBase();
const FORM_DRAFT_KEY = 'fbif_form_draft_v2';
const TOP_BANNER_URL =
  'https://fbif-feishu-base.oss-cn-shanghai.aliyuncs.com/fbif-attachment-to-url/2026/02/tblMQeXvSGd7Hebf_YHcyINOqnzM9YxjJToK2RA_1770366619961/img_v3_02ul_3790aefe-c6b6-473f-9c05-97aa380983bg_1770366621905.jpg';
const MAX_PROOF_UPLOAD_CONCURRENCY = 3;

type Identity = '' | 'industry' | 'consumer';
type IdType = '' | 'cn_id' | 'passport' | 'other';

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
  '食品相关品牌方',
  '食品制造商',
  '供应链服务商',
  '咨询/营销/服务机构',
  '线下零售',
  '线上零售',
  '新兴渠道',
  '进出口贸易',
  '餐饮及酒店',
  '其他'
] as const;

const departmentOptions = [
  '高管/战略',
  '研发/生产/品控',
  '采购/物流/仓储',
  '采购/市场/生产',
  '市场/销售/电商',
  '行政',
  '其他'
] as const;

const idTypeOptions = [
  { value: 'cn_id', label: '身份证' },
  { value: 'passport', label: '护照' },
  { value: 'other', label: '其他证件' }
] as const;

const initialIndustryForm = {
  name: '',
  idType: '' as IdType,
  idNumber: '',
  phone: '',
  company: '',
  title: '',
  businessType: '',
  department: '',
  proofFiles: [] as string[]
};

const initialConsumerForm = {
  name: '',
  idType: '' as IdType,
  idNumber: '',
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
  const resp = await fetch(`${API_BASE}/api/oss/policy`, {
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

function validateIdNumber(idType: IdType, idNumber: string) {
  const normalized = idNumber.trim();
  if (!idType) return '请选择证件类型';
  if (!normalized) return '请输入证件号码';
  if (idType === 'cn_id') {
    const idError = validateChineseId(normalized);
    return idError ? '请输入正确的身份证号' : '';
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
  if (age < 16) {
    return { ok: false as const, message: '年龄过小' };
  }
  if (role === 'consumer' && age > 50) {
    return { ok: false as const, message: '年龄过大' };
  }
  if (role === 'industry' && age > 99) {
    return { ok: false as const, message: '年龄过大' };
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

export default function App() {
  const [page, setPage] = useState<'identity' | 'form'>('identity');
  const [identity, setIdentity] = useState<Identity>('');
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
  const [isProofDragOver, setIsProofDragOver] = useState(false);
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
        setIndustryForm((prev) => ({ ...prev, ...rest, proofFiles: [] }));
      }
      if (parsed.consumerForm) {
        setConsumerForm((prev) => ({ ...prev, ...parsed.consumerForm }));
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
      idNumber: validateIdNumber(industryForm.idType, industryForm.idNumber),
      phone: validatePhone(industryForm.phone),
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
      idNumber: validateIdNumber(consumerForm.idType, consumerForm.idNumber),
      phone: validatePhone(consumerForm.phone)
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
      const csrfResp = await fetch(`${API_BASE}/api/csrf`, {
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
        const resp = await fetch(`${API_BASE}/api/id-verify`, {
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
        throw new Error(message || '身份证与姓名不匹配');
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
    setIsProofDragOver(false);
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
    setNotice('');
    setSubmitAttempted(false);
    setTouched({});
    setIsProofDragOver(false);
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

  const handleProofDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsProofDragOver(false);
    if (isSubmitting) return;
    addProofFiles(event.dataTransfer.files);
  };

  const handleProofZoneKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      proofInputRef.current?.click();
    }
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
      return;
    }

    const role = identity === 'industry' ? 'industry' : 'consumer';
    const currentIdType = identity === 'industry' ? industryForm.idType : consumerForm.idType;
    const currentIdNumber = (identity === 'industry' ? industryForm.idNumber : consumerForm.idNumber).trim().toUpperCase();
    const ageLimitCheck = checkAgeLimit(role, currentIdType, currentIdNumber);
    if (!ageLimitCheck.ok) {
      setNotice('');
      showToast(ageLimitCheck.message);
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
        const verifyResult = await verifyCnIdFor(role);
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
              phone: industryForm.phone.trim(),
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
              phone: consumerForm.phone.trim(),
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
        const resp = await fetch(`${API_BASE}/api/submissions`, {
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

      setSubmitDialog((prev) => ({
        ...prev,
        open: true,
        status: 'success',
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

  const identityLabel = identity === 'industry' ? '食品行业相关从业者' : '消费者';
  const canCloseSubmitDialog = !(submitDialog.status === 'submitting' && isSubmitting);
  const closeSubmitDialog = () => {
    if (!canCloseSubmitDialog) return;
    setSubmitDialog((prev) => ({ ...prev, open: false }));
  };

  return (
    <div className="page">
      <div className="frame">
        <img className="banner" src={TOP_BANNER_URL} alt="FBIF 食品创新展" />

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
                aria-label="我是食品行业相关从业者"
              >
                <span className="role-icon" aria-hidden="true">
                  <IndustryCardIcon />
                </span>
                <span className="role-content">
                  <span className="role-title">我是食品行业相关从业者</span>
                  <span className="role-desc">提交专业材料并审核后发放 3 日展区票</span>
                </span>
              </button>
              <button
                type="button"
                className={`role-option ${identity === 'consumer' ? 'is-active' : ''}`}
                onClick={() => handleIdentitySelect('consumer')}
                aria-pressed={identity === 'consumer'}
                aria-label="我是消费者"
              >
                <span className="role-icon" aria-hidden="true">
                  <ConsumerCardIcon />
                </span>
                <span className="role-content">
                  <span className="role-title">我是消费者</span>
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
              <FeishuButton type="button" className="stage-back" variant="text" onClick={handleBackToIdentity}>
                {'< 返回选择身份'}
              </FeishuButton>
              <p className="stage-current stage-current-centered" aria-live="polite">
                <span className="stage-current-value">{identityLabel}</span>
              </p>
            </FeishuCard>

            <FeishuCard
              className={`form-shell ${isSwitching ? 'form-shell-reveal' : ''}`}
              aria-live="polite"
            >
              {identity === 'industry' && (
                <form className="dynamic-form" id="fbif-ticket-form" onSubmit={onSubmit}>
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
                      {industryIdVerify.status === 'failed' && <span className="error">{industryIdVerify.message}</span>}
                    </div>
                  )}

                  <FeishuField
                    label="手机号"
                    htmlFor="industry-phone"
                    required
                    error={shouldShowError(fieldKey('industry', 'phone')) ? industryErrors.phone : ''}
                  >
                    <FeishuInput
                      id="industry-phone"
                      type="tel"
                      autoComplete="tel"
                      inputMode="numeric"
                      placeholder="请输入手机号"
                      value={industryForm.phone}
                      status={shouldShowError(fieldKey('industry', 'phone')) && industryErrors.phone ? 'error' : 'default'}
                      onChange={handleIndustryChange('phone')}
                      onBlur={() => markTouched(fieldKey('industry', 'phone'))}
                    />
                  </FeishuField>

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
                      className={`upload-zone ${isProofDragOver ? 'is-drag-over' : ''} ${proofPreviews.length ? 'has-files' : ''} ${isSubmitting ? 'is-disabled' : ''}`}
                      role="button"
                      tabIndex={isSubmitting ? -1 : 0}
                      aria-label="上传专业观众证明文件"
                      aria-disabled={isSubmitting}
                      onClick={() => {
                        if (isSubmitting) return;
                        proofInputRef.current?.click();
                      }}
                      onKeyDown={(event) => {
                        if (isSubmitting) return;
                        handleProofZoneKeyDown(event);
                      }}
                      onPaste={(event) => {
                        if (isSubmitting) return;
                        const items = event.clipboardData?.items;
                        if (!items) return;
                        const files = Array.from(items)
                          .map((item) => (item.kind === 'file' ? item.getAsFile() : null))
                          .filter(Boolean) as File[];
                        if (files.length === 0) return;
                        event.preventDefault();
                        addProofFiles(files);
                      }}
                      onDragOver={(event) => {
                        event.preventDefault();
                        if (isSubmitting) return;
                        setIsProofDragOver(true);
                      }}
                      onDragEnter={(event) => {
                        event.preventDefault();
                        if (isSubmitting) return;
                        setIsProofDragOver(true);
                      }}
                      onDragLeave={(event) => {
                        event.preventDefault();
                        setIsProofDragOver(false);
                      }}
                      onDrop={handleProofDrop}
                    >
                      <div className="upload-zone-content">
                        {proofPreviews.length === 0 ? (
                          <div className="upload-empty">
                            <div className="upload-drop-surface">粘贴或拖拽至这里上传</div>
                            <FeishuButton
                              type="button"
                              className="upload-add-button"
                              variant="text"
                              icon={<span className="upload-add-plus" aria-hidden="true">+</span>}
                              onClick={(event) => {
                                event.stopPropagation();
                                if (isSubmitting) return;
                                proofInputRef.current?.click();
                              }}
                              disabled={isSubmitting}
                            >
                              添加本地文件
                            </FeishuButton>
                          </div>
                        ) : (
                          <>
                            <div className="proof-card-list" role="list" aria-label="已选择的证明文件">
                              {proofPreviews.map((file) => {
                                const isUploading = file.status === 'uploading';
                                const isFailed = file.status === 'error';
                                const displayPercent = Math.min(100, Math.max(0, Math.round(file.progress || 0)));
                                const isImage = (file.type || '').toLowerCase().startsWith('image/');
                                const isPdf =
                                  (file.type || '').toLowerCase() === 'application/pdf' ||
                                  file.name.toLowerCase().endsWith('.pdf');

                                return (
                                  <div
                                    key={file.id}
                                    className={`proof-card ${isUploading ? 'is-uploading' : ''} ${isFailed ? 'is-error' : ''}`}
                                    role="listitem"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      if (!file.previewUrl) return;
                                      window.open(file.previewUrl, '_blank', 'noopener');
                                    }}
                                  >
                                    <button
                                      type="button"
                                      className="proof-card-remove"
                                      aria-label={`移除 ${file.name}`}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        removeProofFile(file.id);
                                      }}
                                      disabled={isSubmitting}
                                    >
                                      ×
                                    </button>

                                    <div className="proof-card-thumb" aria-hidden="true">
                                      {file.previewUrl && isImage ? (
                                        <img src={file.previewUrl} alt={file.name} loading="lazy" />
                                      ) : (
                                        <div className="proof-card-fallback">
                                          {isPdf ? 'PDF' : 'FILE'}
                                        </div>
                                      )}
                                    </div>

                                    {isUploading ? (
                                      <div className="proof-card-overlay proof-card-overlay-uploading" aria-hidden="true">
                                        <div className="proof-card-progress">
                                          <div
                                            className="proof-card-progress-bar"
                                            style={{ width: `${displayPercent}%` }}
                                          />
                                        </div>
                                        <div className="proof-card-progress-text">{displayPercent}%</div>
                                      </div>
                                    ) : isFailed ? (
                                      <div className="proof-card-overlay proof-card-overlay-error" aria-hidden="true">
                                        <div className="proof-card-error-title">转换失败</div>
                                        <div className="proof-card-error-body">
                                          {file.error || '请删除后重传'}
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="proof-card-overlay" aria-hidden="true">
                                        <span className="proof-card-name-pill" title={file.name}>
                                          {file.name}
                                        </span>
                                        <button
                                          type="button"
                                          className="proof-card-download"
                                          aria-label={`下载 ${file.name}`}
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            downloadProofFile(file);
                                          }}
                                        >
                                          <DownloadIcon />
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>

                            <FeishuButton
                              type="button"
                              className="upload-add-button upload-add-button-inline"
                              variant="text"
                              icon={<span className="upload-add-plus" aria-hidden="true">+</span>}
                              onClick={(event) => {
                                event.stopPropagation();
                                if (isSubmitting) return;
                                proofInputRef.current?.click();
                              }}
                              disabled={isSubmitting}
                            >
                              添加本地文件
                            </FeishuButton>
                          </>
                        )}
                      </div>
                    </div>
                    <ul className="proof-guidelines" aria-label="专业观众证明上传说明">
                      <li className="proof-guideline proof-guideline-accept">
                        <strong>请提交：</strong>
                        能够体现您为食品行业从业人员的证明材料，包含“姓名公司职位”，包括但不限于：名片、工作软件截图（如钉钉、飞书、企微）、工作证、企业邮箱截图等
                        {' '}
                        <a
                          href="https://www.foodtalks.cn/news/55602"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          查看示例
                        </a>
                      </li>
                      <li className="proof-guideline proof-guideline-reject">
                        <strong>请勿提交：</strong>
                        证件照片、自拍、形象照、产品图、工厂图、聊天截图等为无效证明，将无法通过审核
                      </li>
                      <li className="proof-guideline">
                        审核需要 1-3 个工作日，审核通过的出席人员方可入场
                      </li>
                      <li className="proof-guideline">
                        如有任何问题，请联系工作人员 Carrie（微信：lovelyFBIFer1）
                      </li>
                      <li className="proof-guideline proof-guideline-warn">
                        如在现场发现为非专业观众，我们有权请您离开现场
                      </li>
                    </ul>
                  </FeishuField>

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

                  <div className="form-actions">
                    {notice && (
                      <p className="notice notice-error">{notice}</p>
                    )}
                    <FeishuButton className="submit-button" type="submit" size="lg" block disabled={!identity || isSubmitting}>
                      {isSubmitting ? '提交中...' : '领取观展票'}
                    </FeishuButton>
                  </div>
                </form>
              )}

              {identity === 'consumer' && (
                <form className="dynamic-form" id="fbif-ticket-form" onSubmit={onSubmit}>
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
                      {consumerIdVerify.status === 'failed' && <span className="error">{consumerIdVerify.message}</span>}
                    </div>
                  )}

                  <FeishuField
                    label="手机号"
                    htmlFor="consumer-phone"
                    required
                    error={shouldShowError(fieldKey('consumer', 'phone')) ? consumerErrors.phone : ''}
                  >
                    <FeishuInput
                      id="consumer-phone"
                      type="tel"
                      autoComplete="tel"
                      inputMode="numeric"
                      placeholder="请输入手机号"
                      value={consumerForm.phone}
                      status={shouldShowError(fieldKey('consumer', 'phone')) && consumerErrors.phone ? 'error' : 'default'}
                      onChange={handleConsumerChange('phone')}
                      onBlur={() => markTouched(fieldKey('consumer', 'phone'))}
                    />
                  </FeishuField>

                  <div className="form-actions">
                    {notice && (
                      <p className="notice notice-error">{notice}</p>
                    )}
                    <FeishuButton className="submit-button" type="submit" size="lg" block disabled={!identity || isSubmitting}>
                      {isSubmitting ? '提交中...' : '领取观展票'}
                    </FeishuButton>
                  </div>
                </form>
              )}
            </FeishuCard>
          </>
        )}
      </div>

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
