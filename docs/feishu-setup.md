# 飞书多维表格配置

## 必填信息
- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_APP_TOKEN`（baseid / app token）
- `FEISHU_TABLE_ID`（当前：`tbl0CQ74guMS1IDd`）

## 字段映射
默认字段名：
- 姓名
- 手机号
- 职位
- 公司
- 身份证号
- 提交时间
- 同步状态

如需使用不同字段名，请设置以下环境变量覆盖：
- `FEISHU_FIELD_NAME`
- `FEISHU_FIELD_PHONE`
- `FEISHU_FIELD_TITLE`
- `FEISHU_FIELD_COMPANY`
- `FEISHU_FIELD_ID`
- `FEISHU_FIELD_CLICK_ID`
- `FEISHU_FIELD_CLICK_ID_SOURCE_KEY`
- `FEISHU_FIELD_SUBMITTED_AT`
- `FEISHU_FIELD_SYNC_STATUS`

推荐在多维表格中新增两列文本字段：
- `腾讯广告点击ID`
- `腾讯广告点击ID来源字段`

腾讯广告归因字段、正式/测试环境表配置、字段一致性要求，统一见：
- `docs/tencent-ads-attribution-spec.md`

## 权限要求
确保应用已获得多维表格读写权限，并安装到目标租户。
