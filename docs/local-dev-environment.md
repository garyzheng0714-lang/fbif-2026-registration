# 本地联调环境说明（前端 + 模拟后端）

## 1. 问题诊断结论
当前报错 `提交失败，请稍后重试` 的直接原因是：
- 前端调用地址为 `http://localhost:8080`。
- 本机当时没有任何服务监听 `8080`，请求连接失败。

快速验证：
```bash
lsof -nP -iTCP:8080 -sTCP:LISTEN
curl -i http://localhost:8080/api/csrf
```

## 2. 新增本地模拟后端
路径：`/Library/vibecoding_home/fbif_form/apps/mock-api`

功能覆盖：
- `GET /api/csrf`：下发 CSRF token 并写 cookie。
- `POST /api/submissions`：
  - CSRF 校验
  - 表单字段校验（手机号/姓名/职位/公司/身份证号）
  - 返回 `202 + { id, syncStatus: "PENDING" }`
- `GET /api/submissions/:id/status`：返回 `PENDING/SUCCESS/FAILED`
- 内置网络模拟：延迟、随机失败、强制失败

## 3. 一键联调栈脚本
路径：`/Library/vibecoding_home/fbif_form/scripts/local-stack.mjs`

命令：
```bash
cd /Library/vibecoding_home/fbif_form
node scripts/local-stack.mjs start
node scripts/local-stack.mjs status
node scripts/local-stack.mjs logs
node scripts/local-stack.mjs stop
```

启动后可访问：
- 前端：`http://localhost:4173`
- mock-api：`http://localhost:8080`

## 4. 环境变量配置
### 4.1 前端（Vite）
文件：`/Library/vibecoding_home/fbif_form/apps/web/.env`

```env
VITE_API_URL=http://localhost:8080
VITE_SYNC_TIMEOUT_MS=30000
```

备注：前端代码已加默认回退 `http://localhost:8080`，即使没写 `.env` 也能联调。

### 4.2 mock-api
可选变量：
- `MOCK_API_PORT`：默认 `8080`
- `WEB_ORIGIN`：默认 `http://localhost:4173`
- `MOCK_API_LATENCY_MS`：基础延迟，默认 `120`
- `MOCK_API_JITTER_MS`：抖动延迟，默认 `80`
- `MOCK_API_SYNC_DELAY_MS`：状态从 `PENDING` 转最终状态的延迟，默认 `1200`
- `MOCK_API_FAIL_RATE`：同步失败概率（0~1），默认 `0`
- `MOCK_API_FORCE_SYNC_STATUS`：强制 `SUCCESS` 或 `FAILED`
- `MOCK_API_HTTP_500_RATE`：随机 HTTP 500 概率（0~1），默认 `0`

## 5. 自动化测试用例
测试文件：`/Library/vibecoding_home/fbif_form/apps/mock-api/test/api.test.js`

执行：
```bash
cd /Library/vibecoding_home/fbif_form/apps/mock-api
npm test
```

覆盖点：
1. 获取 CSRF 成功（含 cookie）
2. 无 CSRF 提交被拒绝（403）
3. 非法表单数据被拒绝（400）
4. 合法提交后状态从 `PENDING` 到 `SUCCESS`
5. 查询不存在 id 返回 404

## 6. 手工联调测试用例
1. 成功提交流程
- 启动栈后打开 `http://localhost:4173`
- 填写合法数据并提交
- 期望：页面提示 `提交成功`

2. 字段校验失败
- 手机号填 `123`
- 期望：前端立即提示 `手机号格式不正确`

3. 同步失败模拟
- 启动前设置：`MOCK_API_FORCE_SYNC_STATUS=FAILED`
- 期望：页面提示 `提交失败，请稍后重试`

4. 网络异常模拟
- 请求携带 `?fail=1` 或设置 `MOCK_API_HTTP_500_RATE=1`
- 期望：页面提示 `提交失败，请稍后重试`

## 7. 常见问题定位
1. 页面仍提示提交失败
- 执行：`node scripts/local-stack.mjs status`
- 若 mock-api 不是 running，重启：`node scripts/local-stack.mjs start`

2. 跨域问题
- 检查 `WEB_ORIGIN` 是否等于前端地址（默认 `http://localhost:4173`）

3. 端口冲突
- 改 `MOCK_API_PORT`，并同步设置前端 `VITE_API_URL`
