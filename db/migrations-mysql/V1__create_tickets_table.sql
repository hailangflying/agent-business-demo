-- V1：工单主表。金额使用 DECIMAL，避免浮点精度问题。
CREATE TABLE IF NOT EXISTS tickets (
    -- 工单业务主键，使用 BIGINT 为后续数据量增长预留空间。
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    -- 工单标题和金额是主 Agent 做展示与决策所需的核心字段。
    title VARCHAR(255) NOT NULL,
    amount DECIMAL(15, 2) NOT NULL,
    -- 状态当前使用字符串保存，后续可按业务状态机进一步约束。
    status VARCHAR(32) NOT NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    CONSTRAINT chk_tickets_amount CHECK (amount >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
