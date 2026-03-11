/// MCP server setup for Too Many Cooks.
///
/// SHARED: Used by both local and cloud deployments.
/// Takes a TooManyCooksDb (any backend) and wires up all MCP tools.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { TooManyCooksDataConfig } from "./config.js";
import type { TooManyCooksDb } from "./db-interface.js";
import type { Logger, LogMessage } from "./logger.js";
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
import type { SessionIdentity } from "./mcp-types.js";

/** Server name constant. */
const SERVER_NAME = "too-many-cooks";

/** Server version constant. */
const SERVER_VERSION = "0.1.0";

/** Log prefix for console output. */
const LOG_PREFIX = "[TMC]";

/** Result of creating the server - includes both MCP server and DB. */
export type ServerBundle = {
  readonly server: McpServer;
  readonly db: TooManyCooksDb;
};

/** Create an MCP server instance wired to a shared DB (any backend). */
export const createMcpServerForDb = (
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
  const adminPush = options?.adminPush;
  const agentPush = options?.agentPush;
  const agentPushToAgent = options?.agentPushToAgent;
  const onSessionSet = options?.onSessionSet;
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: { listChanged: true }, logging: {} } },
  );
  log.debug("MCP server created");

  const emitter = createNotificationEmitter(
    server,
    adminPush,
    agentPush,
    agentPushToAgent,
  );

  // Per-connection session state
  let session: SessionIdentity | null = null;
  const getSession = (): SessionIdentity | null => session;
  const setSession = (name: string, key: string): void => {
    session = { agentName: name, agentKey: key };
    onSessionSet?.(name, key);
    log.info(`Session established for agent: ${name}`);
  };

  registerTools(server, db, config, emitter, log, getSession, setSession);
  log.info("Server initialized with all tools registered");

  return success(server);
};

/** Zod schema for register tool input. */
const registerZodSchema = {
  name: z.string().optional().describe(
    "Your unique agent name, 1-50 chars. For FIRST registration only. Do NOT send with key.",
  ),
  key: z.string().optional().describe(
    "Your secret key from a previous registration. For RECONNECT only. Do NOT send with name.",
  ),
};

/** Zod schema for lock tool input. */
const lockZodSchema = {
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
const messageZodSchema = {
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
const planZodSchema = {
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
const statusZodSchema = {};

/** Register all tools on the MCP server. */
const registerTools = (
  server: McpServer,
  db: TooManyCooksDb,
  config: TooManyCooksDataConfig,
  emitter: ReturnType<typeof createNotificationEmitter>,
  log: Logger,
  getSession: () => SessionIdentity | null,
  setSession: (name: string, key: string) => void,
): void => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- MCP SDK handler type mismatch
  type AnyHandler = (...args: any[]) => any;
  server.registerTool(
    "register",
    { description: registerToolConfig.description, inputSchema: registerZodSchema },
    createRegisterHandler(db, emitter, log, setSession) as AnyHandler,
  );
  server.registerTool(
    "lock",
    { description: lockToolConfig.description, inputSchema: lockZodSchema },
    createLockHandler(db, config, emitter, log, getSession) as AnyHandler,
  );
  server.registerTool(
    "message",
    { description: messageToolConfig.description, inputSchema: messageZodSchema },
    createMessageHandler(db, emitter, log, getSession) as AnyHandler,
  );
  server.registerTool(
    "plan",
    { description: planToolConfig.description, inputSchema: planZodSchema },
    createPlanHandler(db, emitter, log, getSession) as AnyHandler,
  );
  server.registerTool(
    "status",
    { description: statusToolConfig.description, inputSchema: statusZodSchema },
    createStatusHandler(db, log) as AnyHandler,
  );
};

/** Creates a logger that writes to console.error. */
export const createConsoleLogger = (): Logger =>
  createLoggerWithContext(
    createLoggingContext({
      transports: [logTransport(logToConsole)],
      minimumLogLevel: LogLevel.DEBUG,
    }),
  );

/** Log transport that writes to console.error. */
const logToConsole = (
  message: LogMessage,
  minimumLogLevel: LogLevel,
): void => {
  if (message.logLevel < minimumLogLevel) {return;}
  const level = logLevelName(message.logLevel);
  const data = message.structuredData;
  const dataStr =
    data !== undefined && Object.keys(data).length > 0
      ? ` ${JSON.stringify(data)}`
      : "";
  console.error(`${LOG_PREFIX} [${level}] ${message.message}${dataStr}`);
};
