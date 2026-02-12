# 阿里云身份证二要素接入说明

## 接口来源
- 服务：数勋科技 - 身份证实名核验
- 地址：`GET https://sxidcheck.market.alicloudapi.com/idcard/check`
- 鉴权：`Authorization: APPCODE <AppCode>`
- 参数：`name`、`idCard`

## 本项目接入点
- 后端新增：`POST /api/id-verify`
  - 入参：`{ name, idType, idNumber }`
  - 仅 `idType=cn_id` 支持实名验证
  - 出参：`verified`、`result`、`message`、`verificationToken`
- 提交接口：`POST /api/submissions`
  - 当 `ID_VERIFY_ENABLED=true` 且 `idType=cn_id` 时，必须携带 `idVerifyToken`
  - `idVerifyToken` 为服务端签发的短期票据，防止前端绕过“先验证后提交”

## 配置项（`/apps/api/.env`）
- `ID_VERIFY_ENABLED=true`
- `ID_VERIFY_ALIYUN_HOST=https://sxidcheck.market.alicloudapi.com`
- `ID_VERIFY_ALIYUN_PATH=/idcard/check`
- `ID_VERIFY_APPCODE=<你的AppCode>`
- `ID_VERIFY_TIMEOUT_MS=5000`
- `ID_VERIFY_TOKEN_TTL_SECONDS=900`

## 前端交互建议（已按此实现）
1. 用户填写姓名、证件类型、证件号码
2. 当证件类型为身份证时，点击“验证身份证”
3. 验证通过后允许点击提交
4. 若姓名/身份证号被修改，验证状态自动失效，需重新验证
