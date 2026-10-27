/// [SERVER-ROUTE-SESSIONS] Streamable-HTTP plumbing shared by the `/mcp` and
/// `/admin/events` route pairs.
///
/// The two route pairs differ only in which session map they consult and in how
/// a brand-new session is initialized (`initialize`), so the request handling
/// and Express wiring live here once.

import type { Request, Response } from "express";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Logger } from "too-many-cooks-core";

/** JSON-RPC bad request error response. */
const BAD_REQUEST_JSON: string =
  '{"jsonrpc":"2.0","error":{"code":-32000,"message":"Bad Request"},"id":null}';

/** JSON-RPC session-not-found error response (404). */
const SESSION_NOT_FOUND_JSON: string =
  '{"jsonrpc":"2.0","error":{"code":-32001,"message":"Session not found"},"id":null}';

/** HTTP 400 — malformed or session-less request. */
const STATUS_BAD_REQUEST: number = 400;

/** HTTP 404 — no live session for the presented ID. */
const STATUS_NOT_FOUND: number = 404;

/** Body of a GET/DELETE stream request that carries no session ID. */
const MISSING_SESSION_ID: string = "Missing session ID";

/** Header the transport uses to identify a session. */
const SESSION_ID_HEADER: string = "mcp-session-id";

/** Agent-facing MCP endpoint. */
const MCP_PATH: string = "/mcp";

/** Admin SSE endpoint. */
const ADMIN_EVENTS_PATH: string = "/admin/events";

/** The JSON-RPC `initialize` method that opens a session. */
const INITIALIZE_METHOD: string = "initialize";

/// [SERVER-ROUTE-SESSIONS] Per-route session wiring.
export type SessionRoute = {
  readonly transports: Map<string, StreamableHTTPServerTransport>;
  /** Creates the transport + MCP server for a brand-new session. */
  readonly initialize: (req: Request, res: Response) => Promise<void>;
  /** Hook run when a stream request arrives for an open session. */
  readonly onStreamOpen: (sessionId: string) => void;
};

/** The MCP and admin route pairs mounted by `registerSessionRoutes`. */
export type RouteSet = {
  readonly mcp: SessionRoute;
  readonly admin: SessionRoute;
};

/** Hook for routes that keep no per-session stream bookkeeping. */
export const ignoreStreamOpen: (sessionId: string) => void = (
  _sessionId: string,
): void => {
  /* admin sessions keep no active-stream set */
};

/** Extract the mcp-session-id header as a string, or undefined. */
export const extractSessionId: (req: Request) => string | undefined = (
  req: Request,
): string | undefined => {
  const raw: string[] | string | undefined = req.headers[SESSION_ID_HEADER];
  return Array.isArray(raw) ? raw[0] : raw;
};

/** Extract the request body as unknown. */
export const extractBody: (req: Request) => unknown = (req: Request): unknown =>
  req.body;

/** Check if a parsed JSON body is an MCP initialize request. */
export const isInitializeRequest: (body: unknown) => boolean = (
  body: unknown,
): boolean => {
  if (typeof body !== "object" || body === null) {return false;}
  const method: unknown = "method" in body ? body.method : undefined;
  return method === INITIALIZE_METHOD;
};

/** Answers a POST that presents a stale session, or opens a new one. */
const initializeOrRejectSession: (
  sessionId: string | undefined,
  body: unknown,
  req: Request,
  res: Response,
  route: SessionRoute,
) => Promise<void> = async (
  sessionId: string | undefined,
  body: unknown,
  req: Request,
  res: Response,
  route: SessionRoute,
): Promise<void> => {
  if (sessionId !== undefined) {
    res.status(STATUS_NOT_FOUND).send(SESSION_NOT_FOUND_JSON);
    return;
  }
  if (isInitializeRequest(body)) {
    await route.initialize(req, res);
    return;
  }
  res.status(STATUS_BAD_REQUEST).send(BAD_REQUEST_JSON);
};

/** POST body: reuse the live session, otherwise initialize or answer 4xx. */
const postSessionHandler: (
  route: SessionRoute,
) => (req: Request, res: Response) => Promise<void> = (
  route: SessionRoute,
): ((req: Request, res: Response) => Promise<void>) =>
  async (req: Request, res: Response): Promise<void> => {
    const sessionId: string | undefined = extractSessionId(req);
    const existing: StreamableHTTPServerTransport | undefined =
      sessionId === undefined ? undefined : route.transports.get(sessionId);
    if (existing !== undefined) {
      await existing.handleRequest(req, res, extractBody(req));
      return;
    }
    await initializeOrRejectSession(sessionId, extractBody(req), req, res, route);
  };

/** GET/DELETE: hand the stream request to the session's transport. */
const getDeleteSessionHandler: (
  route: SessionRoute,
) => (req: Request, res: Response) => Promise<void> = (
  route: SessionRoute,
): ((req: Request, res: Response) => Promise<void>) =>
  async (req: Request, res: Response): Promise<void> => {
    const sessionId: string | undefined = extractSessionId(req);
    if (sessionId === undefined) {
      res.status(STATUS_BAD_REQUEST).send(MISSING_SESSION_ID);
      return;
    }
    const transport: StreamableHTTPServerTransport | undefined =
      route.transports.get(sessionId);
    if (transport === undefined) {
      res.status(STATUS_NOT_FOUND).send(SESSION_NOT_FOUND_JSON);
      return;
    }
    route.onStreamOpen(sessionId);
    await transport.handleRequest(req, res);
  };

/** Wrap an async handler for Express. */
const asyncHandler: (
  fn: (req: Request, res: Response) => Promise<void>,
  log: Logger,
) => (req: Request, res: Response) => void = (
  fn: (req: Request, res: Response) => Promise<void>,
  log: Logger,
): ((req: Request, res: Response) => void) =>
  (req: Request, res: Response): void => {
    fn(req, res).catch((e: unknown): void => {
      log.error("Request error", { error: String(e) });
    });
  };

/** Mounts POST/GET/DELETE on both Streamable-HTTP route pairs. */
export const registerSessionRoutes: (
  app: { post: MountFn; get: MountFn; delete: MountFn },
  routes: RouteSet,
  log: Logger,
) => void = (
  app: { post: MountFn; get: MountFn; delete: MountFn },
  routes: RouteSet,
  log: Logger,
): void => {
  const mount: (path: string, route: SessionRoute) => void = (
    path: string,
    route: SessionRoute,
  ): void => {
    const post: (req: Request, res: Response) => void = asyncHandler(
      postSessionHandler(route),
      log,
    );
    const getDelete: (req: Request, res: Response) => void = asyncHandler(
      getDeleteSessionHandler(route),
      log,
    );
    app.post(path, post);
    app.get(path, getDelete);
    app.delete(path, getDelete);
  };
  mount(MCP_PATH, routes.mcp);
  mount(ADMIN_EVENTS_PATH, routes.admin);
};

/** Structural shape of Express's route-mounting methods. */
type MountFn = (path: string, handler: (req: Request, res: Response) => void) => void;
