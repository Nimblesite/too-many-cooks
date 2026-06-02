#!/usr/bin/env node
/// Entry point for Too Many Cooks MCP server.
///
/// Starts ONE Express HTTP server per workspace folder (default port 4040) with:
/// - `/mcp` — MCP Streamable HTTP for agent connections
/// - `/admin/*` — REST + Streamable HTTP for the VSCode extension
///
/// Process isolation is by folder and the server NEVER kills another process:
/// - [SERVER-SINGLE-INSTANCE] refuse to start if TMC already runs in this folder
/// - [SERVER-PORT-CONFLICT] step aside cleanly on EADDRINUSE (never kill the owner)
/// - [SERVER-STATE-ISOLATION] all state lives in `${workspace}/.too_many_cooks/`
/// - [SERVER-EPIPE] a dead stdio pipe can never loop into the logger
///
/// Implements the deploy-toolkit `--version` contract before anything else.

{
  const argv: string[] = process.argv.slice(2);
  const wantsVersion: boolean = argv.includes("--version") || argv.includes("-V");
  if (wantsVersion) {
    const name: string = "too-many-cooks";
    // Kept in sync with packages/too-many-cooks/package.json `version` and
    // packages/core/src/server.ts SERVER_VERSION by the release pipeline.
    const version: string = "0.5.0";
    if (argv.includes("--json")) {
      process.stdout.write(
        `${JSON.stringify({
          manifestVersion: 1,
          name,
          version,
          kind: "mcp",
          language: "typescript",
          product: "too-many-cooks",
        })}\n`,
      );
    } else {
      process.stdout.write(`${name} ${version}\n`);
    }
    process.exit(0);
  }
}

import crypto from "node:crypto";
import type { Server } from "node:http";
import express, { type Request, type Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  type AdminEventHub,
  type AgentEventHub,
  type Logger,
  type Result,
  type TooManyCooksDb,
  createAdminEventHub,
  createAgentEventHub,
  createMcpServerForDb,
  defaultConfig,
  getServerPort,
  getWorkspaceFolder,
  registerAdminRoutes,
} from "too-many-cooks-core";

import { createBackend } from "../src/backend.js";
import { createLogger } from "./logger.js";
import {
  type LockOutcome,
  acquireServerLock,
  errorCode,
  releaseServerLock,
  resolveLockPath,
} from "./server_lock.js";

/** JSON-RPC bad request error response. */
const BAD_REQUEST_JSON: string =
  '{"jsonrpc":"2.0","error":{"code":-32000,"message":"Bad Request"},"id":null}';

/** JSON-RPC session-not-found error response (404). */
const SESSION_NOT_FOUND_JSON: string =
  '{"jsonrpc":"2.0","error":{"code":-32001,"message":"Session not found"},"id":null}';

/// [SERVER-EPIPE] A dead stdout/stderr pipe is unrecoverable, not fatal-loopable.
/// Without an 'error' listener an EPIPE surfaces as an uncaughtException, which
/// used to re-enter the logger and write the "fatal" line to the same broken
/// stream forever — the multi-gigabyte log loop in issue #33. Consume it here.
const installPipeGuards: () => void = (): void => {
  const swallow: () => void = (): void => { /* a broken stdio pipe is not recoverable */ };
  process.stdout.on("error", swallow);
  process.stderr.on("error", swallow);
};

const installProcessHandlers: (log: Logger) => void = (log: Logger): void => {
  installPipeGuards();
  const shutdown: (signal: string) => void = (signal: string): void => {
    log.info("Server shutting down", { signal });
    process.exit(0);
  };
  process.on("SIGTERM", (): void => { shutdown("SIGTERM"); });
  process.on("SIGINT", (): void => { shutdown("SIGINT"); });
  process.on("uncaughtException", (err: Error): void => {
    if (errorCode(err) === "EPIPE") {return;} // [SERVER-EPIPE] never re-enter the logger on a dead pipe
    log.fatal("Uncaught exception", { error: String(err), stack: err.stack ?? "" });
  });
  process.on("unhandledRejection", (reason: unknown): void => {
    log.fatal("Unhandled rejection", { error: String(reason) });
  });
};

const main: () => Promise<void> = async (): Promise<void> => {
  const log: Logger = createLogger();
  installProcessHandlers(log);
  log.info("Server starting...");
  const workspace: string = getWorkspaceFolder();
  const port: number = getServerPort();
  const lockPath: string = resolveLockPath(workspace);
  guardSingleInstance(lockPath, workspace, port, log);
  process.on("exit", (): void => { releaseServerLock(lockPath); });
  try {
    await startServer(log, port);
  } catch (e) {
    log.fatal("Fatal error", { error: String(e) });
    throw e;
  }
};

/// [SERVER-SINGLE-INSTANCE] Claim this workspace folder, or exit cleanly if another
/// LIVE Too Many Cooks already owns it. The other process is left completely
/// untouched — we never kill it ([SERVER-NO-KILL]).
const guardSingleInstance: (lockPath: string, workspace: string, port: number, log: Logger) => void = (
  lockPath: string,
  workspace: string,
  port: number,
  log: Logger,
): void => {
  const result: Result<LockOutcome, string> = acquireServerLock(lockPath, port, Date.now());
  if (!result.ok) {
    log.fatal("Could not acquire single-instance lock", { workspace, error: result.error });
    process.exit(1);
  }
  if (result.value.kind === "busy") {
    log.error(
      "Too Many Cooks is already running in this folder — refusing to start a second instance",
      { workspace, existingPid: result.value.existing.pid, existingPort: result.value.existing.port },
    );
    process.exit(1);
  }
  log.info("Acquired single-instance lock", { workspace, port });
};

/// [SERVER-PORT-CONFLICT] If the port is taken, step aside cleanly. Too Many Cooks
/// NEVER kills the process holding a port ([SERVER-NO-KILL]) — run a different
/// folder on a different TMC_PORT instead.
const handleListenError: (err: Error, port: number, log: Logger) => void = (
  err: Error,
  port: number,
  log: Logger,
): void => {
  if (errorCode(err) === "EADDRINUSE") {
    log.error(
      "Port already in use by another process — stepping aside (Too Many Cooks never kills the process holding a port). Set TMC_PORT to run on a different port.",
      { port },
    );
    process.exit(1);
  }
  log.fatal("Server listen error", { port, error: String(err) });
  process.exit(1);
};

const startServer: (log: Logger, port: number) => Promise<void> = async (log: Logger, port: number): Promise<void> => {
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

  const server: Server = app.listen(port, (): void => {
    log.info("Server listening", { port });
  });
  // [SERVER-PORT-CONFLICT] Never crash unhandled on a busy port — step aside.
  server.on("error", (err: Error): void => { handleListenError(err, port, log); });

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

main().catch((e: unknown): void => {
  console.error("Fatal:", e);
  process.exit(1);
});
