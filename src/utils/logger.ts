export enum LogLevel {
    INFO = 'INFO',
    WARN = 'WARN',
    ERROR = 'ERROR',
    DEBUG = 'DEBUG'
}

class Logger {
    private log(level: LogLevel, message: string, meta?: any) {
        const timestamp = new Date().toISOString();
        const metaString = meta ? ` ${JSON.stringify(meta)}` : '';
        console.log(`[${timestamp}] [${level}] ${message}${metaString}`);
    }

    info(message: string, meta?: any) {
        this.log(LogLevel.INFO, message, meta);
    }

    warn(message: string, meta?: any) {
        this.log(LogLevel.WARN, message, meta);
    }

    error(message: string, meta?: any) {
        this.log(LogLevel.ERROR, message, meta);
    }

    debug(message: string, meta?: any) {
        if (process.env.NODE_ENV === 'development') {
            this.log(LogLevel.DEBUG, message, meta);
        }
    }
}

export const logger = new Logger();
