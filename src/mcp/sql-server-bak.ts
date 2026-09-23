import {Server} from "@modelcontextprotocol/sdk/server/index.js";
import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js";


import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import Database from "better-sqlite3";

const server = new Server(
    {name:"ticket-db",version:"1.0.0"},
    {capabilities:{tools:{}}}
);

/** 
const db = new Database("./ticket.db",(err)=>{
    if(err){
        console.error("[MCP SQL] DB connect error",err.message);
    }else{
        console.error("[MCP SQL] DB connected");
    }
});
*/
const db = new Database("./ticket.db");
 console.error("[MCP SQL] DB connected");

 db.exec(`CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY,
    title TEXT,
    amount REAL,
    status TEXT
  )`);

  const row3 = db.prepare("SELECT id FROM tickets WHERE id = ?").get(3);

    if (!row3) {
    db.prepare(`INSERT INTO tickets(id,title,amount,status) VALUES(?,?,?,?)`).run(3,"服务器采购",2000,"待审核");
    }

    const row5 = db.prepare("SELECT id FROM tickets WHERE id = ?").get(5);

    if (!row5) {
    db.prepare(`INSERT INTO tickets(id,title,amount,status) VALUES(?,?,?,?)`).run(5,"办公用品",300,"待处理");
    }

 /**
db.serialize(()=>{
    db.run(`CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY,
    title TEXT,
    amount REAL,
    status TEXT
  )`);
    db.get(`SELECT id FROM tickets WHERE id = 3`,(_,row)=>{
        if(!row){
            db,run(`INSERT INTO tickets(id,title,amount,status) VALUES(3,"服务器采购",2000,"待审核")`);
        }
    });

    db.get(`SELECT id FROM tickets WHERE id = 5`,(_,row)=>{
        if(!row){
            db.run(`INSERT INTO tickets(id,title,amount,status) VALUES(5,"办公用品",300,"待处理")`)
        }
    });


  });

*/

  server.setRequestHandler(ListToolsRequestSchema,async()=>{
    return{
        tools:[
            {
                name:"query_ticket",
                description:"根据工单id查询工单信息",
                inputSchema:{
                    type:"object",
                    properties:{ticketId:{type:"number"}},
                    required:["ticketId"],
                },
            },
        ],
    };
  });

  /**
server.setRequestHandler(CallToolRequestSchema, async(req)=>{
    const {ticketId} = req.params.arguments as {ticketId:number};
    return new Promise((resolve)=>{
        db.get(`SELECT * FROM tickets WHERE id = ?`,[ticketId],(err,row)=>{
            if(err){
                resolve({content:[{type:"text",text:`查询异常:${err.message}`}]});
                return;
            }

            if(!row){
                resolve({content:[{type:"text",text:`工单${ticketId}不存在`}]});
                return;
            }

            resolve({
                 content:[{type:"text",text:JSON.stringify(row)}],   
            });
        });
    });
});

 */


server.setRequestHandler(CallToolRequestSchema, async(req)=>{
    const {ticketId} = req.params.arguments as {ticketId:number};

    try{
        const row = db.prepare("SELECT * FROM tickets WHERE id = ?").get(ticketId);
            if (!row) {
            return { content: [{ type: "text", text: `工单${ticketId}不存在` }] };
            }
            return {
            content: [{ type: "text", text: JSON.stringify(row) }],
            };
        } catch (err) {
            return {
            content: [{ type: "text", text: `查询异常:${(err as Error).message}` }],
            };

        }
});


const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[MCP SqlServer] started");