# 性能测试报告与方法

## 压测工具
受理接口使用 k6；附件直传 OSS 使用脚本压测（更贴近真实链路）。

## 执行方法
### 1) API 受理压测（不含附件）
```bash
k6 run tests/k6/form-submit.js -e BASE_URL=http://localhost:8080
```

### 2) 附件真实压测（OSS 直传 + proofUrls）
该脚本会模拟：
- 60 个行业用户（每人上传附件并提交）
- 40 个消费者（不上传附件）

```bash
# 生成 20MB 测试文件
dd if=/dev/urandom of=/tmp/fbif-load-20mb.bin bs=1m count=20

# 100 并发，一人 3 个附件（可用同一个文件复用）
API_BASE=http://112.124.103.65:8080 \
FILES_SPECS="/tmp/fbif-load-20mb.bin:20971520:proof-1.bin,/tmp/fbif-load-20mb.bin:20971520:proof-2.bin,/tmp/fbif-load-20mb.bin:20971520:proof-3.bin" \
bash tests/load/mixed_oss_100.sh
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
