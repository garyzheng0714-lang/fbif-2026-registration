import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent, FormEvent, KeyboardEvent } from 'react';
import { useThrottleCallback } from './hooks/useThrottleCallback';
import {
  validateChineseId,
  validatePhone,
  validateRequired
} from './utils/validation';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8080';
const FORM_DRAFT_KEY = 'fbif_form_draft_v2';
const TOP_BANNER_URL =
  'https://fbif-feishu-base.oss-cn-shanghai.aliyuncs.com/fbif-attachment-to-url/2026/02/tblMQeXvSGd7Hebf_YHcyINOqnzM9YxjJToK2RA_1770366619961/img_v3_02ul_3790aefe-c6b6-473f-9c05-97aa380983bg_1770366621905.jpg';

type Identity = '' | 'industry' | 'consumer';
type IdType = '' | 'cn_id' | 'passport' | 'other';

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
type Notice =
  | ''
  | '请选择观展身份'
  | '请先修正表单错误'
  | '提交失败，请稍后重试';

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

function validateIdNumber(idType: IdType, idNumber: string) {
  const normalized = idNumber.trim();
  if (!idType) return '请选择证件类型';
  if (!normalized) return '请输入证件号码';
  if (idType === 'cn_id') return validateChineseId(normalized);
  if (!otherIdRegex.test(normalized)) {
    return '证件号格式不正确（6-20位字母/数字/短横线）';
  }
  return '';
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
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [notice, setNotice] = useState<Notice>('');
  const [isSwitching, setIsSwitching] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isProofDragOver, setIsProofDragOver] = useState(false);
  const [proofPreviews, setProofPreviews] = useState<ProofPreview[]>([]);
  const [proofUploadPercent, setProofUploadPercent] = useState(0);
  const proofPreviewUrlsRef = useRef<string[]>([]);
  const switchTimerRef = useRef<number | null>(null);
  const proofInputRef = useRef<HTMLInputElement | null>(null);
  const proofUploadsRef = useRef<File[]>([]);
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
  }, [identity, industryForm, consumerForm]);

  useEffect(() => {
    return () => {
      if (switchTimerRef.current) {
        window.clearTimeout(switchTimerRef.current);
      }
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

  const industryErrors: IndustryErrors = useMemo(() => {
    return {
      name: validateRequired(industryForm.name, '姓名', 2, 32),
      idType: industryForm.idType ? '' : '请选择证件类型',
      idNumber: validateIdNumber(industryForm.idType, industryForm.idNumber),
      phone: validatePhone(industryForm.phone),
      company: validateRequired(industryForm.company, '公司', 2, 64),
      title: validateRequired(industryForm.title, '职位', 2, 32),
      businessType: industryForm.businessType ? '' : '请选择业务类型',
      department: industryForm.department ? '' : '请选择所在部门',
      proofFiles: industryForm.proofFiles.length ? '' : '请上传专业观众证明材料'
    };
  }, [industryForm]);

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

  const hasError = activeErrors ? Object.values(activeErrors).some(Boolean) : true;

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
    };

  const handleConsumerChange =
    (field: keyof ConsumerForm) =>
    (
      event: ChangeEvent<HTMLInputElement> | ChangeEvent<HTMLSelectElement>
    ) => {
      const value = event.target.value;
      setConsumerForm((prev) => ({ ...prev, [field]: value }));
    };

  const clearProofFiles = () => {
    proofUploadsRef.current = [];
    setProofUploadPercent(0);
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
        previewUrl
      });
    }

    if (nextPreviews.length === 0) return;

    proofUploadsRef.current = nextUploads;
    setIndustryForm((prev) => ({ ...prev, proofFiles: nextUploads.map((file) => file.name) }));
    setProofPreviews((prev) => [...prev, ...nextPreviews]);
    markTouched(fieldKey('industry', 'proofFiles'));
  };

  const removeProofFile = (id: string) => {
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

    if (hasError) {
      setNotice('请先修正表单错误');
      return;
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
      const csrfResp = await fetch(`${API_BASE}/api/csrf`, {
        credentials: 'include'
      });

      const csrfData = await parseJsonIfPossible(csrfResp);
      if (!csrfResp.ok || !csrfData?.csrfToken) {
        throw new Error('csrf_failed');
      }

      const payload = identity === 'industry'
        ? {
            phone: industryForm.phone.trim(),
            name: industryForm.name.trim(),
            title: industryForm.title.trim(),
            company: industryForm.company.trim(),
            idNumber: industryForm.idNumber.trim(),
            role: 'industry',
            idType: industryForm.idType,
            businessType: industryForm.businessType,
            department: industryForm.department,
            proofFileNames: industryForm.proofFiles
          }
        : {
            phone: consumerForm.phone.trim(),
            name: consumerForm.name.trim(),
            title: '消费者',
            company: '个人消费者',
            idNumber: consumerForm.idNumber.trim(),
            role: 'consumer',
            idType: consumerForm.idType
          };

      const shouldUploadProofFiles = identity === 'industry' && proofUploadsRef.current.length > 0;

      const submitResult = shouldUploadProofFiles
        ? await new Promise<{ ok: boolean; status: number; data: any | null }>((resolve, reject) => {
            setProofUploadPercent(0);

            const form = new FormData();
            Object.entries(payload).forEach(([key, value]) => {
              if (Array.isArray(value)) {
                form.append(key, JSON.stringify(value));
                return;
              }
              if (value === undefined || value === null) return;
              form.append(key, String(value));
            });
            proofUploadsRef.current.forEach((file) => {
              form.append('proofFiles', file, file.name);
            });

            const xhr = new XMLHttpRequest();
            xhr.open('POST', `${API_BASE}/api/submissions`);
            xhr.withCredentials = true;
            xhr.setRequestHeader('X-CSRF-Token', String(csrfData.csrfToken));
            xhr.setRequestHeader('Accept', 'application/json');

            xhr.upload.onprogress = (event) => {
              if (!event.lengthComputable || !event.total) return;
              const next = Math.round((event.loaded / event.total) * 100);
              setProofUploadPercent(Math.min(99, Math.max(0, next)));
            };

            xhr.onload = () => {
              setProofUploadPercent(100);
              let data: any | null = null;
              try {
                data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
              } catch {
                data = null;
              }
              resolve({
                ok: xhr.status >= 200 && xhr.status < 300,
                status: xhr.status,
                data
              });
            };

            xhr.onerror = () => reject(new Error('network_error'));
            xhr.onabort = () => reject(new Error('upload_aborted'));

            xhr.send(form);
          })
        : await (async () => {
            const resp = await fetch(`${API_BASE}/api/submissions`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfData.csrfToken
              },
              credentials: 'include',
              body: JSON.stringify(payload)
            });
            const data = await parseJsonIfPossible(resp);
            return { ok: resp.ok, status: resp.status, data };
          })();

      const submitData = submitResult.data;
      if (!submitResult.ok || !submitData?.id) {
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
      clearProofFiles();
      setTouched({});
      setSubmitAttempted(false);
      setNotice('');
      try {
        window.localStorage.setItem(
          FORM_DRAFT_KEY,
          JSON.stringify({
            identity,
            industryForm: initialIndustryForm,
            consumerForm: initialConsumerForm
          })
        );
      } catch {
        // Ignore temporary storage write failure.
      }
    } catch {
      setNotice('提交失败，请稍后重试');
      setSubmitDialog((prev) => ({
        ...prev,
        open: true,
        status: 'error'
      }));
    } finally {
      setIsSubmitting(false);
      setProofUploadPercent(0);
    }
  }, 1500);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit();
  };

  const identityLabel = identity === 'industry' ? '食品行业相关从业者' : '消费者';

  return (
    <div className="page">
      <div className="frame">
        <img className="banner" src={TOP_BANNER_URL} alt="FBIF 食品创新展" />

        {page === 'identity' && (
          <>
            <section className="card role-card">
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
            </section>
          </>
        )}

        {page === 'form' && (
          <>
            <section className="card stage-head">
              <button type="button" className="stage-back" onClick={handleBackToIdentity}>
                {'< 返回选择身份'}
              </button>
              <p className="stage-current stage-current-centered" aria-live="polite">
                <span className="stage-current-value">{identityLabel}</span>
              </p>
            </section>

            <section className={`card form-shell ${isSwitching ? 'form-shell-reveal' : ''}`} aria-live="polite">
              {identity === 'industry' && (
                <form className="dynamic-form" id="fbif-ticket-form" onSubmit={onSubmit}>
                  <div className="field">
                    <label htmlFor="industry-name">姓名</label>
                    <input
                      id="industry-name"
                      type="text"
                      autoComplete="name"
                      placeholder="请输入姓名"
                      value={industryForm.name}
                      onChange={handleIndustryChange('name')}
                      onBlur={() => markTouched(fieldKey('industry', 'name'))}
                    />
                    {shouldShowError(fieldKey('industry', 'name')) && industryErrors.name && (
                      <span className="error">{industryErrors.name}</span>
                    )}
                  </div>

                  <div className="field">
                    <label htmlFor="industry-idType">证件类型</label>
                    <select
                      id="industry-idType"
                      value={industryForm.idType}
                      onChange={handleIndustryChange('idType')}
                      onBlur={() => markTouched(fieldKey('industry', 'idType'))}
                    >
                      <option value="">请选择证件类型</option>
                      {idTypeOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    {shouldShowError(fieldKey('industry', 'idType')) && industryErrors.idType && (
                      <span className="error">{industryErrors.idType}</span>
                    )}
                  </div>

                  <div className="field">
                    <label htmlFor="industry-idNumber">证件号码</label>
                    <input
                      id="industry-idNumber"
                      type="text"
                      autoComplete="off"
                      inputMode="text"
                      placeholder="请输入证件号码"
                      value={industryForm.idNumber}
                      onChange={handleIndustryChange('idNumber')}
                      onBlur={() => markTouched(fieldKey('industry', 'idNumber'))}
                    />
                    {shouldShowError(fieldKey('industry', 'idNumber')) && industryErrors.idNumber && (
                      <span className="error">{industryErrors.idNumber}</span>
                    )}
                  </div>

                  <div className="field">
                    <label htmlFor="industry-phone">手机号</label>
                    <input
                      id="industry-phone"
                      type="tel"
                      autoComplete="tel"
                      inputMode="numeric"
                      placeholder="请输入手机号"
                      value={industryForm.phone}
                      onChange={handleIndustryChange('phone')}
                      onBlur={() => markTouched(fieldKey('industry', 'phone'))}
                    />
                    {shouldShowError(fieldKey('industry', 'phone')) && industryErrors.phone && (
                      <span className="error">{industryErrors.phone}</span>
                    )}
                  </div>

                  <div className="field">
                    <label htmlFor="industry-proof">上传专业观众证明</label>
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
                            <button
                              type="button"
                              className="upload-add-button"
                              onClick={(event) => {
                                event.stopPropagation();
                                if (isSubmitting) return;
                                proofInputRef.current?.click();
                              }}
                              disabled={isSubmitting}
                            >
                              <span className="upload-add-plus" aria-hidden="true">+</span>
                              添加本地文件
                            </button>
                          </div>
                        ) : (
                          <>
                            <div className="proof-card-list" role="list" aria-label="已选择的证明文件">
                              {proofPreviews.map((file) => {
                                const isUploading = isSubmitting && proofUploadsRef.current.length > 0;
                                const displayPercent = Math.min(100, Math.max(0, proofUploadPercent));
                                const isImage = (file.type || '').toLowerCase().startsWith('image/');
                                const isPdf =
                                  (file.type || '').toLowerCase() === 'application/pdf' ||
                                  file.name.toLowerCase().endsWith('.pdf');

                                return (
                                  <div
                                    key={file.id}
                                    className={`proof-card ${isUploading ? 'is-uploading' : ''}`}
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
                                        if (isUploading) return;
                                        removeProofFile(file.id);
                                      }}
                                      disabled={isUploading}
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

                            <button
                              type="button"
                              className="upload-add-button upload-add-button-inline"
                              onClick={(event) => {
                                event.stopPropagation();
                                if (isSubmitting) return;
                                proofInputRef.current?.click();
                              }}
                              disabled={isSubmitting}
                            >
                              <span className="upload-add-plus" aria-hidden="true">+</span>
                              添加本地文件
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    <p className="hint">支持名片、工作证、在职证明等材料。刷新后需重新选择文件。</p>
                    {shouldShowError(fieldKey('industry', 'proofFiles')) && industryErrors.proofFiles && (
                      <span className="error">{industryErrors.proofFiles}</span>
                    )}
                  </div>

                  <div className="field">
                    <label htmlFor="industry-company">公司</label>
                    <input
                      id="industry-company"
                      type="text"
                      autoComplete="organization"
                      placeholder="请输入公司名称"
                      value={industryForm.company}
                      onChange={handleIndustryChange('company')}
                      onBlur={() => markTouched(fieldKey('industry', 'company'))}
                    />
                    {shouldShowError(fieldKey('industry', 'company')) && industryErrors.company && (
                      <span className="error">{industryErrors.company}</span>
                    )}
                  </div>

                  <div className="field">
                    <label htmlFor="industry-title">职位</label>
                    <input
                      id="industry-title"
                      type="text"
                      autoComplete="organization-title"
                      placeholder="请输入职位"
                      value={industryForm.title}
                      onChange={handleIndustryChange('title')}
                      onBlur={() => markTouched(fieldKey('industry', 'title'))}
                    />
                    {shouldShowError(fieldKey('industry', 'title')) && industryErrors.title && (
                      <span className="error">{industryErrors.title}</span>
                    )}
                  </div>

                  <div className="field">
                    <label htmlFor="industry-businessType">贵司业务类型</label>
                    <select
                      id="industry-businessType"
                      value={industryForm.businessType}
                      onChange={handleIndustryChange('businessType')}
                      onBlur={() => markTouched(fieldKey('industry', 'businessType'))}
                    >
                      <option value="">请选择业务类型</option>
                      {industryBusinessOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                    {shouldShowError(fieldKey('industry', 'businessType')) && industryErrors.businessType && (
                      <span className="error">{industryErrors.businessType}</span>
                    )}
                  </div>

                  <div className="field">
                    <label htmlFor="industry-department">您所处部门</label>
                    <select
                      id="industry-department"
                      value={industryForm.department}
                      onChange={handleIndustryChange('department')}
                      onBlur={() => markTouched(fieldKey('industry', 'department'))}
                    >
                      <option value="">请选择所在部门</option>
                      {departmentOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                    {shouldShowError(fieldKey('industry', 'department')) && industryErrors.department && (
                      <span className="error">{industryErrors.department}</span>
                    )}
                  </div>

                  <div className="form-actions">
                    {notice && (
                      <p className="notice notice-error">{notice}</p>
                    )}
                    <button className="submit-button" type="submit" disabled={!identity || isSubmitting}>
                      {isSubmitting ? '提交中...' : '领取观展票'}
                    </button>
                  </div>
                </form>
              )}

              {identity === 'consumer' && (
                <form className="dynamic-form" id="fbif-ticket-form" onSubmit={onSubmit}>
                  <div className="field">
                    <label htmlFor="consumer-name">姓名</label>
                    <input
                      id="consumer-name"
                      type="text"
                      autoComplete="name"
                      placeholder="请输入姓名"
                      value={consumerForm.name}
                      onChange={handleConsumerChange('name')}
                      onBlur={() => markTouched(fieldKey('consumer', 'name'))}
                    />
                    {shouldShowError(fieldKey('consumer', 'name')) && consumerErrors.name && (
                      <span className="error">{consumerErrors.name}</span>
                    )}
                  </div>

                  <div className="field">
                    <label htmlFor="consumer-idType">证件类型</label>
                    <select
                      id="consumer-idType"
                      value={consumerForm.idType}
                      onChange={handleConsumerChange('idType')}
                      onBlur={() => markTouched(fieldKey('consumer', 'idType'))}
                    >
                      <option value="">请选择证件类型</option>
                      {idTypeOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    {shouldShowError(fieldKey('consumer', 'idType')) && consumerErrors.idType && (
                      <span className="error">{consumerErrors.idType}</span>
                    )}
                  </div>

                  <div className="field">
                    <label htmlFor="consumer-idNumber">证件号码</label>
                    <input
                      id="consumer-idNumber"
                      type="text"
                      autoComplete="off"
                      inputMode="text"
                      placeholder="请输入证件号码"
                      value={consumerForm.idNumber}
                      onChange={handleConsumerChange('idNumber')}
                      onBlur={() => markTouched(fieldKey('consumer', 'idNumber'))}
                    />
                    {shouldShowError(fieldKey('consumer', 'idNumber')) && consumerErrors.idNumber && (
                      <span className="error">{consumerErrors.idNumber}</span>
                    )}
                  </div>

                  <div className="field">
                    <label htmlFor="consumer-phone">手机号</label>
                    <input
                      id="consumer-phone"
                      type="tel"
                      autoComplete="tel"
                      inputMode="numeric"
                      placeholder="请输入手机号"
                      value={consumerForm.phone}
                      onChange={handleConsumerChange('phone')}
                      onBlur={() => markTouched(fieldKey('consumer', 'phone'))}
                    />
                    {shouldShowError(fieldKey('consumer', 'phone')) && consumerErrors.phone && (
                      <span className="error">{consumerErrors.phone}</span>
                    )}
                  </div>

                  <div className="form-actions">
                    {notice && (
                      <p className="notice notice-error">{notice}</p>
                    )}
                    <button className="submit-button" type="submit" disabled={!identity || isSubmitting}>
                      {isSubmitting ? '提交中...' : '领取观展票'}
                    </button>
                  </div>
                </form>
              )}
            </section>
          </>
        )}
      </div>

      {submitDialog.open && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="提交状态">
          <div className="modal">
            {submitDialog.status === 'submitting' && (
              <>
                <h3 className="modal-title">正在提交</h3>
                <p className="modal-body">我们正在接收您的信息，请勿关闭页面。</p>
              </>
            )}
            {submitDialog.status === 'success' && (
              <>
                <h3 className="modal-title modal-title-ok">提交成功</h3>
                <p className="modal-body">
                  您的提交已成功受理，系统将后台异步写入多维表格。
                  <br />
                  如需人工排查，请提供 Trace ID。
                </p>
                {(submitDialog.traceId || submitDialog.submissionId) && (
                  <div className="modal-meta">
                    {submitDialog.traceId && (
                      <p className="modal-meta-line">
                        Trace ID: <code>{submitDialog.traceId}</code>
                      </p>
                    )}
                    {submitDialog.submissionId && (
                      <p className="modal-meta-line">
                        Submission ID: <code>{submitDialog.submissionId}</code>
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
            {submitDialog.status === 'error' && (
              <>
                <h3 className="modal-title modal-title-error">提交失败</h3>
                <p className="modal-body">请稍后重试。如持续失败，请联系工作人员。</p>
              </>
            )}
            <div className="modal-actions">
              <button
                className={`modal-button ${submitDialog.status === 'submitting' ? '' : 'modal-button-primary'}`}
                type="button"
                onClick={() => setSubmitDialog((prev) => ({ ...prev, open: false }))}
                disabled={submitDialog.status === 'submitting' && isSubmitting}
              >
                {submitDialog.status === 'submitting' ? '隐藏' : '确定'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
