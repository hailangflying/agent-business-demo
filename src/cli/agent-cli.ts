/**
 * 本地命令行入口。
 * 它只负责读取输入和展示结果，真正业务流程全部委托给 AgentService。
 */
import readline from "node:readline";
import {AgentService} from "../application/agent-service.js";

/** 本地交互入口；生产流量应通过 HTTP API 访问同一个 AgentService。 */
const agent = new AgentService();
// readline 把标准输入输出包装成交互式终端接口。
const terminal = readline.createInterface({input: process.stdin, output: process.stdout});

/** 关闭终端和 Agent 内部的 MCP 子进程。 */
async function shutdown() {
    terminal.close();
    await agent.close();
}

/** 递归等待下一次用户输入；每次异步请求完成后再次显示提示符。 */
function ask() {
    terminal.question(">> 请输入你的请求：", async (input) => {
        if (input.trim().toLowerCase() === "exit") {
            await shutdown();
            return;
        }
        try {
            // CLI 和 HTTP API 调用的是同一个 query()，因此业务行为保持一致。
            const result = await agent.query(input);
            console.log(`\nAgent 结果：\n${result.message}\n`);
        } catch (error) {
            console.error(`Agent 执行失败：${error instanceof Error ? error.message : String(error)}`);
        }
        ask();
    });
}

// 先确认 MCP 可用，再向用户显示启动成功，避免首次输入时才发现依赖故障。
await agent.initialize();
console.log("企业工单 Agent CLI 已启动，输入 exit 退出");
ask();

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
