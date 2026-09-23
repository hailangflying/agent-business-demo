-- 迁移脚本（migrations）：所有环境（本地开发、测试、预发）都执行，用来管理表结构变更。
CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    amount REAL NOT NULL,
    status TEXT NOT NULL
);