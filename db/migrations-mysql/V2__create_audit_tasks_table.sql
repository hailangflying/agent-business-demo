-- V2：审核任务表。每次 A2A 委派生成独立任务，并通过 trace_id 关联请求链路。
CREATE TABLE IF NOT EXISTS audit_tasks (
    -- UUID 任务号由审核 Agent 生成，调用方可用它查询后续审批结果。
    id CHAR(36) PRIMARY KEY,
    -- trace_id 贯穿 API、Agent 和审核任务，用于日志关联和问题排查。
    trace_id CHAR(36) NOT NULL,
    ticket_id BIGINT NOT NULL,
    -- ENUM 限制数据库中只能出现受支持的审核状态。
    status ENUM('manual_review_required', 'approved', 'rejected') NOT NULL,
    created_at TIMESTAMP(3) NOT NULL,
    updated_at TIMESTAMP(3) NOT NULL,
    CONSTRAINT fk_audit_tasks_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id),
    INDEX idx_audit_tasks_ticket_id (ticket_id),
    INDEX idx_audit_tasks_trace_id (trace_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
