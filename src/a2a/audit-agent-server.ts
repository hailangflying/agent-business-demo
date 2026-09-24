/**
 * 独立的工单审核 Agent HTTP 服务。
 * 它接收主 Agent 的结构化委派，创建人工审核任务，但不会自动批准高金额工单。
 */
import express from "express";
import dotenv from "dotenv";
import {randomUUID} from "node:crypto";
import mysql from "mysql2/promise";
import {isAuditTaskRequest, type AuditTaskResponse} from "../contracts/a2a.js";
import {loadConfig} from "../config-loader.js";
dotenv.config();
const app = express();
// 隐藏框架标识并限制请求体大小，降低信息泄露和大包攻击风险。
app.disable("x-powered-by");
app.use(express.json({limit: "64kb"}));
const PORT = Number(process.env.A2A_PORT) || 8090;
const config = loadConfig();
// 审核服务需要写入审核任务，因此使用独立连接池而不是只读 MCP 查询服务。
const db = mysql.createPool({
    host: config.database.host,
    port: config.database.port,
    database: config.database.name,
    user: config.database.user,
    password: config.database.password,
    connectionLimit: config.database.connectionLimit,
    decimalNumbers: true,
});

const agentCard = {
    agentId:"audit-agent-001",
    name:"工单审核Agent",
    description:"负责大额工单风险审核",
    skills:[
        {
            skillId:"ticket_audit",
            description:"大额工单风险审核,判断是否可以通过",
            input:"工单JSON信息",
            output:"审批意见"
        },
    ],
};


app.get("/.well-known/agent-card",(req,res)=>{
    // Agent Card 供其他 Agent 或服务发现本服务的身份和能力。
    res.json(agentCard);
});

// live 只表示进程存活；ready 会真实探测数据库，供容器编排判断是否接流量。
app.get("/health/live", (_req, res) => res.json({status: "ok"}));
app.get("/health/ready", async (_req, res) => {
    try {
        await db.query("SELECT 1");
        res.json({status: "ready", database: "up"});
    } catch {
        res.status(503).json({status: "not_ready", database: "down"});
    }
});

app.post("/a2a/task",async(req,res)=>{
    try{
        // 所有外部输入先做运行时校验，非法数据不会进入数据库层。
        if (!isAuditTaskRequest(req.body)) {
            res.status(400).json({code: "INVALID_AUDIT_TASK", message: "审核任务参数不合法"});
            return;
        }
        const {traceId, ticket} = req.body;
        // JSON 日志带上 traceId 和 ticketId，方便在集中日志中关联一次业务请求。
        console.log(JSON.stringify({level: "info", event: "audit_task_received", traceId, ticketId: ticket.id}));
        const taskId = randomUUID();
        const now = new Date();
        // 这里只创建待人工审核任务，不在无人参与的情况下自动批准高金额工单。
        await db.execute(
            `INSERT INTO audit_tasks(id, trace_id, ticket_id, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [taskId, traceId, ticket.id, "manual_review_required", now, now],
        );
        const result: AuditTaskResponse = {
            taskId,
            traceId,
            status: "manual_review_required",
            message: `工单 ${ticket.id} 已进入人工审核队列`,
        };
        // 202 表示任务已经接收并进入后续人工处理，而不是已经审批完成。
        res.status(202).json(result);
    }catch(e){
        // 不把数据库错误或堆栈返回给调用方，避免泄露内部信息。
        res.status(500).json({code: "AUDIT_INTERNAL_ERROR", message: "审核服务内部异常"});
    }
});

app.use((_req, res) => res.status(404).json({code: "NOT_FOUND", message: "接口不存在"}));

// 最终兜底错误处理中不回传内部堆栈，详细错误只记录在服务端。
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(JSON.stringify({level: "error", event: "unhandled_error", error: String(error)}));
    res.status(500).json({code: "INTERNAL_ERROR", message: "服务内部异常"});
});


const httpServer = app.listen(PORT,()=>{
    console.log(`[A2A Audit Agent] running on http://127.0.0.1:${PORT}`);
    console.log(`Agent Card:http://127.0.0.1:${PORT}/.well-known/agent-card`);
});
httpServer.requestTimeout = 15_000;
httpServer.headersTimeout = 20_000;

/** 收到退出信号后停止接收新请求，等待连接池关闭，最多等待 10 秒。 */
function shutdown(signal: string) {
    console.log(JSON.stringify({level: "info", event: "shutdown", signal}));
    httpServer.close(() => {
        void db.end().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

