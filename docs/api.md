# A2A 接口

## Agent API

默认地址：`http://127.0.0.1:8080`。

### 查询 Agent

`POST /api/v1/agent/query`

```json
{
  "message": "查询工单3"
}
```

成功响应包含 `traceId`、结果类型、业务消息，以及可选的工单和审核任务号。调用方可以传入 `X-Request-Id` 作为 Trace ID；配置 `AGENT_API_KEY` 后还必须携带 `X-API-Key`。

```json
{
  "traceId": "e9eef2ea-1f6d-46c5-b459-0a5eed68bc94",
  "type": "manual_review_required",
  "message": "工单 3 已进入人工审核队列",
  "ticket": {
    "id": 3,
    "title": "服务器采购",
    "amount": 2000,
    "status": "待审核"
  },
  "taskId": "5853d4f8-7871-4adc-8876-3bb47971693d"
}
```

Agent API 同样提供 `/health/live` 和 `/health/ready`。

## 审核 A2A API

默认内部地址：`http://127.0.0.1:8090`。

## 创建审核任务

`POST /a2a/task`

请求：

```json
{
  "task": "ticket_audit",
  "traceId": "e9eef2ea-1f6d-46c5-b459-0a5eed68bc94",
  "ticket": {
    "id": 3,
    "title": "服务器采购",
    "amount": 2000,
    "status": "待审核"
  }
}
```

成功响应：HTTP `202 Accepted`

```json
{
  "taskId": "5853d4f8-7871-4adc-8876-3bb47971693d",
  "traceId": "e9eef2ea-1f6d-46c5-b459-0a5eed68bc94",
  "status": "manual_review_required",
  "message": "工单 3 已进入人工审核队列"
}
```

参数错误：HTTP `400 Bad Request`

```json
{
  "code": "INVALID_AUDIT_TASK",
  "message": "审核任务参数不合法"
}
```

## 健康检查

### `GET /health/live`

确认 Node.js 进程存活，不访问数据库。

### `GET /health/ready`

执行 `SELECT 1` 检查 MySQL。正常返回 200；数据库不可用时返回 503。

## Agent Card

`GET /.well-known/agent-card` 返回审核 Agent 的标识、描述和技能信息。

## 错误约定

错误使用稳定的 `code` 供程序判断，并使用 `message` 展示通用说明。响应不会暴露 SQL、密码、内部路径或异常堆栈。
