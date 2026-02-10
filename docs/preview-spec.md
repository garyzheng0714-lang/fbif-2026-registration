# 预览规范（避免 `ERR_CONNECTION_REFUSED`）

适用目录：`apps/web`

## 标准流程
1. 启动预览（自动构建 + 守护进程 + 健康检查）
```bash
cd apps/web
npm run preview:start
```

2. 查询状态
```bash
npm run preview:status
```

3. 打开地址
- 本机：`http://localhost:4173`
- 局域网：`http://<你的IP>:4173`

4. 停止预览
```bash
npm run preview:stop
```

## 禁止做法
- 不要使用一次性命令后台启动（例如临时 `nohup npm run dev &`），在当前环境下容易被回收。
- 不要每次换端口，固定使用 `4173`，避免混淆。

## 排障顺序
1. 先跑 `npm run preview:status`
2. 若显示 `stopped`，重新执行 `npm run preview:start`
3. 若显示 `health check failed`，查看日志路径
```bash
npm run preview:logs
cat apps/web/.preview.log
```
4. 若端口被占用，先 `npm run preview:stop` 再 `npm run preview:start`

## 成功判定
- `npm run preview:status` 返回 `running`
- `curl -I http://localhost:4173` 返回 `HTTP/1.1 200 OK`
