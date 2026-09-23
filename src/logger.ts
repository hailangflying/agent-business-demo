import {loadConfig} from "./config-loader.js";
const cfg = loadConfig();

type LogLevel = "debug" | "info" | "warn" | "error";
// 数字越大代表严重程度越高，用于按配置过滤低优先级日志。
const levelWeight: Record<LogLevel,number> = {debug:0,info:1,warn:2,error:3};

/** 判断某一级别的日志在当前配置下是否需要输出。 */
function shouldPrint(level:LogLevel):boolean{
     return levelWeight[level] >= levelWeight[cfg.log.level];
    }


/** 创建携带 traceId 的日志器，便于串联一次请求的全部日志。 */
export function getLogger(traceId:string){

    return{
        debug:(msg:string,meta?:unknown)=>{
            if(shouldPrint("debug"))
            console.debug(`[${traceId}][DEBUG]`,msg,meta??"");
            },
        info:(msg:string,meta?:unknown)=>{
                    if(shouldPrint("info"))
                    console.info(`[${traceId}][INFO]`,msg,meta??"");
                    },
        warn:(msg:string,meta?:unknown)=>{
                      if(shouldPrint("warn"))
                      console.warn(`[${traceId}][WARN]`,msg,meta??"");
                      },
         error:(msg:string,meta?:unknown)=>{
                    if(shouldPrint("error"))
                    console.error(`[${traceId}][ERROR]`,msg,meta??"");
                    },
        }
    }
