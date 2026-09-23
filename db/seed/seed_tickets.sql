--seed 种子脚本：**只在开发 / 测试环境执行**，用来灌入测试样例数据；生产环境绝对不执行 seed 脚本，真实业务数据来自业务系统。
INSERT INTO tickets(id, title, amount, status)
VALUES (3, '服务器采购', 2000, '待审核'),
       (5, '办公用品', 300, '待处理')
ON CONFLICT(id) DO NOTHING;