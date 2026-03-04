import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

async function selectFeishuOption(
  user: ReturnType<typeof userEvent.setup>,
  fieldLabel: string,
  optionLabel: string
) {
  await user.click(screen.getByLabelText(fieldLabel));
  await user.click(await screen.findByRole('option', { name: optionLabel }));
}

describe('App dynamic form', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState({}, '', '/');
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    window.history.replaceState({}, '', '/');
    vi.unstubAllGlobals();
  });

  it('shows only banner and role selection first, then enters form page', async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.queryByLabelText('姓名')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /返回选择身份/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '专业观众注册' }));
    await screen.findByLabelText('公司');
    expect(screen.getByRole('button', { name: /返回选择身份/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '我是消费者' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /返回选择身份/ }));
    await user.click(screen.getByRole('button', { name: '消费者注册' }));
    await screen.findByLabelText('姓名');
    expect(screen.queryByLabelText('公司')).not.toBeInTheDocument();
  });

  it('shows validation errors when required fields are missing', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);
    render(<App />);

    await user.click(screen.getByRole('button', { name: '消费者注册' }));
    await screen.findByLabelText('姓名');
    await user.click(screen.getByRole('button', { name: '领取观展票' }));

    expect(await screen.findByText('姓名至少 2 个字符')).toBeInTheDocument();
    expect(screen.getByLabelText('证件类型')).toHaveTextContent('中国居民身份证');
    expect(screen.getByText('手机号格式不正确')).toBeInTheDocument();
    // CSRF is prefetched when entering form page.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost:8080/api/csrf');
  });

  it('shows unified cn_id format error message', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: '消费者注册' }));
    await screen.findByLabelText('姓名');
    await user.type(screen.getByLabelText('姓名'), '张三');
    await selectFeishuOption(user, '证件类型', '中国居民身份证');
    await user.type(screen.getByLabelText('证件号码'), '123456');
    await user.type(screen.getByLabelText('手机号'), '13800000000');
    await user.click(screen.getByRole('button', { name: '领取观展票' }));

    expect(await screen.findByText('请输入正确的身份证号')).toBeInTheDocument();
  });

  it('submits consumer payload with backend-compatible mapping', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);
    window.history.replaceState({}, '', '/?qz_gdt=qz-test-click');
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'csrf-token' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'submission-id', traceId: 'trace-id', syncStatus: 'PENDING' }, 202));

    render(<App />);

    await user.click(screen.getByRole('button', { name: '消费者注册' }));
    await screen.findByLabelText('姓名');

    await user.type(screen.getByLabelText('姓名'), '张三');
    await selectFeishuOption(user, '证件类型', '护照');
    await user.type(screen.getByLabelText('证件号码'), 'A1234567');
    await user.type(screen.getByLabelText('手机号'), '13800000000');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: '领取观展票' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    const submitCall = fetchMock.mock.calls[1];
    const submitBody = JSON.parse(String(submitCall?.[1]?.body));

    expect(submitBody.role).toBe('consumer');
    expect(submitBody.title).toBe('消费者');
    expect(submitBody.company).toBe('个人消费者');
    expect(submitBody.name).toBe('张三');
    expect(submitBody.phone).toBe('+8613800000000');
    expect(submitBody.clickId).toBe('qz-test-click');
    expect(submitBody.clickIdSourceKey).toBe('qz_gdt');

    expect(await screen.findByText('报名成功')).toBeInTheDocument();
    expect(screen.getByText('FBIF 食品创新展 2026 消费者观展票')).toBeInTheDocument();
    expect(
      screen.getByText((_, element) => {
        if (element?.tagName !== 'P') return false;
        const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
        return (
          text.includes('大陆身份证原件 + 电子门票') &&
          text.includes('4 月 29 日') &&
          text.includes('入场观展（不含论坛）')
        );
      })
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '点击链接' })).not.toBeInTheDocument();
    expect(screen.queryByText(/^Trace ID:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Submission ID:/)).not.toBeInTheDocument();
  });

  it('auto verifies cn_id on submit and sends idVerifyToken', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'csrf-token' }))
      .mockResolvedValueOnce(
        jsonResponse({
          verified: true,
          result: 1,
          message: '实名验证通过',
          verificationToken: 'verify-token'
        })
      )
      .mockResolvedValueOnce(jsonResponse({ id: 'submission-id', traceId: 'trace-id', syncStatus: 'PENDING' }, 202));

    render(<App />);

    await user.click(screen.getByRole('button', { name: '消费者注册' }));
    await screen.findByLabelText('姓名');

    await user.type(screen.getByLabelText('姓名'), '张三');
    await selectFeishuOption(user, '证件类型', '中国居民身份证');
    await user.type(screen.getByLabelText('证件号码'), '110105199912310022');
    await user.type(screen.getByLabelText('手机号'), '13800000000');
    await user.click(screen.getByRole('checkbox'));

    await user.click(screen.getByRole('button', { name: '领取观展票' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
    const verifyCall = fetchMock.mock.calls[1];
    expect(verifyCall?.[0]).toBe('http://localhost:8080/api/id-verify');

    const submitCall = fetchMock.mock.calls[2];
    const submitBody = JSON.parse(String(submitCall?.[1]?.body));
    expect(submitBody.idVerifyToken).toBe('verify-token');
    expect(submitBody.idType).toBe('cn_id');
  });

  it('blocks consumer age over 50 with toast', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse({ csrfToken: 'csrf-token' }));

    render(<App />);
    await user.click(screen.getByRole('button', { name: '消费者注册' }));
    await screen.findByLabelText('姓名');

    await user.type(screen.getByLabelText('姓名'), '张三');
    await selectFeishuOption(user, '证件类型', '中国居民身份证');
    await user.type(screen.getByLabelText('证件号码'), '11010519491231002X');
    await user.type(screen.getByLabelText('手机号'), '13800000000');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: '领取观展票' }));

    expect(
      await screen.findByText('因场内人流管控需要，16岁以下、50岁以上群体暂无法报名，感谢您的理解。')
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses draft click attribution when url has no query params', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);
    window.localStorage.setItem(
      'fbif_form_draft_v2',
      JSON.stringify({
        clientRequestId: 'draft-client-request-id',
        clickId: 'draft-click-id',
        clickIdSourceKey: 'gdt_vid',
        identity: 'consumer',
        industryForm: {
          name: '',
          idType: 'cn_id',
          idNumber: '',
          phoneCountryCode: '+86',
          phone: '',
          company: '',
          title: '',
          businessType: '',
          department: '',
          proofFiles: []
        },
        consumerForm: {
          name: '',
          idType: 'passport',
          idNumber: '',
          phoneCountryCode: '+86',
          phone: ''
        }
      })
    );
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'csrf-token' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'submission-id', traceId: 'trace-id', syncStatus: 'PENDING' }, 202));

    render(<App />);
    await user.click(screen.getByRole('button', { name: '消费者注册' }));
    await screen.findByLabelText('姓名');
    await user.type(screen.getByLabelText('姓名'), '李四');
    await selectFeishuOption(user, '证件类型', '护照');
    await user.type(screen.getByLabelText('证件号码'), 'P1234567');
    await user.type(screen.getByLabelText('手机号'), '13800000000');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: '领取观展票' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    const submitCall = fetchMock.mock.calls[1];
    const submitBody = JSON.parse(String(submitCall?.[1]?.body));
    expect(submitBody.clickId).toBe('draft-click-id');
    expect(submitBody.clickIdSourceKey).toBe('gdt_vid');
  });
});
