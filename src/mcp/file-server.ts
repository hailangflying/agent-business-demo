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
    const {filename} = req.params.arguments as {filename?: unknown};
    if (typeof filename !== "string" || path.basename(filename) !== filename) {
        return {content:[{type:"text",text:"文件名不合法"}], isError:true};
    }
    const knowledgeRoot = resolveProjectPath("knowledge");
    const filePath = path.resolve(knowledgeRoot, filename);
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
    return {
        content:[{type:"text",text:`读取文档异常：${(err as Error).message}`}],
    };
 }
});


const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[MCP FileServer] started");
