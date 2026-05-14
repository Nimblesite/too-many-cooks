/// Logger factory for the Too Many Cooks MCP server entry point.

import fs from "node:fs";
import {
  LogLevel,
  type LogMessage,
  type Logger,
  createLoggerWithContext,
  createLoggingContext,
  getWorkspaceFolder,
  logLevelName,
  logTransport,
  pathJoin,
} from "too-many-cooks-core";

const resolveLogFilePath: () => string = (): string => {
  const logsDir: string = pathJoin([getWorkspaceFolder(), "logs"]);
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
  const timestamp: string = new Date()
    .toISOString()
    .replaceAll(":", "-")
    .replaceAll(".", "-");
  return pathJoin([logsDir, `mcp-server-${timestamp}.log`]);
};

const formatLogLine: (message: LogMessage) => string = (message: LogMessage): string => {
  const level: string = logLevelName(message.logLevel);
  const data: typeof message.structuredData = message.structuredData;
  const dataStr: string =
    data !== undefined && Object.keys(data).length > 0
      ? ` ${JSON.stringify(data)}`
      : "";
  return `[TMC] [${message.timestamp.toISOString()}] [${level}] ${message.message}${dataStr}\n`;
};

const createConsoleTransport: () => (message: LogMessage, minimumLogLevel: LogLevel) => void =
  (): ((message: LogMessage, minimumLogLevel: LogLevel) => void) =>
  {return (message: LogMessage, minimumLogLevel: LogLevel): void => {
    if (message.logLevel < minimumLogLevel) {return;}
    console.error(formatLogLine(message).trimEnd());
  }};

const createFileTransport: (filePath: string) => (message: LogMessage, minimumLogLevel: LogLevel) => void =
  (filePath: string): ((message: LogMessage, minimumLogLevel: LogLevel) => void) =>
  {return (message: LogMessage, minimumLogLevel: LogLevel): void => {
    if (message.logLevel < minimumLogLevel) {return;}
    fs.appendFileSync(filePath, formatLogLine(message));
  }};

export const createLogger: () => Logger = (): Logger => {
  const logFilePath: string = resolveLogFilePath();
  return createLoggerWithContext(
    createLoggingContext({
      transports: [
        logTransport(createConsoleTransport()),
        logTransport(createFileTransport(logFilePath)),
      ],
      minimumLogLevel: LogLevel.DEBUG,
    }),
  );
};
