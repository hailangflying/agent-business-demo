/**
 * 工单数据库 MCP 服务。
 * 对主 Agent 只暴露按 ID 查询工单的最小能力，不提供任意 SQL 执行入口。
 */
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
    // 一个 MCP Server 将来可能注册多个工具，因此先按工具名分发。
    if (request.params.name !== "query_ticket") {
        return {content: [{type: "text", text: `未知工具：${request.params.name}`}], isError: true};
    }
    const ticketId = (request.params.arguments as {ticketId?: unknown} | undefined)?.ticketId;
    if (!Number.isInteger(ticketId) || Number(ticketId) <= 0) {
        return {content: [{type: "text", text: "工单 ID 必须是正整数"}], isError: true};
    }
    const normalizedTicketId = Number(ticketId);
    // LIMIT 1 与主键条件共同保证最多返回一条；? 占位符由驱动安全转义。
    const [rows] = await db.execute<mysql.RowDataPacket[]>(
        "SELECT id, title, amount, status FROM tickets WHERE id = ? LIMIT 1",
        [normalizedTicketId],
    );
    const row = rows[0];
    // found 包装让调用方明确区分“没有数据”和“查询过程发生错误”。
    const result = row ? {found: true, ticket: row} : {found: false, ticketId: normalizedTicketId};
    return {content: [{type: "text", text: JSON.stringify(result)}]};
});

const transport = new StdioServerTransport();
// stdio 模式由主 Agent 创建子进程并通过标准输入输出通信。
await server.connect(transport);
console.error("[MCP SqlServer] started");
