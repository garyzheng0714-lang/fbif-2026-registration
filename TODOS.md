# TODOs

- [ ] 添加管理后台，用于查看与重试 `syncStatus=FAILED` 的提交记录。
- [ ] 增加定期数据对账脚本（PostgreSQL ↔ 飞书多维表格）并接入定时 CI。

---

## P2: CDN AccessKey 权限拆分

**What:** 为 CDN 缓存清除创建独立的最小权限 RAM 用户，不复用 OSS 的 key。

**Why:** 安全最佳实践 — 如果 CI key 泄露，攻击者只能清缓存，不能访问 OSS 数据。

**Context:** 当前 CDN 清除复用 OSS AccessKey（存储在 GitHub Secrets）。CDN 正式启用后应拆分。在阿里云 RAM 控制台创建 `cdn-purge-only` 用户，仅授予 CDN 刷新权限，更新 GitHub Secrets `ALIYUN_CDN_ACCESS_KEY_ID` / `ALIYUN_CDN_ACCESS_KEY_SECRET`。

**Effort:** S | **Priority:** P2
**Depends on:** CDN 正式启用后

---

## P3: 调查 /health → /healthz rewrite 并文档化

**What:** 在 AGENTS.md 或 Caddyfile 注释中说明 Caddy rewrite /health → /healthz 的设计决策。

**Why:** Nginx 直接响应 `/healthz` 返回 "ok"（不经过 Express），这是故意的设计——外部健康检查不依赖 Express 进程。但这个逻辑没有文档说明，容易让人误删 rewrite 导致健康检查失败。

**Context:** Caddy `/health` → rewrite `/healthz` → Nginx `return 200 "ok\n"`。Express `/health` 由 Docker 容器健康检查直接访问，不经过 Caddy。

**Effort:** S | **Priority:** P3
**Depends on:** 无

---

## P3: env.ts 进一步简化 — z.preprocess 处理 boolean 字段

**What:** 用 z.preprocess 在 schema 层面处理 boolean 字段，消除 preprocessEnv 中的手动映射。

**Why:** 当前添加新的 boolean 环境变量仍需要在 preprocessEnv 中加一行。用 z.preprocess 让 schema 定义完全自包含。

**Context:** env.ts 已重构为 `envSchema.parse(preprocessEnv())`。但 `ID_VERIFY_ENABLED` 和 `FEISHU_ALERT_ENABLED` 仍需在 `preprocessEnv` 中预处理。可改为 `z.preprocess((v) => parseEnvBool(v, false), z.boolean().default(false))` 直接在 schema 中定义。

**Effort:** S | **Priority:** P3
**Depends on:** env.ts 重构完成（已完成）
