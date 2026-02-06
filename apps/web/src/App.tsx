import { useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useDebouncedValue } from './hooks/useDebouncedValue';
import { useThrottleCallback } from './hooks/useThrottleCallback';
import {
  validateChineseId,
  validatePhone,
  validateRequired
} from './utils/validation';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8080';
const SYNC_TIMEOUT_MS = Number(import.meta.env.VITE_SYNC_TIMEOUT_MS || 30000);

const initialForm = {
  phone: '',
  name: '',
  title: '',
  company: '',
  idNumber: ''
};

type Errors = Record<keyof typeof initialForm, string>;
type Notice = '' | '提交成功' | '提交失败，请稍后重试' | '请先修正表单错误';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

export default function App() {
  const [form, setForm] = useState(initialForm);
  const [notice, setNotice] = useState<Notice>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const debouncedForm = useDebouncedValue(form, 250);

  const errors: Errors = useMemo(() => {
    return {
      phone: validatePhone(debouncedForm.phone),
      name: validateRequired(debouncedForm.name, '姓名', 2, 32),
      title: validateRequired(debouncedForm.title, '职位', 2, 32),
      company: validateRequired(debouncedForm.company, '公司', 2, 64),
      idNumber: validateChineseId(debouncedForm.idNumber)
    };
  }, [debouncedForm]);

  const hasError = Object.values(errors).some(Boolean);

  const handleChange =
    (field: keyof typeof initialForm) =>
    (event: ChangeEvent<HTMLInputElement>) => {
      setForm((prev) => ({ ...prev, [field]: event.target.value }));
    };

  const pollStatus = async (id: string): Promise<boolean> => {
    const startedAt = Date.now();
    while (Date.now() - startedAt <= SYNC_TIMEOUT_MS) {
      const resp = await fetch(`${API_BASE}/api/submissions/${id}/status`, {
        credentials: 'include'
      });

      if (!resp.ok) {
        return false;
      }

      const data = await parseJsonIfPossible(resp);
      if (!data) {
        return false;
      }

      if (data.syncStatus === 'SUCCESS') {
        return true;
      }

      if (data.syncStatus === 'FAILED') {
        return false;
      }

      // Poll every 1.5s until timeout or terminal state.
      await sleep(1500);
    }

    return false;
  };

  const submit = useThrottleCallback(async () => {
    if (hasError) {
      setNotice('请先修正表单错误');
      return;
    }

    setNotice('');
    setIsSubmitting(true);

    try {
      const csrfResp = await fetch(`${API_BASE}/api/csrf`, {
        credentials: 'include'
      });

      const csrfData = await parseJsonIfPossible(csrfResp);
      if (!csrfResp.ok || !csrfData?.csrfToken) {
        throw new Error('csrf_failed');
      }

      const submitResp = await fetch(`${API_BASE}/api/submissions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfData.csrfToken
        },
        credentials: 'include',
        body: JSON.stringify(form)
      });

      const submitData = await parseJsonIfPossible(submitResp);
      if (!submitResp.ok || !submitData?.id) {
        throw new Error('submit_failed');
      }

      const ok = await pollStatus(submitData.id);
      if (!ok) {
        throw new Error('sync_failed');
      }

      setForm(initialForm);
      setNotice('提交成功');
    } catch {
      setNotice('提交失败，请稍后重试');
    } finally {
      setIsSubmitting(false);
    }
  }, 2000);

  return (
    <div className="page">
      <div className="frame">
        <img className="banner" src="/banner.png" alt="FBIF 食品创新展" />

        <div className="grid">
          <section className="card">
            <h3>填写信息</h3>

            <form
              className="form"
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              <div className="field">
                <label>手机号</label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={handleChange('phone')}
                  placeholder="例如 13800000000"
                  required
                />
                {errors.phone && <span className="error">{errors.phone}</span>}
              </div>

              <div className="field">
                <label>姓名</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={handleChange('name')}
                  placeholder="例如 张三"
                  required
                />
                {errors.name && <span className="error">{errors.name}</span>}
              </div>

              <div className="field">
                <label>职位</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={handleChange('title')}
                  placeholder="例如 运营负责人"
                  required
                />
                {errors.title && <span className="error">{errors.title}</span>}
              </div>

              <div className="field">
                <label>公司</label>
                <input
                  type="text"
                  value={form.company}
                  onChange={handleChange('company')}
                  placeholder="例如 飞书科技有限公司"
                  required
                />
                {errors.company && <span className="error">{errors.company}</span>}
              </div>

              <div className="field">
                <label>身份证号</label>
                <input
                  type="text"
                  value={form.idNumber}
                  onChange={handleChange('idNumber')}
                  placeholder="18 位身份证号"
                  required
                />
                {errors.idNumber && <span className="error">{errors.idNumber}</span>}
              </div>

              <button className="submit" type="submit" disabled={isSubmitting}>
                {isSubmitting ? '提交中...' : '提交'}
              </button>

              {notice && (
                <p className={`notice ${notice === '提交成功' ? 'notice-ok' : 'notice-error'}`}>
                  {notice}
                </p>
              )}
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}
