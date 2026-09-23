import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StdioClientTransport} from "@modelcontextprotocol/sdk/client/stdio.js";
import axios from "axios";
import readline from "readline";
import dotenv from "dotenv";
import {loadConfig, resolveProjectPath} from "../config-loader.js";
import {randomUUID} from "node:crypto";
import {decideTicket, type Ticket} from "../domain/ticket.js";
import type {AuditTaskRequest, AuditTaskResponse} from "../contracts/a2a.js";

dotenv.config();

const OLLAMA_URL = process.env.OLLAMA_URL||"http://localhost:11434/api/chat";
const MODEL = process.env.MODEL || "qwen3:8b";
const A2A_AUDIT_URL =  process.env.A2A_AUDIT_URL || "http://127.0.0.1:8090/a2a/task";
const config = loadConfig();



const logger = {
    info:(msg:string)=>console.log(`[INFO] ${new Date().toISOString()} ${msg}`),
    error:(msg:string)=>console.error(`[ERROR] ${new Date().toISOString()} ${msg}`),
};


/** 启动一个 stdio MCP 子进程并建立客户端连接。 */
async function createMcpClient(serverPath:string){
    logger.info(`连接MCP服务：${serverPath}`);

    const transport = new StdioClientTransport({
        command : "npx",
        args:["tsx",serverPath],
    });

    const client = new Client({name:"harness-mcp-client",version:"1.0.0"});
    await client.connect(transport);
    logger.info(`MCP连接成功：${serverPath}`);
    return client;
}



/** 将达到金额阈值的工单委派给审核 Agent，并返回可展示的任务信息。 */
async function callA2AAuditAgent(ticket: Ticket, traceId: string) {
    try{
        const request: AuditTaskRequest = {task: "ticket_audit", traceId, ticket};
        logger.info(`A2A委派工单：${ticket.id} traceId=${traceId}`);
        const resp = await axios.post<AuditTaskResponse>(A2A_AUDIT_URL, request, {timeout:10000});
        return `${resp.data.message}（任务号：${resp.data.taskId}）`;
    }catch(err){
        logger.error(`A2A调用失败：${(err as Error).message}`);
        return `❌A2A委派失败：${(err as Error).message}`;
    }
    
}


/** 兼容纯 JSON 和被 ```json 包裹的模型输出。 */
function tryParseJson(raw:string){
    try{
        let txt = raw.trim();
        txt = txt.replace(/^```json/,"").replace(/```$/,"").trim();
        return JSON.parse(txt);
    }catch(e){
        logger.error(`LLM输出JSON解析失败 raw=${raw}`);
        return null;
    }    
}    

/** 从 MCP SDK 的 unknown 返回值中安全提取第一个文本内容块。 */
function getToolText(result: unknown): string {
    if (!result || typeof result !== "object" || !("content" in result)) {
        throw new Error("MCP 返回格式错误：缺少 content");
    }
    const content = (result as {content: unknown}).content;
    if (!Array.isArray(content) || content.length === 0) {
        throw new Error("MCP 返回格式错误：content 为空");
    }
    const first = content[0];
    if (!first || typeof first !== "object" || !("text" in first) || typeof first.text !== "string") {
        throw new Error("MCP 返回格式错误：缺少文本内容");
    }
    return first.text;
}

type AgentAction = {
    action: "query_ticket" | "direct_reply";
    ticketId: number | null;
    reason: string;
};

/** 对 LLM 输出做运行时校验，禁止模型生成的任意对象直接驱动业务流程。 */
function isAgentAction(value: unknown): value is AgentAction {
    if (!value || typeof value !== "object") return false;
    const action = value as Partial<AgentAction>;
    return (action.action === "query_ticket" || action.action === "direct_reply")
        && (action.ticketId === null || Number.isInteger(action.ticketId))
        && typeof action.reason === "string";
}

/**
 * 单次用户请求的编排入口：读取规则、调用 LLM、查询工单并执行确定性业务决策。
 * finally 中始终关闭 MCP 子进程，避免命令行长期运行时泄漏资源。
 */
async function runAgent(userQuery:string) {
    const traceId = randomUUID();
    let mcpFile: Client | null =null;
    let mcpSql : Client | null =null;
    try{
        mcpFile = await createMcpClient(resolveProjectPath("src/mcp/file-server.ts"));
        mcpSql = await createMcpClient(resolveProjectPath("src/mcp/sql-server.ts"));

        const ruleRes = await mcpFile.callTool({
            name :"read_knowledge_doc",
            arguments:{filename:"ticket-rule.md"},
        });

        const businessRule = getToolText(ruleRes);
        logger.info("加载业务规则成功");

        // LLM 只做意图识别和 ID 提取，金额阈值仍由领域函数 decideTicket 执行。
        const prompt = `你是企业工单助手。业务规则：${businessRule}
        当前生效的金额审核阈值：${config.businessRule.amountAuditThreshold}元。
        用户输入：${userQuery}
        你要判断：是否需要查询工单，还是直接回答，还是委派审核。
        严格输出纯JSON，不要额外文字，不要markdown。
        schema:
        {
            "action":"query_ticket|direct_reply",
            "ticketId":number|null,
            "reason":string
        }`;

        console.error("==== 调试：准备调用Ollama ====")
        console.error("请求地址：", OLLAMA_URL)
        const ollamaRes = await axios.post(OLLAMA_URL,{
            model:MODEL,
            messages:[{role:"user",content:prompt}],
            stream:false,
        },{timeout:300000});

        
   
        const llnRaw = ollamaRes.data.message.content;
        const parsedAction: unknown = tryParseJson(llnRaw);

      
        console.error("请求体：", JSON.stringify(llnRaw,null,2))

        if(!isAgentAction(parsedAction)) return "LLM返回格式错误，无法解析指令";
        const action = parsedAction;

        logger.info(`LLM决策：${JSON.stringify(action)}`);

        if(action.action === "query_ticket"){
            if (!action.ticketId) return "查询工单需要提供有效的工单 ID";
            const ticketRaw = await mcpSql.callTool({
                name:"query_ticket",
                arguments:{ticketId:action.ticketId},
            });

            // MCP 返回统一的 found 包装，未找到工单不会再尝试 JSON 业务解析。
            const ticketText = getToolText(ticketRaw);
            logger.info(`MCP查询工单结果：${ticketText}`);
            const queryResult = JSON.parse(ticketText) as {
                found: boolean;
                ticket?: {id: number; title: string; amount: number; status: string};
            };
            if (!queryResult.found || !queryResult.ticket) return `未找到工单 ${action.ticketId}`;
            const ticket: Ticket = queryResult.ticket;

            const decision = decideTicket(ticket, config.businessRule.amountAuditThreshold);
            if(decision.kind === "manual_review_required"){
                return await callA2AAuditAgent(ticket, traceId);
            }else{
                return `✅直接答复：工单${ticket.id}金额${ticket.amount}元，无需审核。`;
            }


        }else if(action.action === "direct_reply"){
            return "普通咨询，无需查询工单";
        }else{
            return `未知动作：${action.action}`;
        }


    }catch(err){
        logger.error(`Agent执行异常：${(err as Error).message}`);
        return `❌ Agent 运行异常：${(err as Error).message}`;
    }finally{
        if(mcpFile) await mcpFile.close().catch(e=>logger.error(`关闭mcpFile失败${e}`));
        if(mcpSql) await mcpSql.close().catch(e=>logger.error(`关闭mcpSql失败${e}`));
    }
    
}


/** 启动交互式 CLI；输入 exit 时安全退出。 */
async function cli() {
    logger.info("====== TS Harness 业务Agent CLI 启动 =====");
    const rl = readline.createInterface({
        input : process.stdin,
        output: process.stdout,
    });

    const ask = () =>{
        rl.question(">> 请输入你的请求：",async (input:string)=>{
            if(input.trim() === "exit"){
                rl.close();
                logger.info("Agent退出");
                return;
            }

            const result = await runAgent(input);
            console.log(`\n Agent 结果：\n${result}\n`);
            ask();
        });
    };

    ask();
}



cli().catch(e=>logger.error(`CLI全局异常：${e}`));
