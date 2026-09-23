import mysql from "mysql2/promise";
import {Server} from "@modelcontextprotocol/sdk/server/index.js";
import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js";
import {CallToolRequestSchema, ListToolsRequestSchema} from "@modelcontextprotocol/sdk/types.js";
import {loadConfig} from "../config-loader.js";

const config = loadConfig();

// 连接池复用数据库连接；decimalNumbers 确保 DECIMAL 金额返回 number。
const db = mysql.createPool({
    host: config.database.host,
    port: config.database.port,
    database: config.database.name,
    user: config.database.user,
    password: config.database.password,
    connectionLimit: config.database.connectionLimit,
    enableKeepAlive: true,
    decimalNumbers: true,
});

const server = new Server(
    {name: "ticket-db", version: "1.0.0"},
    {capabilities: {tools: {}}},
);

// 向 MCP 客户端声明本服务支持的工具及其 JSON Schema。
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{
        name: "query_ticket",
        description: "根据工单 ID 查询工单信息",
        inputSchema: {
            type: "object",
            properties: {ticketId: {type: "integer", minimum: 1}},
            required: ["ticketId"],
            additionalProperties: false,
        },
    }],
}));

// 处理工具调用：先验证工具名和参数，再使用参数化 SQL 防止注入。
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name !== "query_ticket") {
        return {content: [{type: "text", text: `未知工具：${request.params.name}`}], isError: true};
    }
    const ticketId = (request.params.arguments as {ticketId?: unknown} | undefined)?.ticketId;
    if (!Number.isInteger(ticketId) || Number(ticketId) <= 0) {
        return {content: [{type: "text", text: "工单 ID 必须是正整数"}], isError: true};
    }
    const normalizedTicketId = Number(ticketId);
    const [rows] = await db.execute<mysql.RowDataPacket[]>(
        "SELECT id, title, amount, status FROM tickets WHERE id = ? LIMIT 1",
        [normalizedTicketId],
    );
    const row = rows[0];
    const result = row ? {found: true, ticket: row} : {found: false, ticketId: normalizedTicketId};
    return {content: [{type: "text", text: JSON.stringify(result)}]};
});

const transport = new StdioServerTransport();
// stdio 模式由主 Agent 创建子进程并通过标准输入输出通信。
await server.connect(transport);
console.error("[MCP SqlServer] started");
