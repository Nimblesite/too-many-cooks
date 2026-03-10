#!/usr/bin/env node
/// Entry point for Too Many Cooks MCP server.
///
/// Starts a single Express HTTP server on port 4040 with:
/// - `/mcp` — MCP Streamable HTTP for agent connections
/// - `/admin/*` — REST + Streamable HTTP for the VSCode extension

import crypto from "node:crypto";
import { execSync } from "node:child_process";
import fs from "node:fs";
import express, { type Request, type Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  type Logger,
  type LogMessage,
  LogLevel,
  logLevelName,
  logTransport,
  createLoggerWithContext,
  createLoggingContext,
} from "../lib/src/logger.js";
import { defaultConfig, getServerPort, getWorkspaceFolder, pathJoin } from "../lib/src/data/config.js";
import { createDb, type TooManyCooksDb } from "../lib/src/data/db.js";
import { createAgentEventHub, type AgentEventHub } from "../lib/src/notifications.js";
import { createAdminEventHub, registerAdminRoutes, type AdminEventHub } from "../lib/src/admin_routes.js";
import { createMcpServerForDb } from "../lib/src/server.js";

/** JSON-RPC bad request error response. */
const BAD_REQUEST_JSON =
  '{"jsonrpc":"2.0","error":{"code":-32000,"message":"Bad Request"},"id":null}';

/** JSON-RPC session-not-found error response (404). */
const SESSION_NOT_FOUND_JSON =
  '{"jsonrpc":"2.0","error":{"code":-32001,"message":"Session not found"},"id":null}';

const main = async (): Promise<void> => {
  const log = createLogger();
  log.info("Server starting...");
  try {
    await startServer(log);
  } catch (e) {
    log.fatal("Fatal error", { error: String(e) });
    throw e;
  }
};

/** Maximum time to wait for port to become free after killing a process. */
const PORT_FREE_TIMEOUT_MS = 5000;

/** Check whether a port has any process listening via lsof. */
const isPortFree = (port: number): boolean => {
  try {
    const out = execSync(`lsof -ti :${String(port)}`, { encoding: "utf8" }).trim();
    return out.length === 0;
  } catch {
    return true;
  }
};

/** Kill any existing process listening on the given port and wait for it to be freed. */
const killExistingProcess = (port: number, log: Logger): void => {
  try {
    const output = execSync(`lsof -ti :${String(port)}`, { encoding: "utf8" }).trim();
    if (output.length === 0) {return;}
    const pids = output.split("\n").map((pid) => pid.trim()).filter((pid) => pid.length > 0);
    for (const pid of pids) {
      log.info("Killing existing process on port", { port, pid });
      execSync(`kill -9 ${pid}`);
    }
    const start = Date.now();
    while (Date.now() - start < PORT_FREE_TIMEOUT_MS) {
      if (isPortFree(port)) {
        log.info("Port is now free", { port });
        return;
      }
      execSync(`sleep 0.1`);
    }
    log.warn("Port still in use after timeout — proceeding anyway", { port });
  } catch {
    // lsof exits non-zero when no process found — that's fine
  }
};

const startServer = async (log: Logger): Promise<void> => {
  log.info("Creating server...");

  const cfg = defaultConfig;

  const dbResult = createDb(cfg);
  if (!dbResult.ok) {throw new Error(dbResult.error);}
  const db = dbResult.value;
  log.info("Database created.");

  const transports = new Map<string, StreamableHTTPServerTransport>();
  const agentHub = createAgentEventHub();
  const adminHub = createAdminEventHub();

  const app = express();

  registerAdminRoutes(app, db, adminHub);

  // Admin Streamable HTTP routes (/admin/events)
  app.post("/admin/events", asyncHandler(adminPostHandler(adminHub, log), log));
  app.get("/admin/events", asyncHandler(adminGetDeleteHandler(adminHub), log));
  app.delete("/admin/events", asyncHandler(adminGetDeleteHandler(adminHub), log));

  // MCP Streamable HTTP routes
  const mcpCtx: McpSessionContext = { transports, db, cfg, log, adminHub, agentHub };
  app.post("/mcp", asyncHandler(mcpPostHandler(mcpCtx), log));
  app.get("/mcp", asyncHandler(mcpGetDeleteHandler(transports, agentHub), log));
  app.delete("/mcp", asyncHandler(mcpGetDeleteHandler(transports, agentHub), log));

  const port = getServerPort();
  killExistingProcess(port, log);
  app.listen(port, () => {
    log.info("Server listening", { port });
  });

  // Keep event loop alive
  const KEEP_ALIVE_INTERVAL_MS = 60000;
  setInterval((): void => { /* noop */ }, KEEP_ALIVE_INTERVAL_MS);
  await new Promise<void>((): void => { /* noop */ });
};

/** Check if a parsed JSON body is an MCP initialize request. */
const isInitializeRequest = (body: unknown): boolean => {
  if (typeof body !== "object" || body === null) {return false;}
  const {method} = (body as Record<string, unknown>);
  return method === "initialize";
};

/** Context for initializing an MCP session. */
type McpSessionContext = {
  readonly transports: Map<string, StreamableHTTPServerTransport>;
  readonly db: TooManyCooksDb;
  readonly cfg: typeof defaultConfig;
  readonly log: Logger;
  readonly adminHub: AdminEventHub;
  readonly agentHub: AgentEventHub;
};

/** Wire up transport close handler for agent sessions. */
const wireAgentTransportClose = (
  transport: StreamableHTTPServerTransport,
  ctx: McpSessionContext,
): void => {
  transport.onclose = (): void => {
    const sid = transport.sessionId;
    if (sid !== undefined) {
      ctx.log.info("Session closed", { sessionId: sid });
      ctx.transports.delete(sid);
      ctx.agentHub.servers.delete(sid);
      ctx.agentHub.sessionAgentNames.delete(sid);
      ctx.agentHub.activeStreamSessions.delete(sid);
    }
  };
};

/** Initialize an MCP agent session (POST /mcp with initialize body). */
const initializeMcpSession = async (
  req: Request,
  res: Response,
  ctx: McpSessionContext,
): Promise<void> => {
  const { body } = req as { body: unknown };
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: (): string => crypto.randomUUID(),
    onsessioninitialized: (sid: string): void => {
      ctx.log.info("Session init", { sessionId: sid });
      ctx.transports.set(sid, transport);
    },
  });

  wireAgentTransportClose(transport, ctx);

  const serverResult = createMcpServerForDb(ctx.db, ctx.cfg, ctx.log, {
    adminPush: ctx.adminHub.pushEvent,
    agentPush: ctx.agentHub.pushEvent,
    agentPushToAgent: ctx.agentHub.pushToAgent,
    onSessionSet: (agentName: string): void => {
      const sid = transport.sessionId;
      if (sid !== undefined) {
        ctx.agentHub.sessionAgentNames.set(sid, agentName);
      }
    },
  });
  if (!serverResult.ok) {throw new Error(serverResult.error);}
  const server = serverResult.value;
  await server.connect(transport as unknown as Transport);
  await transport.handleRequest(req, res, body);

  const sid = transport.sessionId;
  if (sid !== undefined) {
    ctx.agentHub.servers.set(sid, server);
  }
};

/** POST /mcp handler. */
const mcpPostHandler = (
  ctx: McpSessionContext,
): ((req: Request, res: Response) => Promise<void>) =>
  async (req: Request, res: Response): Promise<void> => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const { body } = req as { body: unknown };

    if (sessionId !== undefined && ctx.transports.has(sessionId)) {
      const existing = ctx.transports.get(sessionId);
      if (existing !== undefined) {
        await existing.handleRequest(req, res, body);
      }
      return;
    }

    if (sessionId !== undefined) {
      res.status(404).send(SESSION_NOT_FOUND_JSON);
      return;
    }

    if (isInitializeRequest(body)) {
      await initializeMcpSession(req, res, ctx);
      return;
    }

    res.status(400).send(BAD_REQUEST_JSON);
  };

/** GET/DELETE /mcp handler. */
const mcpGetDeleteHandler = (
  transports: Map<string, StreamableHTTPServerTransport>,
  agentHub: AgentEventHub,
): ((req: Request, res: Response) => Promise<void>) =>
  async (req: Request, res: Response): Promise<void> => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (sessionId === undefined) {
      res.status(400).send("Missing session ID");
      return;
    }
    const transport = transports.get(sessionId);
    if (transport === undefined) {
      res.status(404).send(SESSION_NOT_FOUND_JSON);
      return;
    }
    agentHub.activeStreamSessions.add(sessionId);
    await transport.handleRequest(req, res);
  };

/** Initialize an admin session (POST /admin/events with initialize body). */
const initializeAdminSession = async (
  req: Request,
  res: Response,
  hub: AdminEventHub,
  log: Logger,
): Promise<void> => {
  const { body } = req as { body: unknown };
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: (): string => crypto.randomUUID(),
    onsessioninitialized: (sid: string): void => {
      log.info("Admin session init", { sessionId: sid });
      hub.transports.set(sid, transport);
    },
  });

  transport.onclose = (): void => {
    const sid = transport.sessionId;
    if (sid !== undefined) {
      log.info("Admin session closed", { sessionId: sid });
      hub.transports.delete(sid);
      hub.servers.delete(sid);
    }
  };

  const server = new McpServer(
    { name: "too-many-cooks", version: "0.1.0" },
    { capabilities: { logging: {} } },
  );
  await server.connect(transport as unknown as Transport);
  await transport.handleRequest(req, res, body);

  const sid = transport.sessionId;
  if (sid !== undefined) {
    hub.servers.set(sid, server);
  }
};

/** POST /admin/events handler. */
const adminPostHandler = (
  hub: AdminEventHub,
  log: Logger,
): ((req: Request, res: Response) => Promise<void>) =>
  async (req: Request, res: Response): Promise<void> => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const { body } = req as { body: unknown };

    if (sessionId !== undefined && hub.transports.has(sessionId)) {
      const existing = hub.transports.get(sessionId);
      if (existing !== undefined) {
        await existing.handleRequest(req, res, body);
      }
      return;
    }

    if (sessionId !== undefined) {
      res.status(404).send(SESSION_NOT_FOUND_JSON);
      return;
    }

    if (isInitializeRequest(body)) {
      await initializeAdminSession(req, res, hub, log);
      return;
    }

    res.status(400).send(BAD_REQUEST_JSON);
  };

/** GET/DELETE /admin/events handler. */
const adminGetDeleteHandler = (
  hub: AdminEventHub,
): ((req: Request, res: Response) => Promise<void>) =>
  async (req: Request, res: Response): Promise<void> => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (sessionId === undefined) {
      res.status(400).send("Missing session ID");
      return;
    }
    const transport = hub.transports.get(sessionId);
    if (transport === undefined) {
      res.status(404).send(SESSION_NOT_FOUND_JSON);
      return;
    }
    await transport.handleRequest(req, res);
  };

/** Wrap an async handler for Express. */
const asyncHandler = (
  fn: (req: Request, res: Response) => Promise<void>,
  log: Logger,
): ((req: Request, res: Response) => void) =>
  (req: Request, res: Response): void => {
    fn(req, res).catch((e: unknown): void => {
      log.error("Request error", { error: String(e) });
    });
  };

const resolveLogFilePath = (): string => {
  const logsDir = pathJoin([getWorkspaceFolder(), "logs"]);
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
  const timestamp = new Date()
    .toISOString()
    .replaceAll(":", "-")
    .replaceAll(".", "-");
  return pathJoin([logsDir, `mcp-server-${timestamp}.log`]);
};

const createLogger = (): Logger => {
  const logFilePath = resolveLogFilePath();
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

const formatLogLine = (message: LogMessage): string => {
  const level = logLevelName(message.logLevel);
  const data = message.structuredData;
  const dataStr =
    data !== undefined && Object.keys(data).length > 0
      ? ` ${JSON.stringify(data)}`
      : "";
  return `[TMC] [${message.timestamp.toISOString()}] [${level}] ${message.message}${dataStr}\n`;
};

const createConsoleTransport =
  () =>
  (message: LogMessage, minimumLogLevel: LogLevel): void => {
    if (message.logLevel < minimumLogLevel) {return;}
    console.error(formatLogLine(message).trimEnd());
  };

const createFileTransport =
  (filePath: string) =>
  (message: LogMessage, minimumLogLevel: LogLevel): void => {
    if (message.logLevel < minimumLogLevel) {return;}
    fs.appendFileSync(filePath, formatLogLine(message));
  };

main().catch((e: unknown): void => {
  console.error("Fatal:", e);
  process.exit(1);
});
