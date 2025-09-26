export interface LogContext {
  [key: string]: any;
}

export interface Logger {
  info(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  debug(message: string, context?: LogContext): void;
}

class ConsoleLogger implements Logger {
  private formatMessage(
    level: string,
    message: string,
    context?: LogContext
  ): string {
    const timestamp = new Date().toISOString();
    const contextStr = context ? ` ${JSON.stringify(context)}` : "";
    return `[${level}] ${timestamp} - ${message}${contextStr}`;
  }

  info(message: string, context?: LogContext): void {
    console.log(this.formatMessage("INFO", message, context));
  }

  error(message: string, context?: LogContext): void {
    console.error(this.formatMessage("ERROR", message, context));
  }

  warn(message: string, context?: LogContext): void {
    console.warn(this.formatMessage("WARN", message, context));
  }

  debug(message: string, context?: LogContext): void {
    console.debug(this.formatMessage("DEBUG", message, context));
  }
}

export const logger: Logger = new ConsoleLogger();

export default logger;
