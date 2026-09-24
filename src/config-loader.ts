/**
 * 应用配置加载器。
 * YAML 保存非敏感默认值，环境变量保存密码并覆盖不同部署环境的连接信息。
 */
import fs from "node:fs";
import yaml from "yaml";
import path from "node:path";
import {fileURLToPath} from "node:url";
import dotenv from "dotenv";

// 把项目根目录 .env 中的值加载到 process.env；系统环境变量优先级更高。
dotenv.config();

/** 应用的完整强类型配置；敏感密码只从环境变量注入。 */
export type AppConfig = {
    database:{
        host:string;
        port:number;
        name:string;
        user:string;
        password:string;
        connectionLimit:number;
        };
    businessRule:{
        amountAuditThreshold:number;
        };
    log:{
        level:"debug" | "info" |"warn" | "error";
        };

    };


// import.meta.url 是当前模块地址，由它反推项目根目录，不依赖启动命令所在目录。
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 将项目内相对路径转换为绝对路径，避免服务从不同目录启动时找不到文件。 */
export function resolveProjectPath(filePath: string): string {
    return path.isAbsolute(filePath) ? filePath : path.resolve(projectRoot, filePath);
}

/** 读取并校验 YAML 与环境变量，配置缺失时快速失败。 */
export function loadConfig(): AppConfig {
    const yamlText = fs.readFileSync(resolveProjectPath("config/app.yaml"), "utf-8");
    // YAML 解析结果来自外部文件，先当作不完整配置，再逐项校验。
    const config = yaml.parse(yamlText) as Partial<AppConfig>;
    if (!config.database?.host || !config.database.name || !config.database.user
        || typeof config.database.port !== "number") {
        throw new Error("database 配置不完整");
    }
    if (typeof config.businessRule?.amountAuditThreshold !== "number") {
        throw new Error("businessRule.amountAuditThreshold 必须是数字");
    }
    if (!config.log?.level || !["debug", "info", "warn", "error"].includes(config.log.level)) {
        throw new Error("log.level 配置无效");
    }
    const password = process.env.DB_PASSWORD;
    if (!password) throw new Error("缺少 DB_PASSWORD 环境变量");
    return {
        ...config,
        // 容器和生产环境可用环境变量覆盖 YAML，避免为不同环境复制配置文件。
        database: {
            ...config.database,
            host: process.env.DB_HOST || config.database.host,
            port: process.env.DB_PORT ? Number(process.env.DB_PORT) : config.database.port,
            name: process.env.DB_NAME || config.database.name,
            user: process.env.DB_USER || config.database.user,
            connectionLimit: process.env.DB_CONNECTION_LIMIT
                ? Number(process.env.DB_CONNECTION_LIMIT)
                : config.database.connectionLimit,
            password,
        },
    } as AppConfig;
}
