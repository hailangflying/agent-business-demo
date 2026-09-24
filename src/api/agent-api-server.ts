import express from "express";
import {randomUUID} from "node:crypto";
import {AgentService} from "../application/agent-service.js";

// 创建 Express 应用对象。
// 后面的 app.use、app.get、app.post 都是在这个对象上注册中间件和 HTTP 接口。
const app = express();

// 创建一份 AgentService 实例，负责真正的 Agent 业务编排。
// 整个 HTTP 服务只创建一次，因此所有请求可以复用它内部已经连接好的 MCP 客户端。
const agent = new AgentService();

// 从环境变量读取 HTTP 服务端口。
// Number() 把字符串转换成数字；没有配置 AGENT_API_PORT 时使用默认端口 8080。
const port = Number(process.env.AGENT_API_PORT) || 8080;

// 读取可选的接口访问密钥。
// 配置后，业务调用方必须在请求头中携带 x-api-key；本地开发可以暂时不配置。
const apiKey = process.env.AGENT_API_KEY;

// 移除 Express 默认返回的 X-Powered-By: Express 响应头。
// 这样可以减少服务器技术栈信息暴露，是一个基础安全设置。
app.disable("x-powered-by");

// 注册 JSON 请求体解析中间件。
// 它会把 application/json 请求解析到 req.body；64kb 限制用于阻止过大的请求占用内存。
app.use(express.json({limit: "64kb"}));

/** 可选 API Key 认证。本地未配置时放行，生产环境必须配置。 */
app.use("/api", (req, res, next) => {
    // 没有配置 API Key 时直接进入下一个中间件，主要用于本地开发。
    if (!apiKey) {
        next();
        return;
    }
    // 配置了 API Key 后，比较请求头中的密钥；不一致时立即返回 401。
    if (req.header("x-api-key") !== apiKey) {
        res.status(401).json({code: "UNAUTHORIZED", message: "无效的 API Key"});
        return;
    }
    // 密钥正确，继续执行后面的业务接口。
    next();
});

// 存活检查只用于确认 Node.js/Express 进程还在运行，不检查外部依赖。
app.get("/health/live", (_req, res) => res.json({status: "ok"}));

/** 就绪检查会确保两个常驻 MCP 客户端已经连接成功。 */
app.get("/health/ready", async (_req, res) => {
    try {
        // initialize() 会确保文件 MCP 和数据库 MCP 均已连接。
        await agent.initialize();
        res.json({status: "ready", mcp: "up"});
    } catch {
        res.status(503).json({status: "not_ready", mcp: "down"});
    }
});

app.post("/api/v1/agent/query", async (req, res) => {
    // 优先采用调用方传入的请求 ID，未提供时自动生成 UUID，方便串联日志和审核任务。
    const traceId = req.header("x-request-id")?.trim() || randomUUID();

    // req.body 属于外部输入，先按 unknown 读取 message，不能直接假设它一定是字符串。
    const message = (req.body as {message?: unknown} | undefined)?.message;

    // 只接受 1～4000 字符的非空字符串，非法请求不进入 AgentService。
    if (typeof message !== "string" || !message.trim() || message.length > 4000) {
        res.status(400).json({traceId, code: "INVALID_MESSAGE", message: "message 必须是 1 到 4000 字符的字符串"});
        return;
    }
    try {
        // 调用应用服务执行：读取规则、模型判断、MCP 查询和必要的 A2A 审核委派。
        const result = await agent.query(message, traceId);

        // 把业务结果类型转换为合适的 HTTP 状态码。
        const status = result.type === "not_found" ? 404 : result.type === "invalid_request" ? 400 : 200;
        res.status(status).json(result);
    } catch (error) {
        // 服务端记录详细错误用于排查，但 HTTP 响应只返回通用信息，避免泄露内部实现。
        console.error(JSON.stringify({
            level: "error",
            event: "agent_query_failed",
            traceId,
            error: error instanceof Error ? error.message : String(error),
        }));
        res.status(502).json({traceId, code: "AGENT_UPSTREAM_ERROR", message: "Agent 依赖服务调用失败"});
    }
});

// 前面的路由都没有匹配时统一返回 404。
app.use((_req, res) => res.status(404).json({code: "NOT_FOUND", message: "接口不存在"}));

// 先初始化 Agent/MCP，再开始监听端口。
// 初始化失败时进程会直接启动失败，而不是接收请求后才暴露问题。
await agent.initialize();

// 监听 0.0.0.0 表示接受所有网卡上的请求，Docker 端口映射才能访问该服务。
const server = app.listen(port, "0.0.0.0", () => {
    console.log(JSON.stringify({level: "info", event: "agent_api_started", port}));
});

// 单个业务请求最长允许约 310 秒，略长于 Ollama 的 300 秒调用超时。
server.requestTimeout = 310_000;

// 客户端必须在 20 秒内发送完 HTTP 请求头，用于降低慢速请求攻击风险。
server.headersTimeout = 20_000;

/** 停止接收新请求，并关闭常驻 MCP 子进程。 */
function shutdown(signal: string) {
    console.log(JSON.stringify({level: "info", event: "shutdown", signal}));
    // server.close() 先停止接收新请求；现有请求结束后再关闭 MCP 子进程并正常退出。
    server.close(() => void agent.close().finally(() => process.exit(0)));

    // 如果优雅退出卡住，10 秒后强制退出，避免容器一直无法停止。
    setTimeout(() => process.exit(1), 10_000).unref();
}

// Ctrl+C 会触发 SIGINT；Docker/Kubernetes 停止容器通常发送 SIGTERM。
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
