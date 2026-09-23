# 企业工单 Agent

这是一个面向企业工单场景的 Agent 工程骨架。项目使用 Ollama 进行意图识别，通过 MCP 读取规则和查询工单，通过 A2A 创建人工审核任务，并将业务数据持久化到 MySQL 8。

当前版本强调可维护的业务边界：LLM 只识别意图和提取工单 ID，金额判断由确定性的领域代码完成，高金额工单只会进入人工审核队列，不会由模型自动批准。

## 功能范围

- 自然语言识别普通咨询和工单查询
- 从知识库加载工单规则
- 通过 MCP 查询 MySQL 工单数据
- 按配置阈值执行金额审核策略
- 通过 A2A 创建人工审核任务
- 持久化 Task ID、Trace ID 和审核状态
- 数据库版本化迁移和开发种子数据
- 存活、就绪健康检查和优雅停机
- 运行时协议校验、参数化 SQL 和路径穿越防护

## 架构

```text
用户 CLI
   │
   ▼
主 Agent / Harness
   ├── Ollama：意图识别、提取工单 ID
   ├── 文件 MCP：读取 knowledge/ticket-rule.md
   └── 数据库 MCP：只执行工单查询
              │
              ▼
            MySQL
   │
   └── 达到金额阈值
              │ HTTP / A2A
              ▼
        工单审核 Agent
              │
              ▼
       audit_tasks 表
```

更详细的职责和调用时序见 [架构文档](docs/architecture.md)，A2A 接口定义见 [接口文档](docs/api.md)。

## 目录结构

```text
.
├─ config/app.yaml                 # 非敏感配置
├─ db/migrations-mysql/            # MySQL 版本化迁移
├─ db/seed-mysql/                  # 仅开发/测试使用的样例数据
├─ docs/                           # 架构、接口和运维说明
├─ knowledge/                      # 提供给 Agent 的业务知识
├─ src/
│  ├─ a2a/                         # 审核 Agent HTTP 服务
│  ├─ contracts/                   # 跨进程请求/响应协议
│  ├─ domain/                      # 不依赖框架的领域模型和规则
│  ├─ harness/                     # 主 Agent 编排与 CLI
│  ├─ mcp/                         # 文件和数据库 MCP 服务
│  ├─ shared/                      # 公共错误等基础能力
│  ├─ config-loader.ts             # 配置读取、校验和路径解析
│  └─ db-init.ts                   # MySQL 迁移入口
├─ .env.example                    # 环境变量模板
└─ package.json                    # 脚本和依赖
```

旧的 SQLite 文件及迁移不参与当前运行流程，正式路径为 `migrations-mysql` 和 `seed-mysql`。

## 环境要求

- Node.js 22.5 或更高版本
- npm
- MySQL 8，当前本地配置为 `127.0.0.1:3306`
- Ollama，默认接口为 `http://localhost:11434/api/chat`
- 已安装所配置的模型，默认 `qwen3:8b`

## 首次初始化

1. 安装依赖：

```powershell
npm install
```

2. 创建本地环境配置：

```powershell
Copy-Item .env.example .env
```

3. 修改 `.env`，至少填写 MySQL 密码：

```dotenv
OLLAMA_URL=http://localhost:11434/api/chat
MODEL=qwen3:8b
A2A_AUDIT_URL=http://127.0.0.1:8090/a2a/task
A2A_PORT=8090
DB_PASSWORD=你的本地MySQL密码
```

`.env` 已被 Git 忽略，禁止把真实密码写入 `config/app.yaml`、README 或源码。

4. 确认 MySQL 中存在数据库：

```sql
CREATE DATABASE IF NOT EXISTS agent_business_demo
CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
```

5. 执行迁移和开发数据初始化：

```powershell
npm run db:init
```

该命令可重复执行。已经登记到 `schema_migrations` 的脚本不会再次执行。`NODE_ENV=production` 时不会加载种子数据。

## 启动

先在第一个终端启动审核 Agent：

```powershell
npm run a2a
```

再在第二个终端启动主 Agent：

```powershell
npm run harness
```

示例输入：

```text
查询工单3
查询工单5
你好
exit
```

预期行为：

| 输入 | 数据 | 结果 |
|---|---|---|
| 查询工单 3 | 金额 2000 元 | 创建人工审核任务 |
| 查询工单 5 | 金额 300 元 | 直接回复，无需审核 |
| 查询不存在的工单 | 无数据 | 返回未找到 |
| 普通咨询 | 无需查询 | 返回普通咨询提示 |

## npm 命令

| 命令 | 用途 |
|---|---|
| `npm run db:init` | 执行 MySQL 迁移并在非生产环境加载种子数据 |
| `npm run a2a` | 启动审核 Agent HTTP 服务 |
| `npm run harness` | 启动交互式主 Agent |
| `npm run typecheck` | 执行 TypeScript 严格类型检查 |
| `npm test` | 执行类型检查和领域规则测试 |

## 配置

非敏感配置位于 `config/app.yaml`：

| 配置项 | 默认值 | 说明 |
|---|---:|---|
| `database.host` | `127.0.0.1` | MySQL 地址 |
| `database.port` | `3306` | MySQL 端口 |
| `database.name` | `agent_business_demo` | 数据库名 |
| `database.user` | `root` | 本地数据库用户；生产环境应使用最小权限账号 |
| `database.connectionLimit` | `10` | 单服务连接池上限 |
| `businessRule.amountAuditThreshold` | `1000` | 达到该金额时创建人工审核任务 |
| `log.level` | `info` | 日志级别 |

敏感配置通过环境变量注入：

| 环境变量 | 必填 | 说明 |
|---|---|---|
| `DB_PASSWORD` | 是 | MySQL 密码 |
| `OLLAMA_URL` | 否 | Ollama Chat API 地址 |
| `MODEL` | 否 | Ollama 模型名 |
| `A2A_AUDIT_URL` | 否 | 审核 Agent 地址 |
| `A2A_PORT` | 否 | 审核服务端口 |
| `NODE_ENV` | 否 | 设置为 `production` 时跳过种子数据 |

## 数据库表

- `tickets`：工单主数据，金额使用 `DECIMAL(15,2)`。
- `audit_tasks`：人工审核任务，保存任务号、追踪号、工单号和状态。
- `schema_migrations`：已应用的数据库迁移版本。

数据库结构只能通过新增迁移文件修改。已经在环境中执行过的迁移文件不得回改。

## 健康检查

- `GET /health/live`：进程是否存活，不检查外部依赖。
- `GET /health/ready`：服务是否可接收流量，会执行 MySQL 探测。
- `GET /.well-known/agent-card`：返回审核 Agent 能力描述。

## 测试

```powershell
npm test
```

当前测试覆盖金额低于、等于、高于阈值以及非法金额。新增领域规则时必须同步增加边界测试。

## 安全约束

- LLM 输出必须通过运行时校验，不能直接执行模型生成的 SQL 或命令。
- 数据库查询必须使用参数化语句。
- 文件 MCP 只能读取 `knowledge` 目录下的单层文件。
- 高金额工单只能创建人工审核任务，不能自动批准。
- 错误响应不返回数据库异常、堆栈和密码。
- 生产环境不要使用 root，应为查询 MCP 和审核服务分别配置最小权限账号。

## 故障排查

常见问题和检查命令见 [运维与排障文档](docs/operations.md)。

## 当前生产化边界

项目已经具备企业级最小骨架，但正式生产上线前仍建议补充：身份认证、限流、集中日志与指标、分布式链路追踪、审核后台、幂等键、重试与熔断、独立服务账号、容器镜像以及 CI/CD。
