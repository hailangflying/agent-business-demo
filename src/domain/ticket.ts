/** 工单领域模型：只描述业务概念，不依赖数据库、HTTP、MCP 或 LLM。 */
export type TicketStatus = "待处理" | "待审核" | "审核中" | "已通过" | "已拒绝";

/** 工单在业务层需要使用的最小字段集合。 */
export type Ticket = {
    id: number;
    title: string;
    amount: number;
    status: TicketStatus | string;
};

/** 领域策略的结果；上层编排根据结果选择直接回复或发起审核。 */
export type TicketDecision =
    | {kind: "direct_reply"; reason: string}
    | {kind: "manual_review_required"; reason: string};

/**
 * 根据金额判断工单是否需要人工审核。
 * 阈值比较属于确定性业务规则，不交给 LLM 决定，避免模型输出不稳定。
 */
export function decideTicket(ticket: Ticket, auditThreshold: number): TicketDecision {
    if (!Number.isFinite(ticket.amount) || ticket.amount < 0) {
        throw new Error("工单金额必须是非负数");
    }
    if (!Number.isFinite(auditThreshold) || auditThreshold < 0) {
        throw new Error("审核阈值配置无效");
    }
    return ticket.amount >= auditThreshold
        ? {kind: "manual_review_required", reason: `金额达到审核阈值 ${auditThreshold} 元`}
        : {kind: "direct_reply", reason: `金额低于审核阈值 ${auditThreshold} 元`};
}
