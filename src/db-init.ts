/**
 * MySQL 初始化入口。
 * 按版本执行尚未应用的迁移，并且只在非生产环境写入演示数据。
 */
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import {loadConfig, resolveProjectPath} from "./config-loader.js";

const config = loadConfig();
// 迁移使用单连接，保证同一事务内的 SQL 落在同一个 MySQL 会话中。
const connection = await mysql.createConnection({
    host: config.database.host,
    port: config.database.port,
    database: config.database.name,
    user: config.database.user,
    password: config.database.password,
    charset: "utf8mb4",
});

try {
    // 迁移历史表用于保证每个版本只执行一次。
    await connection.execute(`CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMP(3) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // 文件名中的 V1、V2 决定执行顺序；新变更必须新增文件，禁止修改已上线迁移。
    const migrationsDir = resolveProjectPath("db/migrations-mysql");
    const files = fs.readdirSync(migrationsDir)
        .filter((file) => /^V\d+__.+\.sql$/.test(file))
        .sort((a, b) => a.localeCompare(b, undefined, {numeric: true}));

    for (const file of files) {
        // 已登记的迁移直接跳过，使初始化命令可安全重复执行。
        const [existing] = await connection.execute<mysql.RowDataPacket[]>(
            "SELECT version FROM schema_migrations WHERE version = ?",
            [file],
        );
        if (existing.length > 0) continue;

        const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
        // 业务结构与迁移记录必须同时成功，失败时统一回滚。
        await connection.beginTransaction();
        try {
            // connection.query() 可以执行迁移文件中的完整建表语句。
            await connection.query(sql);
            await connection.execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)",
                [file, new Date()],
            );
            await connection.commit();
        } catch (error) {
            // 迁移或版本登记任意一步失败，都撤销本次事务并把错误交给启动进程。
            await connection.rollback();
            throw error;
        }
    }

    // 示例数据只允许进入开发或测试环境，避免污染生产数据。
    if (process.env.NODE_ENV !== "production") {
        const seed = fs.readFileSync(resolveProjectPath("db/seed-mysql/seed_tickets.sql"), "utf-8");
        await connection.query(seed);
    }
    console.log("MySQL 数据库迁移完成；非生产环境已同步种子数据");
} finally {
    // 无论成功还是失败都释放连接，避免命令执行完后 Node.js 无法退出。
    await connection.end();
}
