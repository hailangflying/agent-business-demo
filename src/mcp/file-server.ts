/**
 * 知识库 MCP 服务。
 * 只暴露读取 knowledge 目录文件的受控工具，不允许调用方访问任意磁盘路径。
 */
import {Server} from "@modelcontextprotocol/sdk/server/index.js";
import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import fs from "fs";
import path from "path";
import {resolveProjectPath} from "../config-loader.js";

const server = new Server(
    { name: "business-knowledge" , version:"1.0.0"},
    { capabilities:{tools:{}}},
);

// 声明知识库读取工具，调用方必须提供文件名。
server.setRequestHandler(ListToolsRequestSchema, async()=>{
    return {
        tools:[
            {
                name:"read_knowledge_doc",
                description:"读取业务知识库文档，查询工单规则",
                inputSchema:{
                    type:"object",
                    properties:{filename:{
                        type:"string",
                    }},
                    required:["filename"],
                }
            }
        ]
    };
});


server.setRequestHandler(CallToolRequestSchema,async(req)=>{
 try{
    // MCP 参数属于外部输入，先验证类型，并禁止 filename 自带目录部分。
    const {filename} = req.params.arguments as {filename?: unknown};
    if (typeof filename !== "string" || path.basename(filename) !== filename) {
        return {content:[{type:"text",text:"文件名不合法"}], isError:true};
    }
    const knowledgeRoot = resolveProjectPath("knowledge");
    const filePath = path.resolve(knowledgeRoot, filename);
    // 双重路径校验用于阻止 ../ 等目录穿越访问。
    if (!filePath.startsWith(`${knowledgeRoot}${path.sep}`)) {
        return {content:[{type:"text",text:"禁止访问知识库目录之外的文件"}], isError:true};
    }
    if(!fs.existsSync(filePath)){
        return {
            content:[{type:"text",text:`错误：文件${filename}不存在`}],
        };
    }

    const content = fs.readFileSync(filePath,"utf8");
    return{
        content:[{type:"text",text:content}],
    };
 }catch(err){
    // 工具异常使用 MCP 文本结果返回，避免子进程直接崩溃。
    return {
        content:[{type:"text",text:`读取文档异常：${(err as Error).message}`}],
    };
 }
});


const transport = new StdioServerTransport();
// MCP 日志必须写 stderr，避免污染 stdio 协议消息。
await server.connect(transport);
console.error("[MCP FileServer] started");
