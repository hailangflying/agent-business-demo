import type {Ticket} from "../domain/ticket.js";

/** 主 Agent 委派给审核 Agent 的稳定协议。 */
export type AuditTaskRequest = {
    task: "ticket_audit";
    traceId: string;
    ticket: Ticket;
};

/** 审核 Agent 创建任务后的响应；当前只创建人工审核任务，不自动批准。 */
export type AuditTaskResponse = {
    taskId: string;
    traceId: string;
    status: "manual_review_required" | "approved" | "rejected";
    message: string;
};

/**
 * 对 HTTP 边界收到的未知数据进行运行时校验。
 * TypeScript 类型在运行时不存在，因此不能只依赖类型断言。
 */
export function isAuditTaskRequest(value: unknown): value is AuditTaskRequest {
    if (!value || typeof value !== "object") return false;
    const request = value as Partial<AuditTaskRequest>;
    const ticket = request.ticket as Partial<Ticket> | undefined;
    return request.task === "ticket_audit"
        && typeof request.traceId === "string"
        && request.traceId.length > 0
        && !!ticket
        && Number.isInteger(ticket.id)
        && typeof ticket.title === "string"
        && typeof ticket.amount === "number"
        && Number.isFinite(ticket.amount)
        && typeof ticket.status === "string";
}
