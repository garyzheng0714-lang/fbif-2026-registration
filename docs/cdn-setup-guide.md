# 阿里云 CDN 配置指南 — FBIF 2026 注册系统

## 背景与架构

加入 CDN 后，前端静态资源（HTML/JS/CSS/图片）由 CDN 节点就近提供，用户不再直连源站。API 请求由 CDN 透明回源至服务器。

```
用户
  │
  ▼
阿里云 CDN (fbif2026ticket.foodtalks.cn)
  ├── /assets/*  → 缓存在 CDN（全球节点，30 天）
  ├── /*         → 不缓存，回源到 121.40.214.5
  └── /api/*     → 不缓存，回源到 121.40.214.5
                      └── Caddy → Nginx (3001) → Docker API
```

**关键点**：CDN 使用 CNAME 方式接管域名，浏览器仍认为在访问 `fbif2026ticket.foodtalks.cn`，因此 CSRF Cookie 的 `sameSite: strict` 设置不受影响，无需修改任何前端代码。

---

## 前提条件

- [ ] 域名 `fbif2026ticket.foodtalks.cn` 已完成工信部 ICP 备案
- [ ] 阿里云账号已实名认证
- [ ] 当前域名 DNS 能正常解析（确保源站可访问）
- [ ] 服务器 121.40.214.5 已正常运行，`curl -sf https://fbif2026ticket.foodtalks.cn/health` 返回 `ok`

---

## 步骤一：开通 CDN 服务

1. 登录 [阿里云控制台](https://www.aliyun.com)
2. 搜索并进入 **全站加速 DCDN** 或 **CDN** 服务
3. 点击「立即开通」，选择**按流量计费**（按需，适合展会场景）
4. 完成服务协议确认

> 推荐使用**全站加速 DCDN**（而非普通 CDN），因为 DCDN 同时加速动态请求（/api/*）的连接性能，而普通 CDN 动态请求只能透传无加速效果。

---

## 步骤二：添加加速域名

1. 进入 DCDN 控制台 → **域名管理** → **添加域名**
2. 填写配置：
   - **加速域名**: `fbif2026ticket.foodtalks.cn`
   - **业务类型**: 全站加速
   - **源站信息**:
     - 源站类型: IP
     - 源站地址: `121.40.214.5`
     - 协议: HTTPS
     - 端口: 443
3. 点击「下一步」完成添加

添加成功后，系统会分配一个 **CNAME 地址**，格式类似：`fbif2026ticket.foodtalks.cn.w.kunlunaq.com`（记录下来，DNS 切换时需要用）

---

## 步骤三：缓存规则配置（重要）

在 DCDN 控制台 → **域名管理** → 点击域名 → **缓存配置** → **缓存规则**，按以下顺序添加规则（优先级从高到低）：

| 规则 | 路径 | 缓存策略 | 说明 |
|------|------|----------|------|
| 1 | `/.well-known/*` | 不缓存（直接回源） | Let's Encrypt 证书续期 ACME 挑战 |
| 2 | `/api/*` | 不缓存（直接回源） | 动态 API 请求 |
| 3 | `/health` | 不缓存（直接回源） | 健康检查 |
| 4 | `/metrics` | 不缓存（直接回源） | Prometheus 指标 |
| 5 | `/assets/*` | 缓存 2592000 秒（30 天） | 哈希文件名静态资源 |
| 6 | `/*` | 不缓存（直接回源） | SPA index.html，需每次拉取最新版本 |

> **重要**：规则 1（`/.well-known/*`）必须不缓存。如果 CDN 缓存了 ACME 挑战响应，Caddy 的 Let's Encrypt 证书将无法自动续期，导致 HTTPS 失效。

---

## 步骤四：HTTPS 配置

1. DCDN 控制台 → **域名管理** → 点击域名 → **HTTPS 配置**
2. 点击「开启 HTTPS」
3. 证书来源选择：
   - **方案 A**（推荐）：点击「申请免费证书」，阿里云会为 CDN 域名申请 DigiCert 免费 DV 证书
   - **方案 B**：上传已有的 SSL 证书（如已购买证书）
4. 开启「强制 HTTPS」和「HTTP/2」

---

## 步骤五：DNS 切换

### 切换前准备

```bash
# 1. 查看当前 DNS TTL（切换前降低 TTL）
dig fbif2026ticket.foodtalks.cn +short
nslookup fbif2026ticket.foodtalks.cn

# 2. 在域名注册商/DNS 服务商（如阿里云解析）将 TTL 改为 60 秒
# 等待当前 TTL 时间过期（例如当前 TTL=600，等 10 分钟）
```

### 执行 DNS 切换

在域名 DNS 管理控制台（阿里云解析 / 其他 DNS 服务商）：

1. 找到 `fbif2026ticket.foodtalks.cn` 的 A 记录（当前指向 `121.40.214.5`）
2. **不要删除 A 记录**，先添加一条 CNAME 记录：
   - 主机记录: `fbif2026ticket`
   - 记录类型: `CNAME`
   - 记录值: 步骤二获得的 CDN CNAME 地址（如 `fbif2026ticket.foodtalks.cn.w.kunlunaq.com`）
3. 删除原来的 A 记录
4. 等待 DNS 生效（TTL 已改为 60 秒，约 1-2 分钟）

---

## 步骤六：验证 CDN 生效

等待 DNS 生效后，按顺序执行以下验证：

```bash
# 1. 验证 DNS 已解析到 CDN（应看到 CNAME 链）
dig fbif2026ticket.foodtalks.cn CNAME

# 2. 验证静态资源被 CDN 缓存（第二次请求应有 X-Cache: HIT 或 Age 头）
# 动态获取当前 JS 文件名
ASSET=$(ssh aliyun-prod-real "ls /var/www/fbif-form/assets/index-*.js | head -1 | xargs basename")
curl -I "https://fbif2026ticket.foodtalks.cn/assets/$ASSET"
# 再次请求，应看到 CDN 缓存命中头
curl -I "https://fbif2026ticket.foodtalks.cn/assets/$ASSET"

# 3. 验证 API 回源正常（应返回 csrfToken JSON）
curl -sf https://fbif2026ticket.foodtalks.cn/api/csrf

# 4. 验证健康检查
curl -sf https://fbif2026ticket.foodtalks.cn/health

# 5. 验证 HTTPS 证书有效
curl -vI https://fbif2026ticket.foodtalks.cn 2>&1 | grep -E "subject|issuer|expire|SSL"

# 6. 验证 CSRF + 表单提交完整流程
CSRF_TOKEN=$(curl -sc cookies.txt https://fbif2026ticket.foodtalks.cn/api/csrf | python3 -c "import sys,json; print(json.load(sys.stdin)['csrfToken'])")
curl -sb cookies.txt \
  -H "X-CSRF-Token: $CSRF_TOKEN" \
  -H "Content-Type: application/json" \
  -X POST https://fbif2026ticket.foodtalks.cn/api/submissions \
  -d '{"role":"consumer","name":"CDN测试","phone":"13800138000","idType":"cn_id","idNumber":"110101199001011234","title":"测试","company":"测试公司","clientRequestId":"cdn-test-'$(date +%s)'"}'
# 应返回 202
```

### 验证清单

- [ ] `dig ... CNAME` 显示 CDN CNAME 链
- [ ] `/assets/*.js` 第二次请求有缓存命中头（X-Cache: HIT / Age > 0）
- [ ] `/api/csrf` 返回 200 + csrfToken JSON + Set-Cookie 头完整
- [ ] `/health` 返回 `ok`
- [ ] HTTPS 证书有效，域名匹配
- [ ] 表单提交返回 202

---

## 回退方案

如果 CDN 出现问题需要快速回退：

```bash
# 1. 在 DNS 管理控制台将 CNAME 改回 A 记录：
#    主机记录: fbif2026ticket
#    记录类型: A
#    记录值: 121.40.214.5

# 2. 等待 DNS 生效（约 1 分钟，TTL=60s）

# 3. 验证直连源站正常
curl -sf https://fbif2026ticket.foodtalks.cn/health
```

回退时**无需修改任何服务器配置**，只需改 DNS 记录。

---

## 常见问题

### Q: CDN 上线后 CSRF Cookie 失效？
**A**: CDN 使用 CNAME 不改变域名，Cookie 的 `sameSite: strict` 设置不受影响。如果出现 CSRF 错误，检查：
1. CDN 是否正确透传了 `Set-Cookie` 响应头（DCDN 默认透传，确认未被过滤）
2. CDN 缓存规则是否将 `/api/*` 设为不缓存

### Q: Let's Encrypt 证书即将到期，Caddy 无法续期？
**A**: ACME HTTP-01 挑战需要访问 `/.well-known/acme-challenge/*`。确认 CDN 缓存规则中该路径设为「直接回源不缓存」。如果问题持续，可临时：
1. 将 `/.well-known/*` 规则改为绕过 CDN
2. 等 Caddy 续期成功后恢复规则

### Q: CDN 配置完成后静态资源没有缓存命中？
**A**: 
1. 检查缓存规则优先级，确认 `/assets/*` 规则优先级高于 `/*`
2. 等待第一次请求预热 CDN（冷启动无缓存）
3. 确认资源路径确实匹配 `/assets/` 前缀

### Q: DNS 切换后部分用户仍连接旧 IP？
**A**: 这是 DNS 缓存时间（TTL）导致的正常现象。切换前将 TTL 降到 60 秒，等旧 TTL 过期后用户会自动切换到 CDN。

---

## 费用参考

| 计费项 | 单价 | 预估（展会 1 万次访问） |
|--------|------|------------------------|
| HTTPS 请求次数 | ~0.01 元/万次 | < 1 元 |
| 流量（CDN→用户） | 0.15 元/GB | 前端 250KB × 1 万次 = 2.5GB ≈ 0.4 元 |
| 流量（回源） | 0.10 元/GB | API 请求 |
| **合计** | — | **几元钱** |

CDN 成本极低，而带来的前端加速和服务器负载降低效果显著。
