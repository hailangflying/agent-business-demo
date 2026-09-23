-- V2：审核任务表。每次 A2A 委派生成独立任务，并通过 trace_id 关联请求链路。
CREATE TABLE IF NOT EXISTS audit_tasks (
    id CHAR(36) PRIMARY KEY,
    trace_id CHAR(36) NOT NULL,
    ticket_id BIGINT NOT NULL,
    status ENUM('manual_review_required', 'approved', 'rejected') NOT NULL,
    created_at TIMESTAMP(3) NOT NULL,
    updated_at TIMESTAMP(3) NOT NULL,
    CONSTRAINT fk_audit_tasks_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id),
    INDEX idx_audit_tasks_ticket_id (ticket_id),
    INDEX idx_audit_tasks_trace_id (trace_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
