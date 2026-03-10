/// Logger - replaces dart_logging package.

/** Log levels in order of severity. */
export const enum LogLevel {
  TRACE = 0,
  DEBUG = 1,
  INFO = 2,
  WARN = 3,
  ERROR = 4,
  FATAL = 5,
}

/** Structured log message. */
export type LogMessage = {
  readonly logLevel: LogLevel;
  readonly message: string;
  readonly structuredData: Record<string, unknown> | undefined;
  readonly timestamp: Date;
};

/** Log level names for display. */
const LOG_LEVEL_NAMES: Record<LogLevel, string> = {
  [LogLevel.TRACE]: "TRACE",
  [LogLevel.DEBUG]: "DEBUG",
  [LogLevel.INFO]: "INFO",
  [LogLevel.WARN]: "WARN",
  [LogLevel.ERROR]: "ERROR",
  [LogLevel.FATAL]: "FATAL",
};

/** Get display name for a log level. */
export const logLevelName = (level: LogLevel): string => LOG_LEVEL_NAMES[level];

/** Log transport function. */
export type LogFunction = (
  message: LogMessage,
  minimumLogLevel: LogLevel,
) => void;

/** Logger interface. */
export type Logger = {
  readonly trace: (
    message: string,
    structuredData?: Record<string, unknown>,
  ) => void;
  readonly debug: (
    message: string,
    structuredData?: Record<string, unknown>,
  ) => void;
  readonly info: (
    message: string,
    structuredData?: Record<string, unknown>,
  ) => void;
  readonly warn: (
    message: string,
    structuredData?: Record<string, unknown>,
  ) => void;
  readonly error: (
    message: string,
    structuredData?: Record<string, unknown>,
  ) => void;
  readonly fatal: (
    message: string,
    structuredData?: Record<string, unknown>,
  ) => void;
  readonly child: (context: Record<string, unknown>) => Logger;
};

/** Logging context configuration. */
export type LoggingContext = {
  readonly transports: readonly LogFunction[];
  readonly minimumLogLevel: LogLevel;
};

/** Create a logging context. */
export const createLoggingContext = (
  options: {
    transports?: readonly LogFunction[];
    minimumLogLevel?: LogLevel;
  } = {},
): LoggingContext => ({
  transports: options.transports ?? [],
  minimumLogLevel: options.minimumLogLevel ?? LogLevel.DEBUG,
});

/** Wrap a log function as a transport. */
export const logTransport = (fn: LogFunction): LogFunction => fn;

/** Create a logger from a context. */
export const createLoggerWithContext = (context: LoggingContext): Logger =>
  createLoggerImpl(context, {});

const createLoggerImpl = (
  context: LoggingContext,
  parentData: Record<string, unknown>,
): Logger => {
  const emit = (
    level: LogLevel,
    message: string,
    structuredData?: Record<string, unknown>,
  ): void => {
    const merged =
      Object.keys(parentData).length > 0 || structuredData !== undefined
        ? { ...parentData, ...structuredData }
        : undefined;
    const msg: LogMessage = {
      logLevel: level,
      message,
      structuredData: merged,
      timestamp: new Date(),
    };
    for (const transport of context.transports) {
      transport(msg, context.minimumLogLevel);
    }
  };

  return {
    trace: (msg: string, data?: Record<string, unknown>): void => { emit(LogLevel.TRACE, msg, data); },
    debug: (msg: string, data?: Record<string, unknown>): void => { emit(LogLevel.DEBUG, msg, data); },
    info: (msg: string, data?: Record<string, unknown>): void => { emit(LogLevel.INFO, msg, data); },
    warn: (msg: string, data?: Record<string, unknown>): void => { emit(LogLevel.WARN, msg, data); },
    error: (msg: string, data?: Record<string, unknown>): void => { emit(LogLevel.ERROR, msg, data); },
    fatal: (msg: string, data?: Record<string, unknown>): void => { emit(LogLevel.FATAL, msg, data); },
    child: (childData) =>
      createLoggerImpl(context, { ...parentData, ...childData }),
  };
};
