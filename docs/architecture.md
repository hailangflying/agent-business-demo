# 架构说明

## 设计原则

1. LLM 负责理解语言，不负责最终业务裁决。
2. 领域规则保持确定性、无框架依赖并可独立测试。
3. MCP 用于受控工具访问，A2A 用于跨 Agent 任务委派。
4. 外部输入必须在边界层完成运行时校验。
5. 所有审核任务必须可追踪、可持久化，不以自然语言回复代替业务状态。

## 组件职责

### 主 Agent

`src/application/agent-service.ts` 是可复用流程编排核心。HTTP 和 CLI 共享该服务。它负责生成 Trace ID、调用 Ollama、校验模型输出、查询工单和调用领域策略，但不直接访问数据库。

AgentService 启动时建立两个 MCP 连接，后续请求复用连接；进程关闭时统一释放。这样避免线上每个请求重复创建子进程。

### 业务入口

`src/api/agent-api-server.ts` 暴露业务 HTTP API；`src/cli/agent-cli.ts` 提供本地交互入口。两者都不包含业务判断，只负责协议转换和生命周期管理。

### 文件 MCP

`src/mcp/file-server.ts` 只负责读取知识库文件。文件名和解析后的绝对路径都会被检查，防止调用方通过 `../` 读取项目外文件。

### 数据库 MCP

`src/mcp/sql-server.ts` 暴露 `query_ticket` 工具。它只执行预定义、参数化的查询，并把结果包装为 `{found, ticket}`，不接受任意 SQL。

### 工单领域

`src/domain/ticket.ts` 包含工单模型和金额审核规则。金额达到阈值时返回 `manual_review_required`；该规则不依赖模型输出。

### 审核 Agent

`src/a2a/audit-agent-server.ts` 接收结构化 A2A 请求，创建审核任务并返回 HTTP 202。当前服务不会自动批准，只把任务置为 `manual_review_required`。

### MySQL

`tickets` 保存工单；`audit_tasks` 保存审核任务；`schema_migrations` 记录迁移。迁移和种子数据分别位于 `db/migrations-mysql` 与 `db/seed-mysql`。

## 一次请求的时序

```text
用户 -> 主 Agent：查询工单 3
主 Agent -> 文件 MCP：读取工单规则
主 Agent -> Ollama：识别 action=query_ticket、ticketId=3
主 Agent -> 数据库 MCP：query_ticket(3)
数据库 MCP -> MySQL：参数化 SELECT
主 Agent -> 领域策略：decideTicket(ticket, threshold)
领域策略 -> 主 Agent：manual_review_required
主 Agent -> 审核 Agent：POST /a2a/task
审核 Agent -> MySQL：INSERT audit_tasks
审核 Agent -> 主 Agent：202 + taskId
主 Agent -> 用户：已进入人工审核队列
```

## 信任边界

- 用户输入和 LLM 输出均不可信。
- MCP 参数、HTTP JSON 和配置文件都需要校验。
- MySQL 密码只允许从环境变量或生产密钥系统注入。
- A2A 当前没有身份认证，只适合受控本地网络；生产部署必须增加服务身份认证。

## 扩展方式

- 新业务规则：加入 `domain` 并编写边界测试。
- 新外部协议：在 `contracts` 定义请求和响应，并提供运行时校验。
- 新 MCP 工具：工具只能封装预定义能力，禁止提供任意 SQL 或任意文件访问。
- 数据库变更：新增 `V数字__描述.sql`，禁止修改已执行迁移。
