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

### Agent 发现

标准 Agent Card：`GET /.well-known/agent-card.json`

Card 声明 A2A `1.0`、`JSONRPC` 绑定、服务地址、输入输出媒体类型和 `ticket-audit` Skill。主 Agent 使用官方 `ClientFactory` 读取 Card 并选择传输，不再硬编码自定义任务接口。

### 创建审核任务

协议端点：`POST /a2a`

调用方法为 A2A 1.0 `SendMessage`。正常业务代码应使用 `@a2a-js/sdk`，下面仅展示线上的 JSON-RPC 形态：

```json
{
  "jsonrpc": "2.0",
  "id": "request-1",
  "method": "SendMessage",
  "params": {
    "message": {
      "messageId": "message-1",
      "role": "ROLE_USER",
      "parts": [{
        "data": {
          "task": "ticket_audit",
          "traceId": "e9eef2ea-1f6d-46c5-b459-0a5eed68bc94",
          "ticket": {"id": 3, "title": "服务器采购", "amount": 2000, "status": "待审核"}
        },
        "mediaType": "application/json"
      }]
    },
    "configuration": {
      "acceptedOutputModes": ["application/json"],
      "returnImmediately": false
    }
  }
}
```

HTTP 请求必须携带 `A2A-Version: 1.0`。成功结果是标准 Task，生命周期为：

```text
SUBMITTED -> WORKING -> COMPLETED
```

最终 Artifact 的 `application/json` DataPart 包含：

```json
{
  "taskId": "5853d4f8-7871-4adc-8876-3bb47971693d",
  "traceId": "e9eef2ea-1f6d-46c5-b459-0a5eed68bc94",
  "status": "manual_review_required",
  "message": "工单 3 已进入人工审核队列"
}
```

这里 Task 的 `COMPLETED` 表示委派动作已经执行完成，Artifact 中的 `manual_review_required` 才是工单的业务审核状态。参数不合法时 Task 进入 `REJECTED`。

## 健康检查

### `GET /health/live`

确认 Node.js 进程存活，不访问数据库。

### `GET /health/ready`

执行 `SELECT 1` 检查 MySQL。正常返回 200；数据库不可用时返回 503。

## 错误约定

A2A 协议错误由官方 SDK 按标准 JSON-RPC 错误返回；业务拒绝通过 Task 状态和 Message 表达。响应不会暴露 SQL、密码、内部路径或异常堆栈。
