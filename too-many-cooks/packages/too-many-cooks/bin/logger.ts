/// Logger factory for the Too Many Cooks MCP server entry point.

import fs from "node:fs";
import path from "node:path";
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
  resolveLogsDir,
} from "too-many-cooks-core";

const resolveLogFilePath: () => string = (): string => {
  const logsDir: string = resolveLogsDir(getWorkspaceFolder());
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

/** Retry after recreating the logs dir (deleted while running). A write that
 *  still fails is reported on the console — logging must never crash the server. */
const recreateAndAppend: (filePath: string, line: string) => void = (filePath: string, line: string): void => {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, line);
  } catch (e: unknown) {
    console.error(`[TMC] Log file write failed: ${String(e)}`);
  }
};

const appendLine: (filePath: string, line: string) => void = (filePath: string, line: string): void => {
  try {
    fs.appendFileSync(filePath, line);
  } catch {
    recreateAndAppend(filePath, line);
  }
};

const createFileTransport: (filePath: string) => (message: LogMessage, minimumLogLevel: LogLevel) => void =
  (filePath: string): ((message: LogMessage, minimumLogLevel: LogLevel) => void) =>
  {return (message: LogMessage, minimumLogLevel: LogLevel): void => {
    if (message.logLevel < minimumLogLevel) {return;}
    appendLine(filePath, formatLogLine(message));
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
