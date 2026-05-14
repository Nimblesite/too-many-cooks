/// MCP server setup for Too Many Cooks.
///
/// SHARED: Used by both local and cloud deployments.
/// Takes a TooManyCooksDb (any backend) and wires up all MCP tools.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

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
import { createLockHandler, LOCK_TOOL_CONFIG as lockToolConfig } from "./tools/lock_tool.js";
import { createMessageHandler, MESSAGE_TOOL_CONFIG as messageToolConfig } from "./tools/message_tool.js";
import { createPlanHandler, PLAN_TOOL_CONFIG as planToolConfig } from "./tools/plan_tool.js";
import { createRegisterHandler, REGISTER_TOOL_CONFIG as registerToolConfig } from "./tools/register_tool.js";
import { createStatusHandler, STATUS_TOOL_CONFIG as statusToolConfig } from "./tools/status_tool.js";
import type { CallToolResult, SessionIdentity, ToolCallback } from "./mcp-types.js";

/** Server name constant. */
const SERVER_NAME: string = "too-many-cooks";

/** Server version constant. Must match the package.json `version` of
 * `packages/too-many-cooks` so the deploy-toolkit version check and the
 * MCP `serverInfo.version` response agree on a single truth. */
const SERVER_VERSION: string = "0.5.0";

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
  },
): Result<McpServer, string> => {
  const adminPush: EventPushFn | undefined = options?.adminPush;
  const agentPush: EventPushFn | undefined = options?.agentPush;
  const agentPushToAgent: EventPushToAgentFn | undefined = options?.agentPushToAgent;
  const onSessionSet: ((agentName: string, agentKey: string) => void) | undefined = options?.onSessionSet;
  const server: McpServer = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
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

/** Zod schema for register tool input. */
const registerZodSchema: z.ZodRawShape = {
  name: z.string().optional().describe(
    "Your unique agent name, 1-50 chars. For FIRST registration only. Do NOT send with key.",
  ),
  key: z.string().optional().describe(
    "Your secret key from a previous registration. For RECONNECT only. Do NOT send with name.",
  ),
};

/** Zod schema for lock tool input. */
const lockZodSchema: z.ZodRawShape = {
  action: z.enum(["acquire", "release", "force_release", "renew", "query", "list"])
    .describe("Lock action to perform"),
  file_path: z.string().optional()
    .describe("File path to lock (required except for list)"),
  reason: z.string().optional()
    .describe("Why you need this lock (optional, for acquire)"),
  agent_key: z.string().optional()
    .describe("Agent key for authentication (optional, uses session if omitted)"),
};

/** Zod schema for message tool input. */
const messageZodSchema: z.ZodRawShape = {
  action: z.enum(["send", "get", "mark_read"])
    .describe("Message action to perform"),
  to_agent: z.string().optional()
    .describe("Recipient name or * for broadcast (for send)"),
  content: z.string().max(200).optional()
    .describe("Message content (for send). MUST be 200 chars or less."),
  message_id: z.string().optional()
    .describe("Message ID (for mark_read)"),
  unread_only: z.boolean().optional()
    .describe("Only return unread messages (default: true)"),
  agent_key: z.string().optional()
    .describe("Agent key for authentication (optional, uses session if omitted)"),
};

/** Zod schema for plan tool input. */
const planZodSchema: z.ZodRawShape = {
  action: z.enum(["update", "get", "list"])
    .describe("Plan action to perform"),
  goal: z.string().max(100).optional()
    .describe("Your goal (for update). MUST be 100 chars or less."),
  current_task: z.string().max(100).optional()
    .describe("What you are doing now (for update). MUST be 100 chars or less."),
  agent_key: z.string().optional()
    .describe("Agent key for authentication (optional, uses session if omitted)"),
};

/** Zod schema for status tool input (empty). */
const statusZodSchema: z.ZodRawShape = {};

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
  server.registerTool(
    "register",
    { description: registerToolConfig.description, inputSchema: registerZodSchema },
    wrapHandler(createRegisterHandler(db, emitter, log, setSession)),
  );
  server.registerTool(
    "lock",
    { description: lockToolConfig.description, inputSchema: lockZodSchema },
    wrapHandler(createLockHandler(db, config, emitter, log, getSession)),
  );
  server.registerTool(
    "message",
    { description: messageToolConfig.description, inputSchema: messageZodSchema },
    wrapHandler(createMessageHandler(db, emitter, log, getSession)),
  );
  server.registerTool(
    "plan",
    { description: planToolConfig.description, inputSchema: planZodSchema },
    wrapHandler(createPlanHandler(db, emitter, log, getSession)),
  );
  server.registerTool(
    "status",
    { description: statusToolConfig.description, inputSchema: statusZodSchema },
    wrapHandler(createStatusHandler(db, log)),
  );
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
