/**
 * Agent 应用编排层。
 * 本文件把 Ollama、两个 MCP 工具、领域规则和审核 A2A 串成一次完整请求，
 * 但不关心请求来自 HTTP 还是 CLI，因此两种入口都可以复用它。
 */
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StdioClientTransport} from "@modelcontextprotocol/sdk/client/stdio.js";
import axios from "axios";
import {randomUUID} from "node:crypto";
import {fileURLToPath} from "node:url";
import {loadConfig, resolveProjectPath} from "../config-loader.js";
import {decideTicket, type Ticket} from "../domain/ticket.js";
import type {AuditTaskRequest, AuditTaskResponse} from "../contracts/a2a.js";

/** HTTP 和 CLI 共用的结构化业务结果。 */
export type AgentQueryResult = {
    traceId: string;
    type: "direct_reply" | "manual_review_required" | "not_found" | "invalid_request";
    message: string;
    ticket?: Ticket;
    taskId?: string;
};

type AgentAction = {
    action: "query_ticket" | "direct_reply";
    ticketId: number | null;
    reason: string;
};

/** 对 LLM 输出做运行时校验，禁止任意模型输出直接驱动工具调用。 */
function isAgentAction(value: unknown): value is AgentAction {
    if (!value || typeof value !== "object") return false;
    const action = value as Partial<AgentAction>;
    return (action.action === "query_ticket" || action.action === "direct_reply")
        && (action.ticketId === null || Number.isInteger(action.ticketId))
        && typeof action.reason === "string";
}

/** 兼容纯 JSON 以及被 Markdown JSON 代码块包裹的模型输出。 */
function parseModelJson(raw: string): unknown {
    const text = raw.trim().replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    return JSON.parse(text);
}

/** 从 MCP SDK 的 unknown 返回值中提取第一个文本内容块。 */
function getToolText(result: unknown): string {
    if (!result || typeof result !== "object" || !("content" in result)) {
        throw new Error("MCP 返回格式错误：缺少 content");
    }
    const content = (result as {content: unknown}).content;
    if (!Array.isArray(content) || content.length === 0) throw new Error("MCP 返回内容为空");
    const first = content[0];
    if (!first || typeof first !== "object" || !("text" in first) || typeof first.text !== "string") {
        throw new Error("MCP 返回格式错误：缺少文本内容");
    }
    return first.text;
}

/**
 * 判断当前运行的是 tsx 源码还是编译后的 JavaScript，并生成相应 MCP 启动命令。
 * 开发环境由 tsx 加载 .ts；容器内直接由 node 加载 dist 下的 .js。
 */
function mcpProcess(serverName: "file-server" | "sql-server") {
    const runningTypeScript = fileURLToPath(import.meta.url).endsWith(".ts");
    if (runningTypeScript) {
        return {
            command: process.execPath,
            args: [resolveProjectPath("node_modules/tsx/dist/cli.mjs"), resolveProjectPath(`src/mcp/${serverName}.ts`)],
        };
    }
    return {command: process.execPath, args: [resolveProjectPath(`dist/mcp/${serverName}.js`)]};
}

/**
 * 常驻 Agent 应用服务。
 * MCP 客户端在 initialize 中只创建一次，供所有请求复用；close 在进程退出时统一释放。
 */
export class AgentService {
    // 读取数据库和业务阈值等应用配置；每个服务实例只读取一次。
    private readonly config = loadConfig();
    // 模型地址、模型名和审核地址允许用环境变量覆盖，方便不同环境部署。
    private readonly ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434/api/chat";
    private readonly model = process.env.MODEL || "qwen3:8b";
    private readonly auditUrl = process.env.A2A_AUDIT_URL || "http://127.0.0.1:8090/a2a/task";
    // 两个 MCP Client 分别连接知识库工具和数据库查询工具。
    private fileClient: Client | null = null;
    private sqlClient: Client | null = null;
    // 保存正在执行的初始化 Promise，防止并发请求重复启动 MCP 子进程。
    private initializing: Promise<void> | null = null;

    /** 并发调用时共享同一个初始化 Promise，避免重复创建 MCP 子进程。 */
    async initialize(): Promise<void> {
        if (this.fileClient && this.sqlClient) return;
        if (this.initializing) return this.initializing;
        this.initializing = this.connectMcpClients();
        try {
            await this.initializing;
        } finally {
            this.initializing = null;
        }
    }

    private async connectMcpClients(): Promise<void> {
        // 为两个职责不同的 MCP 服务创建独立客户端，便于单独关闭和定位故障。
        const fileClient = new Client({name: "agent-file-client", version: "1.0.0"});
        const sqlClient = new Client({name: "agent-sql-client", version: "1.0.0"});
        try {
            // StdioClientTransport 会启动 MCP 子进程，并通过标准输入输出交换协议消息。
            await fileClient.connect(new StdioClientTransport(mcpProcess("file-server")));
            await sqlClient.connect(new StdioClientTransport(mcpProcess("sql-server")));
            this.fileClient = fileClient;
            this.sqlClient = sqlClient;
        } catch (error) {
            // 任一连接失败时关闭两边，避免留下半初始化状态或孤儿进程。
            await fileClient.close().catch(() => undefined);
            await sqlClient.close().catch(() => undefined);
            throw error;
        }
    }

    /** 执行一次完整业务请求，并返回与入口无关的结构化结果。 */
    async query(message: string, providedTraceId?: string): Promise<AgentQueryResult> {
        const traceId = providedTraceId || randomUUID();
        const normalizedMessage = message.trim();
        if (!normalizedMessage) {
            return {traceId, type: "invalid_request", message: "message 不能为空"};
        }
        await this.initialize();
        if (!this.fileClient || !this.sqlClient) throw new Error("MCP 客户端未初始化");

        const ruleResult = await this.fileClient.callTool({
            name: "read_knowledge_doc",
            arguments: {filename: "ticket-rule.md"},
        });
        const businessRule = getToolText(ruleResult);
        const prompt = `你是企业工单助手。业务规则：${businessRule}
当前生效的金额审核阈值：${this.config.businessRule.amountAuditThreshold}元。
用户输入：${normalizedMessage}
你只负责判断是否查询工单以及提取工单ID。严格输出纯JSON：
{"action":"query_ticket|direct_reply","ticketId":number|null,"reason":string}`;

        const modelResponse = await axios.post(this.ollamaUrl, {
            model: this.model,
            messages: [{role: "user", content: prompt}],
            stream: false,
        }, {timeout: 300_000});
        const raw = modelResponse.data?.message?.content;
        if (typeof raw !== "string") throw new Error("模型返回格式错误：缺少 message.content");
        const action = parseModelJson(raw);
        if (!isAgentAction(action)) throw new Error("模型决策格式不符合协议");

        // 模型只决定“是否需要查询”以及 ID，不能直接决定金额是否需要审核。
        if (action.action === "direct_reply") {
            return {traceId, type: "direct_reply", message: "普通咨询，无需查询工单"};
        }
        if (!action.ticketId) {
            return {traceId, type: "invalid_request", message: "查询工单需要提供有效的工单 ID"};
        }

        // 数据库能力只能通过预定义 MCP 工具访问，主 Agent 不直接执行 SQL。
        const ticketResult = await this.sqlClient.callTool({
            name: "query_ticket",
            arguments: {ticketId: action.ticketId},
        });
        const queryResult = JSON.parse(getToolText(ticketResult)) as {found: boolean; ticket?: Ticket};
        if (!queryResult.found || !queryResult.ticket) {
            return {traceId, type: "not_found", message: `未找到工单 ${action.ticketId}`};
        }

        const ticket = queryResult.ticket;
        // 确定性的金额规则在领域层执行，不受模型措辞或随机性影响。
        const decision = decideTicket(ticket, this.config.businessRule.amountAuditThreshold);
        if (decision.kind === "direct_reply") {
            return {
                traceId,
                type: "direct_reply",
                message: `工单 ${ticket.id} 金额 ${ticket.amount} 元，无需审核`,
                ticket,
            };
        }

        // 只有领域规则要求审核时，才调用独立的审核 Agent 创建持久化任务。
        const auditRequest: AuditTaskRequest = {task: "ticket_audit", traceId, ticket};
        const auditResponse = await axios.post<AuditTaskResponse>(this.auditUrl, auditRequest, {timeout: 10_000});
        return {
            traceId,
            type: "manual_review_required",
            message: auditResponse.data.message,
            ticket,
            taskId: auditResponse.data.taskId,
        };
    }

    /** 释放 MCP 子进程；多次调用也安全。 */
    async close(): Promise<void> {
        const clients = [this.fileClient, this.sqlClient];
        this.fileClient = null;
        this.sqlClient = null;
        await Promise.all(clients.map((client) => client?.close().catch(() => undefined)));
    }
}
