import {DatabaseSync} from "node:sqlite";
import fs from "node:fs";
import {loadConfig, resolveProjectPath} from "./config-loader.js";

const cfg = loadConfig();
const db = new DatabaseSync(resolveProjectPath(cfg.database.sqliteFilePath));

try {
    const migrateSql = fs.readFileSync(resolveProjectPath("db/migrations/V1__create_tickets_table.sql"), "utf-8");
    db.exec(migrateSql);

    if (process.env.NODE_ENV !== "production") {
        const seedSql = fs.readFileSync(resolveProjectPath("db/seed/seed_tickets.sql"), "utf-8");
        db.exec(seedSql);
    }

    console.log("数据库迁移完成；非生产环境已同步种子数据");
} finally {
    db.close();
}
