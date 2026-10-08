# 阿里云 CDN 接入 — FBIF 2026 注册系统

## Context

用户反馈 https://fbif2026ticket.foodtalks.cn/ "很卡"。排查发现两个问题已修复（Google Fonts 阻塞 + Caddy 未压缩），但服务器带宽仅 1Mbps（128KB/s），只能支撑 1-2 个并发。展会推广期多人同时访问会成为瓶颈，需要接入 CDN。

用户非技术背景，对 CDN 概念不熟悉，看到阿里云 DCDN "添加域名"表单不知如何填写。主要顾虑：
- CDN 到底是什么，背后逻辑是什么
- "全站加速"是什么意思
- 域名绑定了其他网站，加速这个域名会不会影响其他站点
- 前端更新后 CDN 会自动更新吗
- 能否零停机完成切换

## 交付物

### 1. HTML 解释页面（`.context/cdn-explanation.html`）

生成一个自包含的 HTML 页面，用非技术语言详细解释 CDN，帮用户建立信心。

**页面结构（11 个章节）：**

| # | 章节 | 核心内容 |
|---|------|---------|
| 1 | CDN 是什么 | 快递仓库类比：没有 CDN = 所有人去工厂取货（1Mbps 窄门）；有 CDN = 全国各地放了本地仓库 |
| 2 | 为什么需要 CDN | 1Mbps 带宽数学：1 人 2s，5 人 10s，展会推广期几百人同时点击会超时 |
| 3 | 全站加速 vs 普通 CDN | 普通 CDN 只缓存静态文件；DCDN 还优化 API 请求的网络路径（智能路由） |
| 4 | 域名隔离 | 核心关切：添加 `fbif2026ticket.foodtalks.cn` **不会**影响 `foodtalks.cn` 下其他子域名。类比：公寓楼信箱，只改你自己的邮递方式 |
| 5 | 阿里云表单怎么填 | 逐字段指引：加速域名填什么、业务类型选什么、源站 IP/协议/端口怎么填。用 HTML 模拟表单，预填正确值 |
| 6 | 前端更新后 CDN 自动更新吗 | **会**。Vite 哈希文件名机制 + `index.html` 不缓存 + CI 自动 purge。可视化流程图 |
| 7 | 零停机迁移方案 | 时间线可视化：DNS 切换期间两条路径并存，都正常工作 |
| 8 | 可能出什么问题 | 红绿灯风险表：绿色（已确认安全）、黄色（需注意）、红色（必须处理但可控） |
| 9 | 回退方案 | DNS 改回 A 记录，60 秒恢复。无需改任何服务器配置 |
| 10 | 费用 | 1 万次访问 ≈ 几元钱 |
| 11 | 操作清单 | 可勾选的 checklist |

**设计规范：**
- 自包含 HTML（无外部依赖），系统字体栈
- 配色：蓝色主色 `#1677ff`，白色卡片，柔和背景
- 响应式（可在微信里分享查看）
- CSS-only 架构图和流程图
- `<details>/<summary>` 实现 FAQ 折叠

### 2. CDN 迁移执行（本次不执行，仅计划）

代码改动仅 1 处，其余为阿里云控制台 + DNS 操作。详见下方执行步骤。

## 关键结论：前端更新后 CDN 会自动拿到新版本吗？

**会。不需要手动操作。** 原因：

```
部署前: index.html → <script src="/assets/index-ABC123.js">
部署后: index.html → <script src="/assets/index-DEF456.js">
```

1. `index.html` 在 CDN 上配置为「不缓存」（每次回源） → 用户总是拿到最新 HTML
2. Vite 构建产物使用内容哈希文件名（`index-ABC123.js`）→ 每次更新文件名不同
3. 新文件名在 CDN 上没有缓存 → CDN 自动回源拉取 → 用户拿到新版本
4. 旧文件名仍在 CDN 缓存中但不会被引用 → 30 天后自然过期

**双保险**：CI 流程已集成 `purge-cdn-cache.sh`（`.github/workflows/deploy-aliyun.yml:593-605`），每次生产部署后自动刷新 `index.html` 的 CDN 缓存。即使 CDN 意外缓存了 `index.html`，purge 也会清除。

---

## 风险评估

### 零风险项（已确认代码兼容）

| 项 | 原因 |
|---|---|
| CORS | `WEB_ORIGIN` 环境变量驱动，域名不变 |
| CSRF Cookie | `sameSite: strict` 检查域名，CNAME 不改变域名 |
| 前端 API 调用 | 使用 same-origin 相对路径 `/api/*`，不涉及域名 |
| 健康检查 | 使用 `127.0.0.1` 本地检查，不走 DNS |
| 部署流程 | SSH 直连 IP，不受 DNS 变更影响 |
| Caddy 配置 | 已有 `trusted_proxies` 信任 CDN 节点 IP |

### 需要注意的风险

| 风险 | 影响 | 概率 | 应对 |
|---|---|---|---|
| CDN 缓存规则配错（`/api/*` 被缓存） | 表单提交异常、CSRF 失败 | 低 | 按文档顺序配置 6 条规则，配完后用 curl 逐个验证 |
| CDN HTTPS 证书未配置就切 DNS | 用户访问报证书错误 | 中 | **必须**先在 CDN 配好证书再切 DNS |
| Let's Encrypt 续期失败 | 90 天后 Caddy 证书过期 | 低 | CDN 管理自己的证书，Caddy 证书变为备用；`/.well-known/*` 规则已设为不缓存 |
| `TRUST_PROXY_HOPS` 需要更新 | `req.ip` 获取到 CDN 节点 IP 而非用户 IP | 中 | 环境变量从 2 改为 3（CDN→Caddy→Nginx） |
| DNS 传播期间部分用户走旧路径 | 无影响（旧路径直连服务器正常工作） | 必然 | TTL 降到 60s，传播窗口 1-2 分钟 |

### 回退方案

DNS CNAME 改回 A 记录（`121.40.214.5`），60 秒内生效。**无需修改任何服务器配置。**

---

## 执行步骤（预计 30 分钟）

### 阶段一：准备（不影响线上）

| 步骤 | 操作 | 执行者 | 风险 |
|---|---|---|---|
| 1.1 | 确认域名 ICP 备案状态 | 你（阿里云控制台） | 无备案则 CDN 无法添加域名 |
| 1.2 | 开通阿里云全站加速 DCDN 服务 | 你（阿里云控制台） | 无 |
| 1.3 | 添加加速域名 `fbif2026ticket.foodtalks.cn`，源站 IP `121.40.214.5:443` | 你（DCDN 控制台） | 无（还没切 DNS，不影响线上） |
| 1.4 | 记录分配的 CNAME 地址（如 `xxx.w.kunlunaq.com`） | 你 | 无 |

### 阶段二：配置 CDN 规则（不影响线上）

| 步骤 | 操作 | 执行者 |
|---|---|---|
| 2.1 | 配置缓存规则（6 条，按优先级），详见 `docs/cdn-setup-guide.md` 步骤三 | 你（DCDN 控制台） |
| 2.2 | 开启 HTTPS — 申请免费 DV 证书 + 强制 HTTPS + HTTP/2 | 你（DCDN 控制台） |
| 2.3 | 确认 CDN 状态为「正常运行」 | 你 |

### 阶段三：服务器准备（不影响线上）

| 步骤 | 操作 | 执行者 |
|---|---|---|
| 3.1 | 更新 `TRUST_PROXY_HOPS` 环境变量：2 → 3 | 我来改代码 + 部署 |
| 3.2 | 配置 GitHub Secrets：`ALIYUN_CDN_ACCESS_KEY_ID`、`ALIYUN_CDN_ACCESS_KEY_SECRET`、`CDN_DOMAIN`、`CDN_OBJECT_PATHS` 等 | 你（GitHub Settings） |

### 阶段四：DNS 切换（唯一影响线上的步骤，零停机）

| 步骤 | 操作 | 预计耗时 |
|---|---|---|
| 4.1 | 降低 DNS TTL 至 60 秒 | 1 分钟操作，等待当前 TTL 过期 |
| 4.2 | 添加 CNAME 记录，删除 A 记录 | 1 分钟 |
| 4.3 | 等待 DNS 传播 | 1-2 分钟 |

**零停机原理**：
```
切换期间两条路径并存，都能正常工作：
路径A（旧DNS缓存）: 用户 → 121.40.214.5 → Caddy → 正常 ✓
路径B（新DNS解析）: 用户 → CDN → 回源 121.40.214.5 → Caddy → 正常 ✓
```

### 阶段五：验证

| 步骤 | 验证项 | 命令 |
|---|---|---|
| 5.1 | DNS 解析到 CDN | `dig fbif2026ticket.foodtalks.cn CNAME` |
| 5.2 | 静态资源 CDN 缓存命中 | `curl -I https://fbif2026ticket.foodtalks.cn/assets/index-*.js`（第二次看 X-Cache: HIT） |
| 5.3 | API 回源正常 | `curl -sf https://fbif2026ticket.foodtalks.cn/api/csrf` |
| 5.4 | Health check | `curl -sf https://fbif2026ticket.foodtalks.cn/health` |
| 5.5 | HTTPS 证书有效 | 浏览器打开确认锁图标 |
| 5.6 | 完整表单提交测试 | 打开页面填写并提交 |

完整验证命令见 `docs/cdn-setup-guide.md` 步骤六。

---

## 需要修改的文件

| 文件 | 改动 |
|---|---|
| `apps/api/src/config/env.ts` | `TRUST_PROXY_HOPS` 默认值从 2 改为 3（或通过环境变量覆盖） |

仅此一处代码改动。其余均为阿里云控制台和 DNS 操作。

---

## 关于日后前端更新的完整流程

接入 CDN 后，前端更新的部署流程**完全不变**：

```
1. 推代码到 main → 自动 preview 部署
2. 确认 preview → 手动触发生产部署
3. CI 构建新的 hash 文件名 (index-NEW.js)
4. 部署脚本切换静态文件 symlink
5. CI 自动执行 purge-cdn-cache.sh 刷新 index.html  ← 已集成
6. 用户下次访问 → 拿到新 index.html → 引用新 JS → CDN 回源 → 完成
```

你不需要做任何额外操作，CDN 刷新已经在 CI 里自动化了。

---

## 费用预估

| 计费项 | 单价 | 1 万次访问预估 |
|---|---|---|
| HTTPS 请求 | ~0.01 元/万次 | < 1 元 |
| CDN→用户流量 | 0.15 元/GB | ~0.4 元 |
| 回源流量 | 0.10 元/GB | 极少 |
| **合计** | | **几元** |

---

## 验证方案

HTML 页面生成后：
1. 在浏览器中打开 `.context/cdn-explanation.html` 确认渲染正常
2. 在手机/窄屏下确认响应式布局
3. 检查所有锚点链接、章节导航正常工作
4. 确认所有技术细节与 `docs/cdn-setup-guide.md` 一致

## 关键参考文件

| 文件 | 用途 |
|---|---|
| `docs/cdn-setup-guide.md` | 已有的详细技术操作指南，HTML 页面将简化其内容 |
| `deploy/Caddyfile.template` | 缓存策略（`/assets/*` immutable, `/*` no-store） |
| `scripts/purge-cdn-cache.sh` | CI 集成的 CDN 缓存刷新脚本 |
| `apps/api/src/config/env.ts:18` | `TRUST_PROXY_HOPS` 配置（唯一需要改的代码） |
| `.github/workflows/deploy-aliyun.yml:593-605` | 生产部署自动 purge CDN 缓存 |
