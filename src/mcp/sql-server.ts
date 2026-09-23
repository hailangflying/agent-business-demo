import {DatabaseSync} from "node:sqlite";
import {Server} from "@modelcontextprotocol/sdk/server/index.js";
import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js";
import {CallToolRequestSchema, ListToolsRequestSchema} from "@modelcontextprotocol/sdk/types.js";
import {loadConfig, resolveProjectPath} from "../config-loader.js";

const config = loadConfig();

const db = new DatabaseSync(resolveProjectPath(config.database.sqliteFilePath));
if (config.database.readOnly) db.exec("PRAGMA query_only = true");

const server = new Server(
    {name: "ticket-db", version: "1.0.0"},
    {capabilities: {tools: {}}},
);

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

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name !== "query_ticket") {
        return {content: [{type: "text", text: `未知工具：${request.params.name}`}], isError: true};
    }
    const ticketId = (request.params.arguments as {ticketId?: unknown} | undefined)?.ticketId;
    if (!Number.isInteger(ticketId) || Number(ticketId) <= 0) {
        return {content: [{type: "text", text: "工单 ID 必须是正整数"}], isError: true};
    }
    const normalizedTicketId = Number(ticketId);
    const row = db.prepare("SELECT id, title, amount, status FROM tickets WHERE id = ?").get(normalizedTicketId);
    const result = row ? {found: true, ticket: row} : {found: false, ticketId: normalizedTicketId};
    return {content: [{type: "text", text: JSON.stringify(result)}]};
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[MCP SqlServer] started");
