#!/usr/bin/env node
/// Entry point for Too Many Cooks MCP server.
///
/// Starts a single Express HTTP server on port 4040 with:
/// - `/mcp` — MCP Streamable HTTP for agent connections
/// - `/admin/*` — REST + Streamable HTTP for the VSCode extension

import crypto from "node:crypto";
import { execSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import express, { type Request, type Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  type AdminEventHub,
  type AgentEventHub,
  LogLevel,
  type LogMessage,
  type Logger,
  type TooManyCooksDb,
  createAdminEventHub,
  createAgentEventHub,
  createLoggerWithContext,
  createLoggingContext,
  createMcpServerForDb,
  defaultConfig,
  getServerPort,
  getWorkspaceFolder,
  logLevelName,
  logTransport,
  pathJoin,
  registerAdminRoutes,
} from "too-many-cooks-core";

import { createBackend } from "../src/backend.js";

/** JSON-RPC bad request error response. */
const BAD_REQUEST_JSON: string =
  '{"jsonrpc":"2.0","error":{"code":-32000,"message":"Bad Request"},"id":null}';

/** JSON-RPC session-not-found error response (404). */
const SESSION_NOT_FOUND_JSON: string =
  '{"jsonrpc":"2.0","error":{"code":-32001,"message":"Session not found"},"id":null}';

const main: () => Promise<void> = async (): Promise<void> => {
  const log: Logger = createLogger();
  log.info("Server starting...");
  try {
    await startServer(log);
  } catch (e) {
    log.fatal("Fatal error", { error: String(e) });
    throw e;
  }
};

/** Maximum time to wait for port to become free after killing a process. */
const PORT_FREE_TIMEOUT_MS: number = 5000;

/** Timeout for port check connection attempt (ms). */
const PORT_CHECK_TIMEOUT_MS: number = 500;

/** Delay between port-free polls in milliseconds. */
const PORT_POLL_DELAY_MS: number = 100;

/** Perform a raw TCP probe and return a Promise<boolean> (non-async to avoid require-await). */
// eslint-disable-next-line @typescript-eslint/promise-function-async
const tcpProbe: (port: number) => Promise<boolean> = (port: number): Promise<boolean> =>
  new Promise((resolve: (value: boolean) => void): void => {
    const socket: net.Socket = net.createConnection({ port, host: "127.0.0.1" });
    const timer: NodeJS.Timeout = setTimeout((): void => { socket.destroy(); resolve(false); }, PORT_CHECK_TIMEOUT_MS);
    socket.once("connect", (): void => { clearTimeout(timer); socket.destroy(); resolve(true); });
    socket.once("error", (): void => { clearTimeout(timer); resolve(false); });
  });

/** Check whether a port is in use by attempting a TCP connection. */
const isPortInUse: (port: number) => Promise<boolean> = async (port: number): Promise<boolean> =>
  await tcpProbe(port);

/** Kill any existing process listening on the given port and wait for it to be freed. */
const killExistingProcess: (port: number, log: Logger) => Promise<void> = async (port: number, log: Logger): Promise<void> => {
  const inUse: boolean = await isPortInUse(port);
  if (!inUse) {return;}
  log.info("Port in use, killing existing process", { port });
  try {
    const output: string = execSync(`lsof -ti :${String(port)}`, { encoding: "utf8" }).trim();
    if (output.length === 0) {return;}
    const pids: readonly string[] = output.split("\n").map((pid: string): string => {return pid.trim()}).filter((pid: string): boolean => {return pid.length > 0});
    for (const pid of pids) {
      log.info("Killing process", { port, pid });
      execSync(`kill -9 ${pid}`);
    }
    const start: number = Date.now();
    while (Date.now() - start < PORT_FREE_TIMEOUT_MS) {
      if (!(await isPortInUse(port))) {
        log.info("Port is now free", { port });
        return;
      }
      await new Promise((resolve: (value: undefined) => void): void => { setTimeout((): void => {resolve(undefined);}, PORT_POLL_DELAY_MS); });
    }
    log.warn("Port still in use after timeout — proceeding anyway", { port });
  } catch {
    // Lsof exits non-zero when no process found — that's fine
  }
};

const startServer: (log: Logger) => Promise<void> = async (log: Logger): Promise<void> => {
  log.info("Creating server...");

  const cfg: typeof defaultConfig = defaultConfig;

  const dbResult: ReturnType<typeof createBackend> = createBackend(cfg, log);
  if (!dbResult.ok) {throw new Error(dbResult.error);}
  const db: TooManyCooksDb = dbResult.value;
  log.info("Database created.");

  const transports: Map<string, StreamableHTTPServerTransport> = new Map<string, StreamableHTTPServerTransport>();
  const agentHub: AgentEventHub = createAgentEventHub();
  const adminHub: AdminEventHub = createAdminEventHub();

  const app: ReturnType<typeof express> = express();

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

  const port: number = getServerPort();
  await killExistingProcess(port, log);
  app.listen(port, (): void => {
    log.info("Server listening", { port });
  });

  // Keep event loop alive
  const KEEP_ALIVE_INTERVAL_MS: number = 60000;
  setInterval((): void => { /* Noop */ }, KEEP_ALIVE_INTERVAL_MS);
  await new Promise<void>((): void => { /* Noop */ });
};

/** Extract the mcp-session-id header as a string, or undefined. */
const extractSessionId: (req: Request) => string | undefined = (req: Request): string | undefined => {
  const raw: string[] | string | undefined = req.headers["mcp-session-id"];
  return Array.isArray(raw) ? raw[0] : raw;
};

/** Extract the request body as unknown. */
const extractBody: (req: Request) => unknown = (req: Request): unknown => req.body;

/**
 * Assert that a value satisfies both StreamableHTTPServerTransport and Transport.
 * Required due to exactOptionalPropertyTypes incompatibility in @modelcontextprotocol/sdk:
 * Transport.onclose is `() => void` but StreamableHTTPServerTransport.onclose is `(() => void) | undefined`.
 */
const assertMcpTransport: (transport: unknown) => asserts transport is StreamableHTTPServerTransport & Transport = (
  _transport: unknown,
): asserts _transport is StreamableHTTPServerTransport & Transport => { /* type-only assertion */ };

/** Check if a parsed JSON body is an MCP initialize request. */
const isInitializeRequest: (body: unknown) => boolean = (body: unknown): boolean => {
  if (typeof body !== "object" || body === null) {return false;}
  const method: unknown = "method" in body ? body.method : undefined;
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
const wireAgentTransportClose: (
  transport: StreamableHTTPServerTransport,
  ctx: McpSessionContext,
) => void = (
  transport: StreamableHTTPServerTransport,
  ctx: McpSessionContext,
): void => {
  transport.onclose = (): void => {
    const sid: string | undefined = transport.sessionId;
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
const initializeMcpSession: (
  req: Request,
  res: Response,
  ctx: McpSessionContext,
) => Promise<void> = async (
  req: Request,
  res: Response,
  ctx: McpSessionContext,
): Promise<void> => {
  const body: unknown = extractBody(req);
  const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
    sessionIdGenerator: (): string => {return crypto.randomUUID()},
    onsessioninitialized: (sid: string): void => {
      ctx.log.info("Session init", { sessionId: sid });
      ctx.transports.set(sid, transport);
    },
  });

  wireAgentTransportClose(transport, ctx);

  const serverResult: ReturnType<typeof createMcpServerForDb> = createMcpServerForDb(ctx.db, ctx.cfg, ctx.log, {
    adminPush: ctx.adminHub.pushEvent,
    agentPush: ctx.agentHub.pushEvent,
    agentPushToAgent: ctx.agentHub.pushToAgent,
    onSessionSet: (agentName: string): void => {
      const sid: string | undefined = transport.sessionId;
      if (sid !== undefined) {
        ctx.agentHub.sessionAgentNames.set(sid, agentName);
      }
    },
  });
  if (!serverResult.ok) {throw new Error(serverResult.error);}
  const server: McpServer = serverResult.value;
  assertMcpTransport(transport);
  await server.connect(transport);
  await transport.handleRequest(req, res, body);

  const sid: string | undefined = transport.sessionId;
  if (sid !== undefined) {
    ctx.agentHub.servers.set(sid, server);
  }
};

/** POST /mcp handler. */
const mcpPostHandler: (
  ctx: McpSessionContext,
) => (req: Request, res: Response) => Promise<void> = (
  ctx: McpSessionContext,
): ((req: Request, res: Response) => Promise<void>) =>
  {return async (req: Request, res: Response): Promise<void> => {
    const sessionId: string | undefined = extractSessionId(req);
    const body: unknown = extractBody(req);

    if (sessionId !== undefined && ctx.transports.has(sessionId)) {
      const existing: StreamableHTTPServerTransport | undefined = ctx.transports.get(sessionId);
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
  }};

/** GET/DELETE /mcp handler. */
const mcpGetDeleteHandler: (
  transports: Map<string, StreamableHTTPServerTransport>,
  agentHub: AgentEventHub,
) => (req: Request, res: Response) => Promise<void> = (
  transports: Map<string, StreamableHTTPServerTransport>,
  agentHub: AgentEventHub,
): ((req: Request, res: Response) => Promise<void>) =>
  {return async (req: Request, res: Response): Promise<void> => {
    const sessionId: string | undefined = extractSessionId(req);
    if (sessionId === undefined) {
      res.status(400).send("Missing session ID");
      return;
    }
    const transport: StreamableHTTPServerTransport | undefined = transports.get(sessionId);
    if (transport === undefined) {
      res.status(404).send(SESSION_NOT_FOUND_JSON);
      return;
    }
    agentHub.activeStreamSessions.add(sessionId);
    await transport.handleRequest(req, res);
  }};

/** Initialize an admin session (POST /admin/events with initialize body). */
const initializeAdminSession: (
  req: Request,
  res: Response,
  hub: AdminEventHub,
  log: Logger,
) => Promise<void> = async (
  req: Request,
  res: Response,
  hub: AdminEventHub,
  log: Logger,
): Promise<void> => {
  const body: unknown = extractBody(req);
  const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
    sessionIdGenerator: (): string => {return crypto.randomUUID()},
    onsessioninitialized: (sid: string): void => {
      log.info("Admin session init", { sessionId: sid });
      hub.transports.set(sid, transport);
    },
  });

  transport.onclose = (): void => {
    const sid: string | undefined = transport.sessionId;
    if (sid !== undefined) {
      log.info("Admin session closed", { sessionId: sid });
      hub.transports.delete(sid);
      hub.servers.delete(sid);
    }
  };

  const server: McpServer = new McpServer(
    { name: "too-many-cooks", version: "0.1.0" },
    { capabilities: { logging: {} } },
  );
  assertMcpTransport(transport);
  await server.connect(transport);
  await transport.handleRequest(req, res, body);

  const sid: string | undefined = transport.sessionId;
  if (sid !== undefined) {
    hub.servers.set(sid, server);
  }
};

/** POST /admin/events handler. */
const adminPostHandler: (
  hub: AdminEventHub,
  log: Logger,
) => (req: Request, res: Response) => Promise<void> = (
  hub: AdminEventHub,
  log: Logger,
): ((req: Request, res: Response) => Promise<void>) =>
  {return async (req: Request, res: Response): Promise<void> => {
    const sessionId: string | undefined = extractSessionId(req);
    const body: unknown = extractBody(req);

    if (sessionId !== undefined && hub.transports.has(sessionId)) {
      const existing: StreamableHTTPServerTransport | undefined = hub.transports.get(sessionId);
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
  }};

/** GET/DELETE /admin/events handler. */
const adminGetDeleteHandler: (
  hub: AdminEventHub,
) => (req: Request, res: Response) => Promise<void> = (
  hub: AdminEventHub,
): ((req: Request, res: Response) => Promise<void>) =>
  {return async (req: Request, res: Response): Promise<void> => {
    const sessionId: string | undefined = extractSessionId(req);
    if (sessionId === undefined) {
      res.status(400).send("Missing session ID");
      return;
    }
    const transport: StreamableHTTPServerTransport | undefined = hub.transports.get(sessionId);
    if (transport === undefined) {
      res.status(404).send(SESSION_NOT_FOUND_JSON);
      return;
    }
    await transport.handleRequest(req, res);
  }};

/** Wrap an async handler for Express. */
const asyncHandler: (
  fn: (req: Request, res: Response) => Promise<void>,
  log: Logger,
) => (req: Request, res: Response) => void = (
  fn: (req: Request, res: Response) => Promise<void>,
  log: Logger,
): ((req: Request, res: Response) => void) =>
  {return (req: Request, res: Response): void => {
    fn(req, res).catch((e: unknown): void => {
      log.error("Request error", { error: String(e) });
    });
  }};

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

const createLogger: () => Logger = (): Logger => {
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

main().catch((e: unknown): void => {
  console.error("Fatal:", e);
  process.exit(1);
});
