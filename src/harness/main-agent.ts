import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StdioClientTransport} from "@modelcontextprotocol/sdk/client/stdio.js";
import axios from "axios";
import readline from "readline";
import dotenv from "dotenv";

dotenv.config();

const OLLAMA_URL = process.env.OLLAMA_URL||"http://localhost:11434/api/chat";
const MODEL = process.env.MODEL || "qwen3:8b";
const A2A_AUDIT_URL =  process.env.A2A_AUDIT_URL || "http://127.0.0.1:8090/a2a/task";



const logger = {
    info:(msg:string)=>console.log(`[INFO] ${new Date().toISOString()} ${msg}`),
    error:(msg:string)=>console.error(`[ERROR] ${new Date().toISOString()} ${msg}`),
};


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



async function callA2AAuditAgent(ticketInfo:string) {
    try{

        logger.info(`A2A委派工单信息：${ticketInfo}`);
        const resp = await axios.post(A2A_AUDIT_URL,{
            task:"工单审核",
            payload:ticketInfo,
        },{timeout:10000});

        return resp.data.result;
    }catch(err){
        logger.error(`A2A调用失败：${(err as Error).message}`);
        return `❌A2A委派失败：${(err as Error).message}`;
    }
    
}


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

async function runAgent(userQuery:string) {
    let mcpFile: Client | null =null;
    let mcpSql : Client | null =null;
    try{
        mcpFile = await createMcpClient("./src/mcp/file-server.ts");
        mcpSql = await createMcpClient("./src/mcp/sql-server.ts");

        const ruleRes = await mcpFile.callTool({
            name :"read_knowledge_doc",
            arguments:{filename:"ticket-rule.md"},
        });

        const businessRule=ruleRes.content[0].text;
        logger.info("加载业务规则成功");

        const prompt = `你是企业工单助手。业务规则：${businessRule}
        用户输入：${userQuery}
        你要判断：是否需要查询工单，还是直接回答，还是委派审核。
        严格输出纯JSON，不要额外文字，不要markdown。
        schema:
        {
            "action":"query_ticket|direct_reply|dekegate_audit",
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
        const action = tryParseJson(llnRaw);

      
        console.error("请求体：", JSON.stringify(llnRaw,null,2))

        if(!action) return "LLM返回格式错误，无法解析指令";

        logger.info(`LLM决策：${JSON.stringify(action)}`);

        if(action.action === "query_ticket" && action.ticketId){
            const ticketRaw = await mcpSql.callTool({
                name:"query_ticket",
                arguments:{ticketId:action.ticketId},
            });

            const ticketText = ticketRaw.content[0].text;
            logger.info(`MCP查询工单结果：${ticketText}`);
            const ticket =JSON.parse(ticketText);


            if(ticket.amount>=1000){
                return await callA2AAuditAgent(ticketText);
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