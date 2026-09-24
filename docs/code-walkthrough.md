# 项目结构与代码逐段导读

本文面向第一次接触项目的开发人员，说明每个目录、文件和主要代码段的作用，以及它们在一次业务请求中的调用关系。

## 1. 项目整体结构

```text
agent-business-demo/
├─ config/                       # 非敏感运行配置
├─ db/                           # 数据库迁移和开发种子数据
├─ docs/                         # 架构、接口、运维和代码导读
├─ knowledge/                    # 提供给 Agent 的业务知识
├─ src/                          # TypeScript 源码
│  ├─ a2a/                       # 审核 Agent 服务
│  ├─ api/                       # 业务 HTTP API
│  ├─ application/               # Agent 应用编排
│  ├─ cli/                       # 本地命令行入口
│  ├─ contracts/                 # 跨服务数据协议
│  ├─ domain/                    # 领域模型与确定性规则
│  └─ mcp/                       # MCP 工具服务
├─ .env.example                  # 环境变量示例
├─ compose.yaml                  # 多容器编排
├─ Dockerfile                    # 生产镜像构建
├─ package.json                  # 依赖和命令
├─ tsconfig.json                 # TypeScript 编译配置
└─ README.md                     # 项目使用总入口
```

代码依赖方向大致为：

```text
API / CLI
    ↓
application/AgentService
    ↓
domain + contracts
    ↓
MCP / A2A / Ollama / MySQL
```

领域层不依赖 Express、MCP、MySQL 或 Ollama，因此可以单独测试。

## 2. 一次请求如何流转

以 `POST /api/v1/agent/query`、请求内容“查询工单3”为例：

1. `api/agent-api-server.ts` 校验 HTTP 请求并生成 Trace ID。
2. API 调用 `application/agent-service.ts` 的 `query()`。
3. `AgentService` 通过文件 MCP 读取 `knowledge/ticket-rule.md`。
4. `AgentService` 调用 Ollama，只让模型判断意图和提取工单 ID。
5. 模型结果经过 `isAgentAction()` 校验。
6. `AgentService` 通过数据库 MCP 调用 `query_ticket`。
7. 数据库 MCP 使用参数化 SQL 查询 MySQL 的 `tickets` 表。
8. `domain/ticket.ts` 的 `decideTicket()` 根据配置阈值做确定性判断。
9. 金额较低时直接返回；金额达到阈值时调用审核 A2A 服务。
10. 审核服务把任务写入 `audit_tasks`，返回 Task ID。
11. API 把结构化结果返回业务系统。

## 3. 根目录文件

### `README.md`

项目总说明。包含功能范围、架构、安装、配置、启动、接口、数据库、安全约束、Docker 部署和生产化边界。新人应首先阅读该文件。

### `.env`

本机真实环境变量，包含 MySQL 密码等敏感数据。该文件被 Git 忽略，不允许提交。代码通过 `dotenv.config()` 自动加载。

### `.env.example`

环境变量模板，不包含真实密码。主要字段：

- `OLLAMA_URL`：模型 Chat API 地址。
- `MODEL`：Ollama 模型名称。
- `A2A_AUDIT_URL`：主 Agent 调用审核 Agent 的地址。
- `A2A_PORT`：审核服务监听端口。
- `AGENT_API_PORT`：业务 API 监听端口。
- `AGENT_API_KEY`：可选的业务接口密钥，生产环境必须配置。
- `DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD`：MySQL 连接信息。

### `package.json`

定义 Node.js 项目信息、依赖和命令。

命令段：

- `a2a`：用 tsx 启动审核 Agent 源码。
- `api`：用 tsx 启动业务 HTTP API 源码。
- `harness`：启动本地 CLI。
- `db:init`：执行 MySQL 迁移和非生产种子数据。
- `build`：把 `src` 编译到 `dist`。
- `start:*`：运行编译后的生产 JavaScript。
- `typecheck`：只检查类型，不生成文件。
- `test`：先检查类型，再执行领域测试。

依赖段：

- `@modelcontextprotocol/sdk`：MCP 客户端和服务端协议实现。
- `axios`：调用 Ollama 和 A2A HTTP 接口。
- `dotenv`：读取 `.env`。
- `express`：提供 Agent API 和审核 API。
- `mysql2`：MySQL Promise 连接池和参数化查询。
- `yaml`：解析 `config/app.yaml`。

### `package-lock.json`

锁定依赖的精确版本和完整依赖树，确保开发、CI 和生产安装结果一致。应提交 Git，但不手工编辑。

### `tsconfig.json`

TypeScript 编译规则：

- `target: ES2022`：输出现代 JavaScript。
- `module/moduleResolution: NodeNext`：使用 Node.js ESM 规则。
- `rootDir: src`、`outDir: dist`：源码和产物目录。
- `strict: true`：启用严格类型检查。
- `esModuleInterop: true`：兼容 CommonJS 默认导入。
- `skipLibCheck: true`：跳过第三方声明文件内部检查。

### `.gitignore`

排除依赖、真实环境变量、编译产物、本地数据库、日志、IDE 配置和临时文件，防止无关或敏感内容进入仓库。

### `.dockerignore`

控制 Docker 构建上下文，避免把 `node_modules`、`.env`、Git 历史、日志和本地产物发送给 Docker 引擎。

### `Dockerfile`

采用两阶段构建：

1. `build` 阶段安装完整依赖并执行 TypeScript 编译。
2. `runtime` 阶段只安装生产依赖，复制 `dist`、配置和知识库。
3. 使用非 root 的 `node` 用户运行。
4. 默认启动 Agent HTTP API。

这样可以减小运行镜像，并避免把源码工具链带入生产环境。

### `compose.yaml`

编排两个应用容器：

- `agent-api`：映射宿主机 8080，供业务系统访问。
- `audit-agent`：只在 Compose 内部网络提供 8090，不直接暴露给业务方。

两个容器通过 `host.docker.internal` 使用宿主机已有的 MySQL 和 Ollama。敏感变量从本机 `.env` 注入。

## 4. 配置与知识库

### `config/app.yaml`

保存非敏感配置：MySQL 地址、端口、库名、用户名、连接池上限、金额审核阈值和日志级别。

环境变量可以覆盖数据库配置，方便同一镜像运行在本地、Docker 和生产环境。密码不允许写在 YAML 中。

### `knowledge/ticket-rule.md`

文件 MCP 提供给 LLM 的业务知识文本，用于帮助模型理解工单场景。它不是最终规则执行器；金额阈值的最终判断由 `decideTicket()` 完成。

## 5. 数据库目录

### `db/migrations-mysql/V1__create_tickets_table.sql`

创建 `tickets` 工单表：

- `id`：自增主键。
- `title`：工单标题。
- `amount`：使用 `DECIMAL(15,2)` 保存金额，避免浮点误差。
- `status`：工单状态。
- `created_at/updated_at`：创建和更新时间。
- `CHECK`：禁止负数金额。

### `db/migrations-mysql/V2__create_audit_tasks_table.sql`

创建 `audit_tasks` 审核任务表：

- `id`：A2A Task ID。
- `trace_id`：关联整条请求链路。
- `ticket_id`：关联工单。
- `status`：人工审核、通过或拒绝。
- 外键保证任务引用的工单存在。
- 索引支持按工单或 Trace ID 查询。

### `db/seed-mysql/seed_tickets.sql`

为开发和测试插入工单 3、5。使用 `ON DUPLICATE KEY` 保证重复执行不会覆盖已有数据。生产环境不会执行。

## 6. 配置加载代码

### `src/config-loader.ts`

代码段作用：

1. 导入 `fs/yaml/path/dotenv`：读取 YAML、解析路径和加载环境变量。
2. `AppConfig`：定义配置的完整 TypeScript 类型。
3. `projectRoot`：根据当前模块位置计算项目根目录，不依赖启动时的工作目录。
4. `resolveProjectPath()`：把项目相对路径转换成绝对路径。
5. `loadConfig()`：读取 `app.yaml`，检查必填项和枚举值。
6. 环境变量覆盖：容器可以通过 `DB_HOST` 等覆盖 YAML。
7. 密码校验：缺少 `DB_PASSWORD` 时立即终止启动，避免服务带错误配置运行。

## 7. 领域层

### `src/domain/ticket.ts`

- `TicketStatus`：已知工单状态集合。
- `Ticket`：业务使用的工单字段。
- `TicketDecision`：领域策略可能返回的两种结果。
- `decideTicket()`：校验金额和阈值，然后执行 `amount >= threshold` 判断。

这段代码不调用 LLM。即使模型输出不稳定，金额审批规则仍然确定。

### `src/domain/ticket.test.ts`

使用 Node.js 内置测试框架覆盖四个边界：低于阈值、等于阈值、高于阈值和非法负金额。等于阈值必须审核是最容易出现边界错误的场景。

## 8. 跨服务协议

### `src/contracts/a2a.ts`

- `AuditTaskRequest`：主 Agent 发送给审核 Agent 的请求结构。
- `AuditTaskResponse`：审核 Agent 返回的任务结构。
- `isAuditTaskRequest()`：运行时检查未知 HTTP JSON。

TypeScript 类型只在编译阶段有效，因此 HTTP 边界仍必须进行运行时校验。

## 9. Agent 应用编排

### `src/application/agent-service.ts`

这是项目最核心的应用服务。

#### 结果和模型协议

- `AgentQueryResult`：HTTP 和 CLI 共用的业务返回结构。
- `AgentAction`：LLM 只允许返回的决策格式。
- `isAgentAction()`：校验模型动作、工单 ID 和原因。
- `parseModelJson()`：兼容纯 JSON 和 Markdown JSON 代码块。
- `getToolText()`：从 MCP SDK 的未知结果中安全提取文本。

#### MCP 进程选择

`mcpProcess()` 判断当前运行环境：

- 开发环境运行 `.ts`，使用 tsx。
- 编译或容器环境运行 `dist/mcp/*.js`，使用 Node.js。

#### 生命周期

- `initialize()`：并发请求共享同一个初始化 Promise。
- `connectMcpClients()`：启动文件 MCP 和数据库 MCP。
- MCP 客户端保存在类实例中，后续请求复用。
- `close()`：服务退出时释放两个 MCP 子进程。

#### `query()` 业务流程

1. 创建或接受 Trace ID。
2. 校验消息非空。
3. 确保 MCP 已连接。
4. 读取业务规则。
5. 构造严格的模型 Prompt。
6. 调用 Ollama 并校验结果。
7. 普通咨询直接返回。
8. 查询请求调用数据库 MCP。
9. 未找到时返回 `not_found`。
10. 调用领域规则判断金额。
11. 小额工单直接回复。
12. 大额工单调用审核 A2A，返回 Task ID。

## 10. HTTP API

### `src/api/agent-api-server.ts`

代码段作用：

1. 创建 `AgentService` 单例，使所有 HTTP 请求复用 MCP。
2. 隐藏 Express 标识并限制 JSON 为 64KB。
3. `/api` 中间件：配置 `AGENT_API_KEY` 后校验 `x-api-key`。
4. `/health/live`：只判断 API 进程存活。
5. `/health/ready`：确保 MCP 已连接。
6. `POST /api/v1/agent/query`：校验 1～4000 字符的 message。
7. 使用 `x-request-id` 或生成 UUID 作为 Trace ID。
8. 把业务结果映射为 200、400 或 404。
9. 上游模型、MCP、A2A 异常统一返回 502，不泄露内部错误。
10. 404 中间件处理未知路由。
11. 启动时先初始化 MCP，再监听 `0.0.0.0:8080`。
12. SIGINT/SIGTERM 时停止接流量并关闭 MCP。

## 11. CLI 入口

### `src/cli/agent-cli.ts`

本地交互入口：初始化 `AgentService`，循环读取终端输入，调用 `query()` 并输出消息。输入 `exit` 或收到退出信号时关闭 MCP。

## 12. MCP 工具

### `src/mcp/file-server.ts`

1. 创建名称为 `business-knowledge` 的 MCP Server。
2. `ListTools` 声明 `read_knowledge_doc` 工具和 filename 参数。
3. `CallTool` 验证 filename 是单层文件名。
4. 把路径解析到 `knowledge`，再次检查没有越界。
5. 读取 UTF-8 文本并以 MCP text content 返回。
6. 使用 stdio 与主 Agent 通信。
7. 启动日志写 stderr，避免破坏 MCP stdout 协议。

### `src/mcp/sql-server.ts`

1. 加载 MySQL 配置并创建连接池。
2. `decimalNumbers: true` 将金额 DECIMAL 转成 number。
3. 声明 `query_ticket` 工具，只接受正整数 ID。
4. 拒绝未知工具和非法参数。
5. 使用 `?` 参数化查询，禁止 SQL 注入。
6. 返回 `{found:true,ticket}` 或 `{found:false,ticketId}`。
7. 使用 stdio 与主 Agent 通信。

## 13. 审核 Agent

### `src/a2a/audit-agent-server.ts`

代码段作用：

1. 创建 Express 应用和 MySQL 写连接池。
2. `agentCard` 描述审核 Agent 的身份与能力。
3. `/.well-known/agent-card` 暴露能力信息。
4. `/health/live` 检查进程。
5. `/health/ready` 执行 `SELECT 1` 检查 MySQL。
6. `/a2a/task` 使用 `isAuditTaskRequest()` 校验请求。
7. 生成 Task ID，并写入 `audit_tasks`。
8. 返回 HTTP 202 和 `manual_review_required`，不自动批准。
9. 404 和兜底异常处理中不暴露堆栈。
10. 配置请求超时和响应头超时。
11. 收到退出信号时停止服务并关闭连接池。

## 14. 数据库初始化

### `src/db-init.ts`

1. 创建单一 MySQL 连接，保证事务属于同一会话。
2. 创建 `schema_migrations` 迁移历史表。
3. 按 V1、V2 的数字顺序读取迁移文件。
4. 查询历史表，跳过已经执行的版本。
5. 每个迁移使用事务执行。
6. 成功后记录版本；失败则回滚并停止。
7. 非生产环境执行种子 SQL。
8. 最终关闭数据库连接。

## 15. 文档目录

- `docs/architecture.md`：设计原则、组件职责、请求时序和信任边界。
- `docs/api.md`：业务 Agent API、审核 A2A API、请求响应和错误格式。
- `docs/operations.md`：启动检查、故障排查、迁移规范和生产检查清单。
- `docs/code-walkthrough.md`：本文，逐文件和逐代码段导读。

## 16. 生成目录和本地文件

- `node_modules/`：npm 安装的依赖，不提交 Git。
- `dist/`：`npm run build` 生成的 JavaScript，不提交 Git。
- `.idea/`：IDE 本地配置，不提交 Git。
