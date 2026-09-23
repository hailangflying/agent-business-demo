# 运维与故障排查

## 启动前检查

```powershell
docker ps
npm run db:init
npm test
```

确认 MySQL 容器健康、迁移成功、测试通过后再启动服务。

## 无法连接 MySQL

检查：

1. MySQL 容器是否处于 `healthy`。
2. `config/app.yaml` 中地址、端口、库名和用户名是否正确。
3. `.env` 中是否存在 `DB_PASSWORD`。
4. `agent_business_demo` 数据库是否存在。
5. Windows 的 3306 端口是否被其他进程占用。

不要把密码打印到终端或提交到 Git。

## 8090 端口被占用

说明已有审核服务在运行。优先停止旧进程；临时调试也可以同时修改：

```dotenv
A2A_PORT=8091
A2A_AUDIT_URL=http://127.0.0.1:8091/a2a/task
```

两项必须保持一致。

## Ollama 调用失败

检查 Ollama 服务是否启动、`.env` 中 URL 是否正确、模型是否已经安装。默认请求超时为 300 秒，本地模型首次加载可能较慢。

## MCP 启动失败

主 Agent 会把 MCP 作为 TypeScript 子进程启动。检查依赖是否安装、`npm run typecheck` 是否通过，以及 `.env` 中 MySQL 密码是否有效。

## 就绪检查返回 503

`/health/ready` 返回 503 表示 HTTP 服务存活但 MySQL 不可用。此时不应继续向实例分配业务流量。

## 数据库迁移规范

1. 新建下一个版本文件，例如 `V3__add_audit_operator.sql`。
2. 本地备份数据后执行 `npm run db:init`。
3. 检查 `schema_migrations` 是否记录新版本。
4. 已执行迁移不得修改或重命名。
5. 破坏性变更应采用先扩展、再迁移数据、最后收缩的多版本发布方式。

## 日志与追踪

每次主 Agent 请求生成 Trace ID，审核任务同时保存 Trace ID 和 Task ID。排障时应优先使用这两个标识关联调用链和数据库记录，禁止依赖用户输入全文搜索敏感数据。

## 生产部署检查清单

- 使用独立最小权限 MySQL 用户，禁止 root。
- 通过密钥管理系统注入密码。
- 为 A2A 增加服务认证和授权。
- 配置 TLS、限流、重试、熔断和幂等键。
- 接入集中日志、指标、告警和分布式追踪。
- 配置数据库备份与恢复演练。
- 在 CI 中执行类型检查、测试和迁移校验。
