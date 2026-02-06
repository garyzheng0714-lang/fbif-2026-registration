# API 接口文档

基础路径：`/api`

## 获取 CSRF Token
`GET /api/csrf`

响应：
```json
{ "csrfToken": "..." }
```

## 提交表单
`POST /api/submissions`

Headers:
- `Content-Type: application/json`
- `X-CSRF-Token: <token>`

Body:
```json
{
  "phone": "13800000000",
  "name": "张三",
  "title": "运营负责人",
  "company": "飞书科技有限公司",
  "idNumber": "110101199003071234"
}
```

响应：
```json
{ "id": "uuid", "syncStatus": "PENDING" }
```

## 查询同步状态
`GET /api/submissions/:id/status`

响应：
```json
{
  "id": "uuid",
  "syncStatus": "PENDING|SUCCESS|FAILED",
  "syncError": "...",
  "feishuRecordId": "...",
  "createdAt": "2026-02-06T08:00:00.000Z"
}
```
