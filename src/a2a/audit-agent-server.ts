/**
 * 标准 A2A 1.0 工单审核 Agent。
 * 传输、版本协商、Task 生命周期和 Agent Card 均由官方 SDK 实现。
 */
import express from "express";
import dotenv from "dotenv";
import {randomUUID} from "node:crypto";
import mysql from "mysql2/promise";
import {type AgentCard, type Message, type Part, Role, TaskState, type Task} from "@a2a-js/sdk";
import {
    AgentEvent,
    type AgentExecutor,
    DefaultRequestHandler,
    type ExecutionEventBus,
    InMemoryTaskStore,
    type RequestContext,
} from "@a2a-js/sdk/server";
import {agentCardHandler, jsonRpcHandler, UserBuilder} from "@a2a-js/sdk/server/express";
import {loadConfig} from "../config-loader.js";
import type {Ticket} from "../domain/ticket.js";

dotenv.config();

const app = express();
const port = Number(process.env.A2A_PORT) || 8090;
const config = loadConfig();
const publicBaseUrl = process.env.A2A_PUBLIC_URL || `http://127.0.0.1:${port}`;
const a2aEndpoint = `${publicBaseUrl.replace(/\/$/, "")}/a2a`;

app.disable("x-powered-by");
app.use(express.json({limit: "64kb"}));

const db = mysql.createPool({
    host: config.database.host,
    port: config.database.port,
    database: config.database.name,
    user: config.database.user,
    password: config.database.password,
    connectionLimit: config.database.connectionLimit,
    decimalNumbers: true,
});

type TicketAuditInput = {task: "ticket_audit"; traceId: string; ticket: Ticket};
type TicketAuditOutput = {
    taskId: string;
    traceId: string;
    status: "manual_review_required";
    message: string;
};

/** 协议层校验不能代替业务校验，因此 DataPart 解包后仍检查每个字段。 */
function isTicketAuditInput(value: unknown): value is TicketAuditInput {
    if (!value || typeof value !== "object") return false;
    const request = value as Partial<TicketAuditInput>;
    const ticket = request.ticket as Partial<Ticket> | undefined;
    return request.task === "ticket_audit"
        && typeof request.traceId === "string" && request.traceId.length > 0
        && !!ticket && Number.isInteger(ticket.id)
        && typeof ticket.title === "string"
        && typeof ticket.amount === "number" && Number.isFinite(ticket.amount)
        && typeof ticket.status === "string";
}

function agentMessage(taskId: string, contextId: string, text: string): Message {
    return {
        messageId: randomUUID(), contextId, taskId, role: Role.ROLE_AGENT,
        parts: [{content: {$case: "text", value: text}, mediaType: "text/plain", filename: "", metadata: undefined}],
        metadata: undefined, extensions: [], referenceTaskIds: [],
    };
}

function auditInput(parts: Part[]): unknown {
    return parts.find((part) => part.content?.$case === "data")?.content?.value;
}

/** 官方 AgentExecutor：只负责业务执行，通过 EventBus 发布标准 A2A 事件。 */
class TicketAuditExecutor implements AgentExecutor {
    async execute(context: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
        const {taskId, contextId, userMessage} = context;
        const submittedTask: Task = {
            id: taskId,
            contextId,
            status: {state: TaskState.TASK_STATE_SUBMITTED, message: undefined, timestamp: new Date().toISOString()},
            artifacts: [],
            history: [userMessage],
            metadata: undefined,
        };

        // A2A 1.0 要求第一个事件必须是 Task 或 Message。
        eventBus.publish(AgentEvent.task(submittedTask));
        const input = auditInput(userMessage.parts);
        if (!isTicketAuditInput(input)) {
            eventBus.publish(AgentEvent.statusUpdate({
                taskId, contextId,
                status: {
                    state: TaskState.TASK_STATE_REJECTED,
                    message: agentMessage(taskId, contextId, "审核任务参数不合法"),
                    timestamp: new Date().toISOString(),
                },
                metadata: undefined,
            }));
            return;
        }

        eventBus.publish(AgentEvent.statusUpdate({
            taskId, contextId,
            status: {
                state: TaskState.TASK_STATE_WORKING,
                message: agentMessage(taskId, contextId, "正在创建人工审核任务"),
                timestamp: new Date().toISOString(),
            },
            metadata: undefined,
        }));

        const now = new Date();
        await db.execute(
            `INSERT INTO audit_tasks(id, trace_id, ticket_id, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [taskId, input.traceId, input.ticket.id, "manual_review_required", now, now],
        );

        const output: TicketAuditOutput = {
            taskId,
            traceId: input.traceId,
            status: "manual_review_required",
            message: `工单 ${input.ticket.id} 已进入人工审核队列`,
        };

        // Artifact 是标准 A2A Task 的结构化业务产物。
        eventBus.publish(AgentEvent.artifactUpdate({
            taskId, contextId,
            artifact: {
                artifactId: randomUUID(),
                name: "ticket-audit-result",
                description: "工单人工审核任务创建结果",
                parts: [{content: {$case: "data", value: output}, mediaType: "application/json", filename: "", metadata: undefined}],
                metadata: undefined,
                extensions: [],
            },
            append: false,
            lastChunk: true,
            metadata: undefined,
        }));

        // COMPLETED 表示“创建审核记录”完成，不代表工单已经审批通过。
        eventBus.publish(AgentEvent.statusUpdate({
            taskId, contextId,
            status: {
                state: TaskState.TASK_STATE_COMPLETED,
                message: agentMessage(taskId, contextId, output.message),
                timestamp: new Date().toISOString(),
            },
            metadata: undefined,
        }));
    }

    async cancelTask(taskId: string, eventBus: ExecutionEventBus): Promise<void> {
        eventBus.finished();
        console.warn(JSON.stringify({level: "warn", event: "cancel_not_supported", taskId}));
    }
}

const agentCard: AgentCard = {
    name: "工单审核 Agent",
    description: "接收大额工单审核委派并创建人工审核任务",
    supportedInterfaces: [{url: a2aEndpoint, protocolBinding: "JSONRPC", protocolVersion: "1.0", tenant: ""}],
    provider: {organization: "agent-business-demo", url: publicBaseUrl},
    version: "1.0.0",
    capabilities: {streaming: false, pushNotifications: false, extendedAgentCard: false, extensions: []},
    securitySchemes: {},
    securityRequirements: [],
    defaultInputModes: ["application/json"],
    defaultOutputModes: ["application/json", "text/plain"],
    skills: [{
        id: "ticket-audit",
        name: "工单人工审核委派",
        description: "为需要人工处理的大额工单创建审核任务",
        tags: ["ticket", "audit", "manual-review"],
        examples: ["为工单 3 创建人工审核任务"],
        inputModes: ["application/json"],
        outputModes: ["application/json"],
        securityRequirements: [],
    }],
    signatures: [],
};

const requestHandler = new DefaultRequestHandler(agentCard, new InMemoryTaskStore(), new TicketAuditExecutor());

// SDK 的 Card Handler 还会处理 ETag、缓存头及条件请求。
app.use("/.well-known/agent-card.json", agentCardHandler({agentCardProvider: requestHandler}));
app.use("/a2a", jsonRpcHandler({requestHandler, userBuilder: UserBuilder.noAuthentication}));

app.get("/health/live", (_req, res) => res.json({status: "ok"}));
app.get("/health/ready", async (_req, res) => {
    try {
        await db.query("SELECT 1");
        res.json({status: "ready", database: "up"});
    } catch {
        res.status(503).json({status: "not_ready", database: "down"});
    }
});

const httpServer = app.listen(port, () => {
    console.log(`[A2A 1.0 Audit Agent] ${a2aEndpoint}`);
    console.log(`[Agent Card] ${publicBaseUrl}/.well-known/agent-card.json`);
});
httpServer.requestTimeout = 15_000;
httpServer.headersTimeout = 20_000;

function shutdown(signal: string) {
    console.log(JSON.stringify({level: "info", event: "shutdown", signal}));
    httpServer.close(() => void db.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
