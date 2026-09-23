/**
 * 可安全暴露给接口层的统一业务异常。
 * code 供调用方稳定判断错误类型，statusCode 映射 HTTP 状态码。
 */
export class AppError extends Error {
    constructor(
        public readonly code: string,
        message: string,
        public readonly statusCode = 500,
        public readonly details?: unknown,
    ) {
        super(message);
        this.name = "AppError";
    }
}
