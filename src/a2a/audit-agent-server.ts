import express from "express";
import dotenv from "dotenv";
dotenv.config();
const app = express();
app.use(express.json());
const PORT = Number(process.env.A2A_PORT) || 8090;

const agentCard = {
    agentId:"audit-agent-001",
    name:"工单审核Agent",
    description:"负责大额工单风险审核",
    skills:[
        {
            skillId:"ticket_audit",
            description:"大额工单风险审核,判断是否可以通过",
            input:"工单JSON信息",
            output:"审批意见"
        },
    ],
};


app.get("/.well-known/agent-card",(req,res)=>{
    res.json(agentCard);
});

app.post("/a2a/task",async(req,res)=>{
    try{
        const payload = req.body.payload;
        console.log(`[A2A审核Agent]收到委派任务：`,payload);
        res.json({
            result:`✅A2A审核完成：${payload},金额超过1000元，人工复核后审批通过。`
        });
    }catch(e){
        res.status(500).json({error:`审核异常：${(e as Error).message}`});
    }
});


app.listen(PORT,()=>{
    console.log(`[A2A Audit Agent] running on http://127.0.0.1:${PORT}`);
    console.log(`Agent Card:http://127.0.0.1:${PORT}/.well-known/agent-card`);
});

