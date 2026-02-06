# 性能测试报告与方法

## 压测工具
使用 k6。

## 执行方法
```bash
k6 run /Library/vibecoding_home/fbif_form/tests/k6/form-submit.js -e BASE_URL=http://localhost:8080
```

## 目标指标
- 1000+ 并发用户稳定响应
- P95 响应 < 200ms（视机器配置而定）
- 错误率 < 1%

## 建议采样
- 并发 100 / 500 / 1000 三档
- 观察 API、Redis、PostgreSQL 的 CPU、内存与连接数

## 记录模板
- 峰值并发：
- 平均 TPS：
- P95 响应：
- 错误率：
- 数据库连接数：
