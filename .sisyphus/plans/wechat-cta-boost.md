# 加好友引导优化 — 三层转化漏斗提升微信添加率

## TL;DR

> **Quick Summary**: 通过三层递进式引导（表单预热→提交后弹窗→成功页强化），显著提升用户提交后添加工作人员微信的转化率。纯前端改动，仅涉及 App.tsx + styles.css。
> 
> **Deliverables**:
> - Layer 1: 表单提交按钮上方的微信预热提示条
> - Layer 2: 提交成功后的半屏底部抽屉弹窗（含大 QR + 价值清单 + 一键复制微信号）
> - Layer 3: 成功页现有 QR 卡片视觉强化 + 复制微信号按钮
> - 预览截图（移动端 + 桌面端）
> 
> **Estimated Effort**: Short
> **Parallel Execution**: YES - 2 waves
> **Critical Path**: Task 1 → Task 2 → Task 3 → Task 4 → Task 5

---

## Context

### Original Request
用户希望让 FBIF 2026 注册表单的"加好友引导参会参展"更加显著，提高转化率，并需要预览效果。

### Interview Summary
**Key Discussions**:
- 当前 QR 卡片仅在成功页底部，视觉弱（120px QR、12px 标题、浅蓝背景）
- 用户选择全链路优化方案（三层递进漏斗）
- 文案统一（不区分行业/消费者角色），温和服务型风格
- 弹窗可直接关闭，不强制延迟
- 纯前端改动，不加社交证明

**Research Findings**:
- 当前 QR 代码位于 App.tsx 第 2661-2679 行，样式在 styles.css 第 3433-3519 行
- 成功页结构：hero → steps → notice(consumer only) → QR card → bottom CTA
- `submitActionBlock` 在两种角色表单中共用（行业=line 2405, 消费者=line 2564）
- 已有 FeishuDialog 覆盖层模式可参考（z-index:100、focus trap、Escape 关闭）
- 已有 lightbox 放大机制（qrZoomed state + native dialog）

### Metis Review
**Identified Gaps** (addressed):
- 剪贴板 API 在 HTTP 预览环境可能失败 → 加 `document.execCommand('copy')` 降级方案
- iOS Safari 安全区域 → 底部弹窗加 `env(safe-area-inset-bottom)` 内边距
- 弹窗打开时页面滚动 → 加 body overflow:hidden 锁定
- `prefers-reduced-motion` 支持 → 底部弹窗动画需加入无障碍媒体查询
- 快速连点复制按钮 → 需加防抖或状态守卫

---

## Work Objectives

### Core Objective
通过三层递进式引导，让用户在注册流程的关键触点上看到"添加微信"的价值引导，从而显著提高微信添加转化率。

### Concrete Deliverables
- `apps/web/src/App.tsx` — 新增 Layer 1 提示条 JSX、Layer 2 底部弹窗 JSX、Layer 3 卡片增强 JSX
- `apps/web/src/styles.css` — 新增对应样式（底部弹窗动画、响应式、无障碍）
- 移动端 (375px) + 桌面端 (1440px) 预览截图

### Definition of Done
- [ ] 三层引导全部可见且功能正常
- [ ] `tsc --noEmit` 零报错（在 `apps/web` 目录执行）
- [ ] 移动端 375px 和桌面端均正常渲染
- [ ] 复制微信号功能可用且有视觉反馈
- [ ] 用户收到预览截图或预览链接

### Must Have
- 表单提交按钮上方的微信预热提示（Layer 1）
- 提交成功后自动弹出的底部抽屉（Layer 2）
- 底部抽屉含大 QR 码（~200px）、价值列表、复制微信号按钮
- 成功页 QR 卡片标题更新 + 复制微信号按钮（Layer 3）
- 底部抽屉可点击背景/关闭按钮/Escape 键关闭
- 剪贴板复制失败的降级处理
- iOS 安全区域适配
- `prefers-reduced-motion` 无障碍支持
- 预览效果（截图或链接）

### Must NOT Have (Guardrails)
- **不修改** 表单提交逻辑（onSubmit、submit() 函数、API 调用）
- **不修改** 页面状态类型（'identity' | 'form' | 'submitted'）— 底部弹窗是覆盖层，不是新页面
- **不添加** npm 依赖（不引入 framer-motion / react-spring / bottom-sheet 库）
- **不重构** 现有 success-qr-inline 为独立组件 — 保持内联在 App.tsx
- **不添加** 社交证明、倒计时器、任何转化暗模式
- **不触碰** FeishuPrimitives.tsx 或其他组件文件
- **不触碰** 后端代码、API 路由、数据模型
- **不修改** 现有 QR lightbox dialog 行为（App.tsx 第 2704-2710 行）
- **不修改** 成功页面其他区域的布局（steps、hero、notice 保持原样）
- **不添加** 事件追踪或 analytics 代码
- **不给文案添加** 紧迫感或促销风格 — 温和服务型

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES (vitest in apps/web)
- **Automated tests**: None for this task (纯 UI 视觉改动，用 Playwright QA 验证)
- **Framework**: N/A

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Frontend/UI**: Use Playwright — Navigate, interact, assert DOM, screenshot
- **Clipboard**: Use Playwright evaluate — Copy and verify clipboard content

---

## Execution Strategy

### Parallel Execution Waves

> 所有任务都修改 App.tsx + styles.css，因此必须严格顺序执行避免冲突。
> 但逻辑上每层独立，每个任务有清晰边界。

```
Wave 1 (Sequential — core implementation):
├── Task 1: Layer 1 — 表单预热提示条 [quick]
├── Task 2: Layer 2 — 底部抽屉弹窗 + 复制功能 [visual-engineering]
└── Task 3: Layer 3 — 成功页 QR 卡片增强 [quick]

Wave 2 (After Wave 1 — verification + preview):
├── Task 4: TypeScript 验证 + Playwright 全量截图 [quick]
└── Task 5: 预览链接或截图交付 [quick]

Critical Path: Task 1 → Task 2 → Task 3 → Task 4 → Task 5
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|-----------|--------|------|
| 1 | — | 2 | 1 |
| 2 | 1 | 3 | 1 |
| 3 | 2 | 4 | 1 |
| 4 | 3 | 5 | 2 |
| 5 | 4 | — | 2 |

### Agent Dispatch Summary

- **Wave 1**: 3 tasks → T1 `quick`, T2 `visual-engineering`, T3 `quick`
- **Wave 2**: 2 tasks → T4 `quick`, T5 `quick`

---

## TODOs

- [x] 1. Layer 1 — 表单预热提示条

  **What to do**:
  - 在 `submitActionBlock` 内、提交按钮 `<FeishuButton>` 之前添加一行轻量微信提示
  - JSX 结构：`<p className="submit-wechat-hint">💬 提交后可添加工作人员微信，获取展会最新资讯</p>`
  - 添加对应 CSS 类 `.submit-wechat-hint`，风格为：11.5px 字号、`var(--muted)` 颜色、居中对齐、上方 8px 间距
  - 提示条对行业观众和消费者均可见（submitActionBlock 在两个表单中共用）

  **Must NOT do**:
  - 不修改提交按钮本身的逻辑或样式
  - 不使用 emoji 以外的图标（保持轻量）
  - 不添加条件渲染（始终显示）

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 单一小改动，~10 行 JSX + ~15 行 CSS
  - **Skills**: []
    - No special skills needed

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 1, Sequential position 1
  - **Blocks**: Task 2
  - **Blocked By**: None

  **References** (CRITICAL):

  **Pattern References**:
  - `apps/web/src/App.tsx` 行 1919-1963 — `submitActionBlock` 定义区域。提示条应插入在 `<p className="notice">` 条件渲染之后、`<FeishuButton>` 之前
  - `apps/web/src/App.tsx` 行 2405 — 行业表单中 `{submitActionBlock}` 的使用位置
  - `apps/web/src/App.tsx` 行 2564 — 消费者表单中 `{submitActionBlock}` 的使用位置

  **API/Type References**:
  - 无（纯 JSX + CSS）

  **Test References**:
  - 无（Playwright QA 覆盖）

  **External References**:
  - 无

  **WHY Each Reference Matters**:
  - `submitActionBlock` 是两种角色表单共享的提交区域，在此处添加一次即可覆盖两种流程
  - 需要准确找到 `<FeishuButton>` 之前的位置插入，避免影响提交逻辑

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 行业观众表单可见提示条
    Tool: Playwright
    Preconditions: Dev server running (npm run dev in apps/web), mock-api running
    Steps:
      1. Navigate to http://localhost:5173
      2. Click role card for "行业观众"
      3. Scroll to bottom of form to the submit area
      4. Assert element `.submit-wechat-hint` exists and is visible
      5. Assert text contains "提交后可添加工作人员微信"
      6. Take screenshot at 375px width
      7. Take screenshot at 1440px width
    Expected Result: Hint text visible above submit button, muted gray color, centered
    Failure Indicators: Element not found, text not matching, hint not visible in viewport
    Evidence: .sisyphus/evidence/task-1-industry-form-hint-mobile.png, .sisyphus/evidence/task-1-industry-form-hint-desktop.png

  Scenario: 消费者表单同样可见提示条
    Tool: Playwright
    Preconditions: Same as above
    Steps:
      1. Navigate to http://localhost:5173
      2. Click role card for "消费者"
      3. Scroll to submit area
      4. Assert element `.submit-wechat-hint` exists and is visible
      5. Assert text contains "提交后可添加工作人员微信"
    Expected Result: Same hint visible for consumer form
    Failure Indicators: Element missing or different text
    Evidence: .sisyphus/evidence/task-1-consumer-form-hint.png
  ```

  **Commit**: YES
  - Message: `feat: add pre-submit WeChat hint above submit button`
  - Files: `apps/web/src/App.tsx`, `apps/web/src/styles.css`
  - Pre-commit: `cd apps/web && npx tsc --noEmit`

- [x] 2. Layer 2 — 底部抽屉弹窗（核心转化点）

  **What to do**:

  **State & Trigger:**
  - 在 App.tsx 第 888 行附近（现有 `qrZoomed` state 旁边）添加新 state：`const [showQrSheet, setShowQrSheet] = useState(false)`
  - 在提交成功的 `setPage('submitted')` 调用处（约第 1825 行），同时设置 `setShowQrSheet(true)`
  - 添加复制状态：`const [wechatCopied, setWechatCopied] = useState(false)`

  **Bottom Sheet JSX (在 `page === 'submitted'` 区域之后、qr-lightbox dialog 之前):**
  ```
  结构:
  {showQrSheet && (
    <div className="qr-sheet-overlay" onClick={() => setShowQrSheet(false)}>
      <div className="qr-sheet" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="添加微信获取展会资讯">
        <button className="qr-sheet-close" onClick={() => setShowQrSheet(false)} aria-label="关闭">×</button>
        <div className="qr-sheet-content">
          <h2 className="qr-sheet-title">添加微信，获取展会资讯</h2>
          <p className="qr-sheet-subtitle">添加 FBIF 工作人员 Carrie 的微信</p>
          <img className="qr-sheet-qr" src={CARRIE_WECHAT_QR_URL} alt="Carrie 微信二维码" />
          <ul className="qr-sheet-benefits">
            <li>获取最新展会资讯与日程安排</li>
            <li>入场指引及电子门票提醒</li>
            <li>参展商名录抢先看</li>
          </ul>
          <button className="qr-sheet-copy" onClick={handleCopyWechat}>
            {wechatCopied ? '已复制 ✓' : '复制微信号：lovelyFBIFer1'}
          </button>
          <button className="qr-sheet-dismiss" onClick={() => setShowQrSheet(false)}>我知道了</button>
        </div>
      </div>
    </div>
  )}
  ```

  **Clipboard Copy Handler:**
  ```
  async function handleCopyWechat() {
    const wechatId = 'lovelyFBIFer1';
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(wechatId);
      } else {
        // HTTP fallback
        const ta = document.createElement('textarea');
        ta.value = wechatId;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setWechatCopied(true);
      setTimeout(() => setWechatCopied(false), 2000);
    } catch {
      // silent fail — 用户可手动复制
    }
  }
  ```

  **Escape Key & Body Scroll Lock:**
  - 在 sheet 打开时监听 Escape 键关闭（useEffect + keydown listener）
  - 打开时设置 `document.body.style.overflow = 'hidden'`，关闭时恢复

  **CSS 样式 (追加到 styles.css 末尾):**
  - `.qr-sheet-overlay`: fixed 全屏、z-index:100、背景 rgba(0,0,0,0.5)、flex 居中底部
  - `.qr-sheet`: 白色容器、圆角顶部 16px、底部 0、slide-up 动画、max-width:480px、padding 含 `env(safe-area-inset-bottom)`
  - `.qr-sheet-qr`: 200px × 200px、居中、圆角、白色背景
  - `.qr-sheet-copy`: 主色按钮、全宽、44px 高、复制成功时变绿
  - `.qr-sheet-dismiss`: 透明文字按钮、"我知道了"
  - `.qr-sheet-benefits`: 无序列表、绿色 ✓ 前缀伪元素
  - `@keyframes qr-sheet-slide-up`: from translateY(100%) to translateY(0)
  - `@media (prefers-reduced-motion: reduce)`: 禁用 slide 动画
  - 响应式：375px 时 sheet 占 ~65% 视口高度；桌面时居中 max-width:480px

  **Must NOT do**:
  - 不使用 FeishuDialog 组件 — 自建轻量覆盖层（FeishuDialog 是表单提交用的，不要混用）
  - 不添加 npm 依赖
  - 不修改 page state 类型
  - 不给 QR 图片加 onClick 放大（弹窗里 QR 已经够大）
  - 不添加 re-show 机制（关闭即永久关闭）

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: 涉及 CSS 动画、响应式布局、底部抽屉 UX 模式
  - **Skills**: [`frontend-ui-ux`]
    - `frontend-ui-ux`: 需要精准的 UI 实现，底部抽屉是常见但细节多的移动端模式

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 1, Sequential position 2
  - **Blocks**: Task 3
  - **Blocked By**: Task 1

  **References** (CRITICAL):

  **Pattern References**:
  - `apps/web/src/App.tsx` 行 888 附近 — 现有 `qrZoomed` state 定义处，新 state 应放在旁边
  - `apps/web/src/App.tsx` 行 1825 附近 — `setPage('submitted')` 调用处，需同时 `setShowQrSheet(true)`
  - `apps/web/src/App.tsx` 行 56-57 — `CARRIE_WECHAT_QR_URL` 常量定义，复用此 URL
  - `apps/web/src/styles.css` 行 3487-3519 — 现有 `qr-lightbox` 遮罩样式，可参考 z-index 和 backdrop 模式
  - `apps/web/src/App.tsx` 行 2694 附近 — `page === 'submitted'` 区块结尾，底部弹窗 JSX 应插入此处之后

  **API/Type References**:
  - 无新类型（useState<boolean> 即可）

  **External References**:
  - Clipboard API: `navigator.clipboard.writeText()` — 需 secure context
  - `window.isSecureContext` — 判断是否支持 clipboard API
  - `env(safe-area-inset-bottom)` — iOS Safari 安全区域

  **WHY Each Reference Matters**:
  - `qrZoomed` state 旁边放新 state 保持代码组织一致性
  - `setPage('submitted')` 是唯一触发成功页的地方，在此同步触发弹窗
  - 复用 `CARRIE_WECHAT_QR_URL` 避免硬编码重复
  - `qr-lightbox` 的 z-index 和遮罩模式可作为新弹窗的参考基准

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 提交成功后底部弹窗自动弹出
    Tool: Playwright
    Preconditions: Dev server + mock-api running
    Steps:
      1. Navigate to http://localhost:5173
      2. Select "行业观众" role
      3. Fill required fields with test data (name: "测试用户", company: "测试公司", etc.)
      4. Accept policy checkbox
      5. Click submit button "领取观展票"
      6. Wait for page to transition to success state (wait for element `.success-hero-title`)
      7. Assert element `.qr-sheet-overlay` exists and is visible
      8. Assert element `.qr-sheet` is visible with slide-up animation completed
      9. Assert `.qr-sheet-title` text is "添加微信，获取展会资讯"
      10. Assert `.qr-sheet-qr` img src matches CARRIE_WECHAT_QR_URL
      11. Assert `.qr-sheet-copy` button is visible
      12. Take screenshot at 375px width
      13. Take screenshot at 1440px width
    Expected Result: Bottom sheet slides up with QR code, title, benefits list, and copy button
    Failure Indicators: Overlay not appearing, sheet not animated, QR image broken, missing elements
    Evidence: .sisyphus/evidence/task-2-sheet-open-mobile.png, .sisyphus/evidence/task-2-sheet-open-desktop.png

  Scenario: 点击背景/关闭按钮/Escape 可关闭弹窗
    Tool: Playwright
    Preconditions: Bottom sheet is open (after form submission)
    Steps:
      1. With sheet open, press Escape key
      2. Assert `.qr-sheet-overlay` is no longer visible
      3. Assert success page content (`.success-hero`) is visible behind
      4. Take screenshot showing success page after sheet dismissed
    Expected Result: Sheet dismissed, success page fully visible
    Failure Indicators: Sheet still visible, success page hidden or broken
    Evidence: .sisyphus/evidence/task-2-sheet-dismissed.png

  Scenario: 复制微信号功能 — 成功路径
    Tool: Playwright
    Preconditions: Bottom sheet is open
    Steps:
      1. Click `.qr-sheet-copy` button
      2. Assert button text changes to "已复制 ✓"
      3. Execute `navigator.clipboard.readText()` in page context
      4. Assert clipboard content equals "lovelyFBIFer1"
      5. Wait 2.5 seconds
      6. Assert button text reverts to "复制微信号：lovelyFBIFer1"
    Expected Result: WeChat ID copied to clipboard, button shows feedback for ~2s
    Failure Indicators: Clipboard empty, button text not changing, feedback not reverting
    Evidence: .sisyphus/evidence/task-2-copy-success.png

  Scenario: iOS 安全区域 + 页面不可滚动
    Tool: Playwright
    Preconditions: Bottom sheet is open
    Steps:
      1. With sheet open, evaluate `document.body.style.overflow` — assert "hidden"
      2. Evaluate `getComputedStyle(document.querySelector('.qr-sheet')).paddingBottom`
      3. Assert padding includes safe-area or fallback value
      4. Close sheet, assert `document.body.style.overflow` is restored (empty or "auto")
    Expected Result: Body scroll locked while open, safe area padding applied
    Failure Indicators: Page scrollable behind sheet, no bottom padding
    Evidence: .sisyphus/evidence/task-2-scroll-lock.txt
  ```

  **Commit**: YES
  - Message: `feat: add bottom sheet with QR code on submission success`
  - Files: `apps/web/src/App.tsx`, `apps/web/src/styles.css`
  - Pre-commit: `cd apps/web && npx tsc --noEmit`

- [x] 3. Layer 3 — 成功页 QR 卡片增强

  **What to do**:
  - 修改 `.success-qr-inline-title` 文案：从 "联系工作人员" 改为 "添加微信 · 获取展会资讯"
  - 在微信号文字 `<p className="success-qr-inline-wechat">` 旁边或下方，添加 "复制微信号" 按钮
  - 按钮复用 Task 2 的 `handleCopyWechat` 函数（如果函数已定义为组件级，直接复用；否则提取为共享内联函数）
  - 增加复制状态显示（可复用 Task 2 的 `wechatCopied` state）
  - 微调 CSS 增强视觉权重：
    - 背景色从 `rgba(15, 95, 194, 0.04)` 调整为微信绿调 `rgba(7, 193, 96, 0.06)` 或稍浓的蓝色
    - 边框色加强
    - 标题字号从 12px 提升到 13px
    - 复制按钮样式：紧凑型按钮、主色或绿色
  - 修改引导描述文案（`.success-qr-inline-desc`）：从 "注册成功后，工作人员将添加您的微信，同步入场相关资讯" 改为 "长按二维码或截图保存，用微信扫一扫添加"

  **Must NOT do**:
  - 不改变 QR 卡片的 DOM 位置（保持在 steps 和 bottom CTA 之间）
  - 不修改 QR 图片的 click-to-zoom lightbox 行为
  - 不修改 QR 图片 URL

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 小范围文案替换 + CSS 微调 + 按钮添加，~15 行 JSX + ~30 行 CSS
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 1, Sequential position 3
  - **Blocks**: Task 4
  - **Blocked By**: Task 2 (复用 handleCopyWechat + wechatCopied state)

  **References** (CRITICAL):

  **Pattern References**:
  - `apps/web/src/App.tsx` 行 2661-2679 — 现有 QR inline 卡片完整 JSX
  - `apps/web/src/App.tsx` 行 2662 — `<h3 className="success-qr-inline-title">联系工作人员</h3>` — 需替换文案
  - `apps/web/src/App.tsx` 行 2675 — `<p className="success-qr-inline-wechat">微信：lovelyFBIFer1</p>` — 复制按钮添加在此附近
  - `apps/web/src/App.tsx` 行 2676 — `<p className="success-qr-inline-desc">` — 需替换描述文案
  - `apps/web/src/styles.css` 行 3433-3485 — 现有 QR 卡片样式
  - `apps/web/src/styles.css` 行 3466-3481 — info 区域文字样式

  **WHY Each Reference Matters**:
  - 行 2662 是标题文案的精确位置，直接字符串替换
  - 行 2675 旁边是复制按钮的最佳插入点
  - CSS 行 3433 的背景色和边框色需要微调

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 成功页 QR 卡片标题和文案已更新
    Tool: Playwright
    Preconditions: Already on success page (after form submission, bottom sheet dismissed)
    Steps:
      1. Assert `.success-qr-inline-title` text is "添加微信 · 获取展会资讯"
      2. Assert `.success-qr-inline-desc` text contains "长按二维码" or "截图保存"
      3. Assert a copy button exists within `.success-qr-inline` section
      4. Take screenshot at 375px
      5. Take screenshot at 1440px
    Expected Result: Updated title, updated description, copy button visible
    Failure Indicators: Old text "联系工作人员" still present, copy button missing
    Evidence: .sisyphus/evidence/task-3-enhanced-card-mobile.png, .sisyphus/evidence/task-3-enhanced-card-desktop.png

  Scenario: 卡片内复制微信号功能
    Tool: Playwright
    Preconditions: On success page, QR card visible
    Steps:
      1. Find and click the copy button within `.success-qr-inline`
      2. Assert button shows "已复制 ✓" feedback
      3. Verify clipboard contains "lovelyFBIFer1"
    Expected Result: Same copy behavior as bottom sheet
    Failure Indicators: Copy failed, no feedback
    Evidence: .sisyphus/evidence/task-3-card-copy.png

  Scenario: QR 图片点击放大仍然有效
    Tool: Playwright
    Preconditions: On success page
    Steps:
      1. Click `.success-qr-inline-image`
      2. Assert `dialog.qr-lightbox[open]` is visible
      3. Assert `.qr-lightbox-image` src matches CARRIE_WECHAT_QR_URL
      4. Click to close lightbox
    Expected Result: Existing lightbox zoom behavior preserved
    Failure Indicators: Lightbox broken, image not showing
    Evidence: .sisyphus/evidence/task-3-lightbox-preserved.png
  ```

  **Commit**: YES
  - Message: `feat: enhance success page QR card with value copy`
  - Files: `apps/web/src/App.tsx`, `apps/web/src/styles.css`
  - Pre-commit: `cd apps/web && npx tsc --noEmit`

- [x] 4. TypeScript 验证 + 全量 Playwright 截图

  **What to do**:
  - 运行 `cd apps/web && npx tsc --noEmit` — 确认零 TypeScript 错误
  - 运行 `cd apps/web && npm run build` — 确认生产构建成功
  - 启动 dev server + mock-api
  - 使用 Playwright 完整走一遍注册流程（选角色→填表→提交→看弹窗→关弹窗→看成功页）
  - 在 375px 和 1440px 分别截取完整流程截图
  - 确认无视觉回归：表单页、身份选择页外观无变化

  **Must NOT do**:
  - 不修改任何代码
  - 不添加新文件

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 纯验证任务，运行命令 + 截图
  - **Skills**: [`playwright-interactive`]
    - `playwright-interactive`: 需要浏览器交互截图

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2, Sequential position 1
  - **Blocks**: Task 5
  - **Blocked By**: Task 3

  **References**:

  **Pattern References**:
  - `apps/web/package.json` — 确认 `tsc` 和 `build` 命令
  - `apps/mock-api/` — mock API 用于本地表单提交

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: TypeScript + 构建验证
    Tool: Bash
    Steps:
      1. Run `cd apps/web && npx tsc --noEmit`
      2. Assert exit code 0, no error output
      3. Run `cd apps/web && npm run build`
      4. Assert exit code 0, dist directory created
    Expected Result: Zero errors
    Evidence: .sisyphus/evidence/task-4-tsc-build.txt

  Scenario: 完整注册流程截图（移动端 375px）
    Tool: Playwright
    Preconditions: Dev server + mock-api running
    Steps:
      1. Set viewport to 375x812
      2. Navigate to http://localhost:5173
      3. Screenshot: identity selection page
      4. Select "行业观众"
      5. Fill form with test data, submit
      6. Screenshot: bottom sheet open
      7. Close bottom sheet
      8. Screenshot: success page with enhanced QR card
    Expected Result: Full flow screenshots captured
    Evidence: .sisyphus/evidence/task-4-flow-mobile-*.png

  Scenario: 完整注册流程截图（桌面 1440px）
    Tool: Playwright
    Preconditions: Same as above
    Steps:
      1. Set viewport to 1440x900
      2. Repeat same flow as mobile
      3. Capture screenshots at each step
    Expected Result: Full flow screenshots captured
    Evidence: .sisyphus/evidence/task-4-flow-desktop-*.png

  Scenario: 无视觉回归检查
    Tool: Playwright
    Steps:
      1. Navigate to identity selection page
      2. Screenshot and compare — page layout unchanged
      3. Navigate to form page (don't submit)
      4. Screenshot form area — only the new hint line is different
    Expected Result: No unintended visual changes outside the 3 layers
    Evidence: .sisyphus/evidence/task-4-regression-*.png
  ```

  **Commit**: NO (verification only)

- [x] 5. 预览交付

  **What to do**:
  - 使用 `local-tunnel` skill 通过 cloudflared 建立隧道，暴露本地 dev server
  - 或者：将截图整理后直接展示给用户
  - 确认 Vite 配置中 `server.allowedHosts: true`，否则外部域名会被拦截
  - 将隧道 URL 或截图集返回给用户查看

  **Must NOT do**:
  - 不使用 localtunnel (lt)，会弹密码验证页
  - 不部署到生产或 preview 环境

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 仅启动隧道或整理截图
  - **Skills**: [`local-tunnel`]
    - `local-tunnel`: cloudflared 隧道建立

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2, Sequential position 2
  - **Blocks**: None
  - **Blocked By**: Task 4

  **References**:

  **Pattern References**:
  - `apps/web/vite.config.ts` — 确认 `server.allowedHosts` 配置

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: 预览可访问
    Tool: Playwright / Bash
    Steps:
      1. Confirm dev server running at localhost:5173
      2. Either: start cloudflared tunnel and verify tunnel URL accessible
      3. Or: present the Task 4 screenshots to user
    Expected Result: User can see the changes via link or screenshots
    Evidence: .sisyphus/evidence/task-5-preview-url.txt or screenshots from Task 4
  ```

  **Commit**: NO (delivery only)

---

## Final Verification Wave

> 无独立 Final Verification Wave — Task 4 和 Task 5 已覆盖全量验证 + 预览交付。
> 此项目范围小（2 文件改动），不需要 4 路并行审计。

---

## Commit Strategy

| # | Message | Files | Pre-commit |
|---|---------|-------|------------|
| 1 | `feat: add pre-submit WeChat hint above submit button` | App.tsx, styles.css | `tsc --noEmit` |
| 2 | `feat: add bottom sheet with QR code on submission success` | App.tsx, styles.css | `tsc --noEmit` |
| 3 | `feat: enhance success page QR card with value copy` | App.tsx, styles.css | `tsc --noEmit` |

---

## Success Criteria

### Verification Commands
```bash
cd apps/web && npx tsc --noEmit  # Expected: no errors
cd apps/web && npm run build     # Expected: build success
```

### Final Checklist
- [ ] Layer 1 提示条在行业/消费者表单中均可见
- [ ] Layer 2 底部弹窗在提交后自动弹出
- [ ] Layer 2 弹窗可通过背景/按钮/Escape 关闭
- [ ] Layer 2 + Layer 3 复制微信号功能正常（含 HTTP 降级）
- [ ] Layer 3 QR 卡片标题更新、视觉增强
- [ ] 移动端 (375px) 全流程正常
- [ ] 桌面端全流程正常
- [ ] tsc --noEmit 零报错
- [ ] 预览已交付给用户
