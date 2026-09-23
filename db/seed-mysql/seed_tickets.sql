-- 仅供开发和测试环境使用；重复执行不会覆盖已有业务数据。
INSERT INTO tickets(id, title, amount, status)
VALUES (3, '服务器采购', 2000, '待审核'),
       (5, '办公用品', 300, '待处理')
ON DUPLICATE KEY UPDATE id = VALUES(id);
