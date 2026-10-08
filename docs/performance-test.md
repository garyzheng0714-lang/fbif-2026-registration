# 性能验证方法与已知边界

## 当前可证明的结论

- 2026-03-16 的 Preview 单 IP step-ramp 验证了 PM2 运行形态：3 个 API cluster 实例和 1 个 BullMQ worker 在 2 分钟测试中保持在线、无重启、无 OOM。
- 同一测试**不能证明 120 RPS 容量**：7799 次迭代中只有 30 次提交返回 `202`，绝大多数请求被每 IP 限流器以 `429` 主动拒绝。
- 2026-02-11 的单进程/旧服务器压测已被当前 PM2、端口和资源配置取代，不得再把当时的 60 RPS 或理论三倍值当成现役容量承诺。
- 当前没有一份经过多来源流量、完整 CSRF + 提交链路验证的 200 RPS 生产容量结论。

因此，对外只能陈述“PM2 多进程形态已验证稳定”，不能陈述“系统已验证可承载 120/180/200 RPS”。

## 工具

- API 受理链路：k6，脚本位于 `tests/k6/`。
- 附件链路：`tests/load/` 下的 OSS 直传 + `proofUrls` 混合脚本。
- 运行时观测：`/metrics`、容器日志、PM2 进程状态、PostgreSQL/Redis 连接与队列指标。

## 本地基线

```bash
k6 run tests/k6/form-submit.js -e BASE_URL=http://localhost:8080
```

这条命令适合回归相对变化，不代表生产容量。压测前确认目标是隔离的测试环境，并清楚记录限流参数、worker 是否启用、数据库规模与机器配置。

## OSS 混合链路

脚本会模拟行业用户上传附件和消费者直接提交：

```bash
dd if=/dev/urandom of=/tmp/fbif-load-20mb.bin bs=1m count=20

API_BASE=http://127.0.0.1:8080 \
FILES_SPECS="/tmp/fbif-load-20mb.bin:20971520:proof-1.bin,/tmp/fbif-load-20mb.bin:20971520:proof-2.bin,/tmp/fbif-load-20mb.bin:20971520:proof-3.bin" \
bash tests/load/mixed_oss_100.sh
```

不得把真实报名数据、生产密钥或生产飞书表带入压测。测试创建的数据必须使用可识别的测试前缀，并在验证计数后清理。

## 容量验收要求

生产级容量结论至少需要同时满足：

1. 多来源 IP 或等效可信方案，避免单 IP 限流主导结果。
2. 完整执行 CSRF、提交 `202`、状态查询和最终飞书同步，而不是只测健康检查。
3. 报告 HTTP 状态分布，单列 `202`、`403`、`429`、`5xx` 和超时；不能只报平均延迟。
4. 记录目标 commit、日期、机器配置、PM2 实例数、数据库/Redis、worker 开关、所有限流与连接池参数。
5. 记录 p50/p95/p99、错误率、成功提交数、最终 `SUCCESS/FAILED`、队列峰值、CPU、内存和数据库连接数。
6. 测试后验证 PM2 重启次数、OOM、队列残留与测试数据清理结果。

## 结果模板

```text
日期与 commit：
环境与机器：
流量模型/来源分布：
限流、连接池、worker 参数：
迭代数与状态码分布：
submit 202：
最终 SUCCESS / FAILED：
p50 / p95 / p99：
队列峰值：
CPU / 内存 / DB 连接峰值：
进程重启 / OOM：
测试数据清理计数：
结论与适用边界：
```
