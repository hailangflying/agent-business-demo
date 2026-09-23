import fs from "node:fs";
import yaml from "yaml";
import path from "node:path";
import {fileURLToPath} from "node:url";

export type AppConfig = {
    database:{
        sqliteFilePath:string;
        readOnly:boolean;
        };
    businessRule:{
        amountAuditThreshold:number;
        };
    log:{
        level:"debug" | "info" |"warn" | "error";
        };

    };


const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function resolveProjectPath(filePath: string): string {
    return path.isAbsolute(filePath) ? filePath : path.resolve(projectRoot, filePath);
}

export function loadConfig(): AppConfig {
    const yamlText = fs.readFileSync(resolveProjectPath("config/app.yaml"), "utf-8");
    const config = yaml.parse(yamlText) as Partial<AppConfig>;
    if (!config.database?.sqliteFilePath || typeof config.database.readOnly !== "boolean") {
        throw new Error("database 配置不完整");
    }
    if (typeof config.businessRule?.amountAuditThreshold !== "number") {
        throw new Error("businessRule.amountAuditThreshold 必须是数字");
    }
    if (!config.log?.level || !["debug", "info", "warn", "error"].includes(config.log.level)) {
        throw new Error("log.level 配置无效");
    }
    return config as AppConfig;
}
