import {loadConfig} from "./config-loader.js";
const cfg = loadConfig();

type LogLevel = "debug" | "info" | "warn" | "error";
const levelWeight: Record<LogLevel,number> = {debug:0,info:1,warn:2,error:3};

function shouldPrint(level:LogLevel):boolean{
     return levelWeight[level] >= levelWeight[cfg.log.level];
    }


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