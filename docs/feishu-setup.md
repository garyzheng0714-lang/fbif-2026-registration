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
- `FEISHU_FIELD_SUBMITTED_AT`
- `FEISHU_FIELD_SYNC_STATUS`

## 权限要求
确保应用已获得多维表格读写权限，并安装到目标租户。
