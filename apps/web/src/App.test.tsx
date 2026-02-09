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
    expect(fetchMock).not.toHaveBeenCalled();
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
    await user.selectOptions(screen.getByLabelText('证件类型'), 'cn_id');
    await user.type(screen.getByLabelText('证件号码'), '11010519491231002X');
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
  });
});
