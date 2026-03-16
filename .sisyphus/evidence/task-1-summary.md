# FBIF 2026 生产基线 - 任务 1 绩效基线概要

1) 服务器硬件与运行时资源
- CPU 核心数: 4
- 总内存: 7.1 GiB
- 备注: 以上来自生产服务器的 nproc 与 free -h 输出

2) 当前 Docker 资源上限/使用情况
- 活动的 API 容器: fbif-form-api-green
- 容器 NanoCpus: 0
- 容器 Memory: 0
- 说明: 该容器未设置显式资源上限，使用宿主机默认资源

3) API 容器 Prometheus 指标快照
- 快照来源: fbif-form-api-green（推断为活动容器）
- 样例指标（截取前若干行）: 
  - process_cpu_user_seconds_total 16.357034
  - process_cpu_system_seconds_total 6.725579
  - process_resident_memory_bytes 110354432
  - process_virtual_memory_bytes 12589985792
  - process_open_fds 29
  - nodejs_eventloop_lag_mean_seconds 0.010133167443693506
- 备注: 已将完整快照保存到 .sisyphus/evidence/task-1-prometheus-baseline.txt

4) PostgreSQL max_connections
- fbif-form-postgres-1 max_connections: 100

5) 结论要点
- 目前系统在无明确资源上限的情况下运行，主机总内存充足且未达到上限
- Prometheus 快照表明 Node 进程与应用层指标在常态区间
- 需要在未来的优化中关注连接数与并发度对数据库与应用容器的影响
