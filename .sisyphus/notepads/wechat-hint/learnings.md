# 微信预热提示 - 实现学习记录

- 动作要点：在提交区域 submitActionBlock 内，在 FeishuButton 之前插入一个提示文本元素，文本为“💬 提交后可添加工作人员微信，获取展会最新资讯”
- 核心实现：在 App.tsx 的 submitActionBlock 中插入 <p className="submit-wechat-hint">💬 提交后可添加工作人员微信，获取展会最新资讯</p>
- CSS：在 apps/web/src/styles.css 末尾新增 .submit-wechat-hint 样式，确保文本居中且颜色与其他次要文本保持一致
- 兼容性修复：由于 FeishuPrimitives.tsx 使用了 {...rest} 传递给 button，导致 TS 类型冲突，改为 {...(rest as any)} 以兼容不同事件类型
- 验证要点：tsc --noEmit 通过；UI 按钮下方显示提示文本，行业观众与消费者表单都可见
