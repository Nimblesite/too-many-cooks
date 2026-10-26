/// MCP server setup for Too Many Cooks.
///
/// SHARED: Used by both local and cloud deployments.
/// Takes a TooManyCooksDb (any backend) and wires up all MCP tools.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z } from "zod";

import type { TooManyCooksDataConfig } from "./config.js";
import type { TooManyCooksDb } from "./db-interface.js";
import type { LogMessage, Logger } from "./logger.js";
import {
  LogLevel,
  createLoggerWithContext,
  createLoggingContext,
  logLevelName,
  logTransport,
} from "./logger.js";
import type { EventPushFn, EventPushToAgentFn } from "./notifications.js";
import { createNotificationEmitter } from "./notifications.js";
import type { Result } from "./result.js";
import { success } from "./result.js";
import { type ServerInfo, serverInfoFor } from "./server_info.js";
import { createLockHandler, LOCK_INPUT_SHAPE, LOCK_TOOL_CONFIG as lockToolConfig } from "./tools/lock_tool.js";
import { createMessageHandler, messageInputShape, messageToolDescription } from "./tools/message_tool.js";
import { createPlanHandler, planInputShape, planToolDescription } from "./tools/plan_tool.js";
import { createRegisterHandler, REGISTER_INPUT_SHAPE, REGISTER_TOOL_CONFIG as registerToolConfig } from "./tools/register_tool.js";
import { createStatusHandler, STATUS_INPUT_SHAPE, STATUS_TOOL_CONFIG as statusToolConfig } from "./tools/status_tool.js";
import type { CallToolResult, SessionIdentity, ToolCallback } from "./mcp-types.js";

/** Log prefix for console output. */
const LOG_PREFIX: string = "[TMC]";

/** Result of creating the server - includes both MCP server and DB. */
export type ServerBundle = {
  readonly server: McpServer;
  readonly db: TooManyCooksDb;
};

/** Create an MCP server instance wired to a shared DB (any backend). */
export const createMcpServerForDb: (
  db: TooManyCooksDb,
  config: TooManyCooksDataConfig,
  log: Logger,
  options?: {
    adminPush?: EventPushFn;
    agentPush?: EventPushFn;
    agentPushToAgent?: EventPushToAgentFn;
    onSessionSet?: (agentName: string, agentKey: string) => void;
    /** Defaults to this package's own (release-stamped) package.json. */
    serverInfo?: ServerInfo;
  },
) => Result<McpServer, string> = (
  db: TooManyCooksDb,
  config: TooManyCooksDataConfig,
  log: Logger,
  options?: {
    adminPush?: EventPushFn;
    agentPush?: EventPushFn;
    agentPushToAgent?: EventPushToAgentFn;
    onSessionSet?: (agentName: string, agentKey: string) => void;
    /** Defaults to this package's own (release-stamped) package.json. */
    serverInfo?: ServerInfo;
  },
): Result<McpServer, string> => {
  const adminPush: EventPushFn | undefined = options?.adminPush;
  const agentPush: EventPushFn | undefined = options?.agentPush;
  const agentPushToAgent: EventPushToAgentFn | undefined = options?.agentPushToAgent;
  const onSessionSet: ((agentName: string, agentKey: string) => void) | undefined = options?.onSessionSet;
  const info: Result<ServerInfo, string> =
    options?.serverInfo === undefined ? serverInfoFor(import.meta.url) : success(options.serverInfo);
  if (!info.ok) {return info;}
  const server: McpServer = new McpServer(
    info.value,
    { capabilities: { tools: { listChanged: true }, logging: {} } },
  );
  log.debug("MCP server created");

  const emitter: ReturnType<typeof createNotificationEmitter> = createNotificationEmitter(
    server,
    adminPush,
    agentPush,
    agentPushToAgent,
  );

  // Per-connection session state
  let session: SessionIdentity | null = null;
  const getSession: () => SessionIdentity | null = (): SessionIdentity | null => {return session};
  const setSession: (name: string, key: string) => void = (name: string, key: string): void => {
    session = { agentName: name, agentKey: key };
    onSessionSet?.(name, key);
    log.info(`Session established for agent: ${name}`);
  };

  registerTools(server, db, config, emitter, log, getSession, setSession);
  log.info("Server initialized with all tools registered");

  return success(server);
};

/**
 * Wrap a local ToolCallback so it satisfies the MCP SDK's typed callback
 * signature without using type assertions.
 */
const wrapHandler: (handler: ToolCallback) => (args: Record<string, unknown>, extra: unknown) => Promise<CallToolResult> = (
  handler: ToolCallback,
): (args: Record<string, unknown>, extra: unknown) => Promise<CallToolResult> =>
  async (args: Record<string, unknown>, extra: unknown): Promise<CallToolResult> => {
    return await handler(args, extra);
  };

/** Register a single tool with a Zod schema and wrapped handler. */
const registerOne: (
  server: McpServer,
  name: string,
  description: string,
  inputSchema: z.ZodRawShape,
  handler: ToolCallback,
) => void = (
  server: McpServer,
  name: string,
  description: string,
  inputSchema: z.ZodRawShape,
  handler: ToolCallback,
): void => {
  server.registerTool(name, { description, inputSchema }, wrapHandler(handler));
};

/** Register all tools on the MCP server. */
const registerTools: (
  server: McpServer,
  db: TooManyCooksDb,
  config: TooManyCooksDataConfig,
  emitter: ReturnType<typeof createNotificationEmitter>,
  log: Logger,
  getSession: () => SessionIdentity | null,
  setSession: (name: string, key: string) => void,
) => void = (
  server: McpServer,
  db: TooManyCooksDb,
  config: TooManyCooksDataConfig,
  emitter: ReturnType<typeof createNotificationEmitter>,
  log: Logger,
  getSession: () => SessionIdentity | null,
  setSession: (name: string, key: string) => void,
): void => {
  // [MCP-TOOL-LIMITS] message/plan schemas and descriptions carry the CONFIGURED limits.
  registerOne(server, "register", registerToolConfig.description, REGISTER_INPUT_SHAPE, createRegisterHandler(db, emitter, log, setSession));
  registerOne(server, "lock", lockToolConfig.description, LOCK_INPUT_SHAPE, createLockHandler(db, config, emitter, log, getSession));
  registerOne(server, "message", messageToolDescription(config.maxMessageLength), messageInputShape(config.maxMessageLength), createMessageHandler(db, emitter, log, getSession));
  registerOne(server, "plan", planToolDescription(config.maxPlanLength), planInputShape(config.maxPlanLength), createPlanHandler(db, emitter, log, getSession));
  registerOne(server, "status", statusToolConfig.description, STATUS_INPUT_SHAPE, createStatusHandler(db, log, getSession));
};

/** Creates a logger that writes to console.error. */
export const createConsoleLogger: () => Logger = (): Logger =>
  {return createLoggerWithContext(
    createLoggingContext({
      transports: [logTransport(logToConsole)],
      minimumLogLevel: LogLevel.DEBUG,
    }),
  )};

/** Log transport that writes to console.error. */
const logToConsole: (message: LogMessage, minimumLogLevel: LogLevel) => void = (
  message: LogMessage,
  minimumLogLevel: LogLevel,
): void => {
  if (message.logLevel < minimumLogLevel) {return;}
  const level: string = logLevelName(message.logLevel);
  const data: Record<string, unknown> | undefined = message.structuredData;
  const dataStr: string =
    data !== undefined && Object.keys(data).length > 0
      ? ` ${JSON.stringify(data)}`
      : "";
  console.error(`${LOG_PREFIX} [${level}] ${message.message}${dataStr}`);
};
