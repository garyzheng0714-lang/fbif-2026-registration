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

describe('App dynamic form', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows only banner and role selection first, then enters form page', async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.queryByLabelText('姓名')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /返回选择身份/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '我是食品行业相关从业者' }));
    await screen.findByLabelText('公司');
    expect(screen.getByRole('button', { name: /返回选择身份/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '我是消费者' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /返回选择身份/ }));
    await user.click(screen.getByRole('button', { name: '我是消费者' }));
    await screen.findByLabelText('姓名');
    expect(screen.queryByLabelText('公司')).not.toBeInTheDocument();
  });

  it('shows validation errors when required fields are missing', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);
    render(<App />);

    await user.click(screen.getByRole('button', { name: '我是消费者' }));
    await screen.findByLabelText('姓名');
    await user.click(screen.getByRole('button', { name: '领取观展票' }));

    expect(await screen.findByText('姓名至少 2 个字符')).toBeInTheDocument();
    const idTypeErrors = screen
      .getAllByText('请选择证件类型')
      .filter((node) => node.tagName === 'SPAN');
    expect(idTypeErrors.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('手机号格式不正确')).toBeInTheDocument();
    // CSRF is prefetched when entering form page.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost:8080/api/csrf');
  });

  it('shows unified cn_id format error message', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: '我是消费者' }));
    await screen.findByLabelText('姓名');
    await user.type(screen.getByLabelText('姓名'), '张三');
    await user.selectOptions(screen.getByLabelText('证件类型'), 'cn_id');
    await user.type(screen.getByLabelText('证件号码'), '123456');
    await user.type(screen.getByLabelText('手机号'), '13800000000');
    await user.click(screen.getByRole('button', { name: '领取观展票' }));

    expect(await screen.findByText('请输入正确的身份证号')).toBeInTheDocument();
  });

  it('submits consumer payload with backend-compatible mapping', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'csrf-token' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'submission-id', traceId: 'trace-id', syncStatus: 'PENDING' }, 202));

    render(<App />);

    await user.click(screen.getByRole('button', { name: '我是消费者' }));
    await screen.findByLabelText('姓名');

    await user.type(screen.getByLabelText('姓名'), '张三');
    await user.selectOptions(screen.getByLabelText('证件类型'), 'passport');
    await user.type(screen.getByLabelText('证件号码'), 'A1234567');
    await user.type(screen.getByLabelText('手机号'), '13800000000');
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
    expect(submitBody.phone).toBe('13800000000');

    expect(await screen.findByText('提交成功')).toBeInTheDocument();
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

    await user.click(screen.getByRole('button', { name: '我是消费者' }));
    await screen.findByLabelText('姓名');

    await user.type(screen.getByLabelText('姓名'), '张三');
    await user.selectOptions(screen.getByLabelText('证件类型'), 'cn_id');
    await user.type(screen.getByLabelText('证件号码'), '110105199912310022');
    await user.type(screen.getByLabelText('手机号'), '13800000000');

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
    await user.click(screen.getByRole('button', { name: '我是消费者' }));
    await screen.findByLabelText('姓名');

    await user.type(screen.getByLabelText('姓名'), '张三');
    await user.selectOptions(screen.getByLabelText('证件类型'), 'cn_id');
    await user.type(screen.getByLabelText('证件号码'), '11010519491231002X');
    await user.type(screen.getByLabelText('手机号'), '13800000000');
    await user.click(screen.getByRole('button', { name: '领取观展票' }));

    expect(await screen.findByText('年龄过大')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
