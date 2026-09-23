import fs from "node:fs";
import yaml from "yaml";
import path from "node:path";
import {fileURLToPath} from "node:url";
import dotenv from "dotenv";

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


const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 将项目内相对路径转换为绝对路径，避免服务从不同目录启动时找不到文件。 */
export function resolveProjectPath(filePath: string): string {
    return path.isAbsolute(filePath) ? filePath : path.resolve(projectRoot, filePath);
}

/** 读取并校验 YAML 与环境变量，配置缺失时快速失败。 */
export function loadConfig(): AppConfig {
    const yamlText = fs.readFileSync(resolveProjectPath("config/app.yaml"), "utf-8");
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
        database: {...config.database, password},
    } as AppConfig;
}
