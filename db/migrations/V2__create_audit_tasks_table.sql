CREATE TABLE IF NOT EXISTS audit_tasks (
    id TEXT PRIMARY KEY,
    trace_id TEXT NOT NULL,
    ticket_id INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('manual_review_required', 'approved', 'rejected')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (ticket_id) REFERENCES tickets(id)
);

CREATE INDEX IF NOT EXISTS idx_audit_tasks_ticket_id ON audit_tasks(ticket_id);
CREATE INDEX IF NOT EXISTS idx_audit_tasks_trace_id ON audit_tasks(trace_id);
