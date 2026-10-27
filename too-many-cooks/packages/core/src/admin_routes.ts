/// Admin REST endpoints for the VSCode extension.
///
/// The VSIX talks to these endpoints - never touches the DB directly.
/// Streamable HTTP endpoint pushes all state changes in real-time.
/// SHARED: Used by both local and cloud deployments.

import express, { type Express, type Request, type Response } from "express";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { TooManyCooksDb } from "./db-interface.js";
import type { Result } from "./result.js";
import { optionalString } from "./tools/tool_utils.js";
import type { AgentIdentity, AgentPlan, AgentRegistration, DbError, FileLock, Message } from "./types.gen.js";
import {
  agentIdentityToJson,
  agentPlanToJson,
  agentRegistrationToJson,
  dbErrorToJson,
  fileLockToJson,
  messageToJson,
} from "./types.gen.js";

/** Logger name for admin push events. */
const ADMIN_LOGGER_NAME: string = "too-many-cooks-admin";

/** Admin event hub - manages Streamable HTTP transports for pushing real-time events to the VSIX. */
export type AdminEventHub = {
  readonly transports: Map<string, StreamableHTTPServerTransport>;
  readonly servers: Map<string, McpServer>;
  readonly pushEvent: (
    event: string,
    payload: Record<string, unknown>
  ) => void;
};

/** Send a push event to all connected admin servers. */
const sendToServer = async (
  entry: [string, McpServer],
  data: Record<string, unknown>,
  servers: Map<string, McpServer>,
  transports: Map<string, StreamableHTTPServerTransport>
): Promise<void> => {
  const [key, server]: [string, McpServer] = entry;
  console.error(`[TMC] [PUSH] Sending to ${key}`);
  try {
    await server.sendLoggingMessage({
      level: "info",
      logger: ADMIN_LOGGER_NAME,
      data,
    });
    console.error(`[TMC] [PUSH] Sent OK to ${key}`);
  } catch {
    console.error(`[TMC] [PUSH] FAILED ${key}`);
    servers.delete(key);
    transports.delete(key);
  }
};

/** Type guard for a plain object record. */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Helper to safely extract body as Record. */
const extractBody = (req: Request): Record<string, unknown> => {
  const body: unknown = req.body;
  return isRecord(body) ? body : {};
};

/** Create an admin event hub for Streamable HTTP push. */
export const createAdminEventHub = (): AdminEventHub => {
  const transports: Map<string, StreamableHTTPServerTransport> = new Map<string, StreamableHTTPServerTransport>();
  const servers: Map<string, McpServer> = new Map<string, McpServer>();

  const pushEvent: AdminEventHub["pushEvent"] = (
    event: string,
    payload: Record<string, unknown>
  ): void => {
    console.error(
      `[TMC] [PUSH] ${event} -> ${String(servers.size)} server(s), ${String(transports.size)} transport(s)`
    );
    const data: Record<string, unknown> = {
      event,
      timestamp: Date.now(),
      payload,
    };
    const pushes: ReadonlyArray<Promise<void>> = [...servers.entries()].map(
      async (entry: [string, McpServer]): Promise<void> => {
        await sendToServer(entry, data, servers, transports);
      }
    );
    Promise.all(pushes).catch((error: unknown): void => {
      console.error(`[TMC] [PUSH] ${event} delivery failed: ${String(error)}`);
    });
  };

  return { transports, servers, pushEvent };
};

/** Send an error response. */
const sendError = (res: Response, code: number, message: string): void => {
  res.status(code).send(message);
};

/** Send a database error as an HTTP error response. */
const sendDbError = (res: Response, code: number, error: DbError): void => {
  sendError(res, code, JSON.stringify(dbErrorToJson(error)));
};

/** Extract a required string field, sending a 400 response when absent. */
const requireStringField = (res: Response, body: Record<string, unknown>, field: string): string | null => {
  const value: string | null = optionalString(body, field);
  if (value === null) {
    sendError(res, 400, `${field} required`);
  }
  return value;
};

/** Register GET /admin/status route. */
const registerStatusRoute = (app: Express, db: TooManyCooksDb): void => {
  app.get("/admin/status", async (_req: Request, res: Response) => {
    const agentsResult: Result<readonly AgentIdentity[], DbError> = await db.listAgents();
    const agents: Array<Record<string, unknown>> = agentsResult.ok
      ? agentsResult.value.map(agentIdentityToJson)
      : [];
    const locksResult: Result<readonly FileLock[], DbError> = await db.listLocks();
    const locks: Array<Record<string, unknown>> = locksResult.ok
      ? locksResult.value.map(fileLockToJson)
      : [];
    const plansResult: Result<readonly AgentPlan[], DbError> = await db.listPlans();
    const plans: Array<Record<string, unknown>> = plansResult.ok
      ? plansResult.value.map(agentPlanToJson)
      : [];
    const messagesResult: Result<readonly Message[], DbError> = await db.listAllMessages();
    const messages: Array<Record<string, unknown>> = messagesResult.ok
      ? messagesResult.value.map(messageToJson)
      : [];
    res
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ agents, locks, plans, messages }));
  });
};

/** Register POST /admin/delete-lock route. */
const registerDeleteLockRoute = (app: Express, db: TooManyCooksDb, hub: AdminEventHub): void => {
  registerDeleteRoute(
    app,
    hub,
    "/admin/delete-lock",
    "filePath",
    "lock_released",
    (value: string): Record<string, unknown> => ({ file_path: value }),
    async (value: string): Promise<Result<void, DbError>> => await db.adminDeleteLock(value)
  );
};

/** Register POST /admin/delete-agent route. */
const registerDeleteAgentRoute = (app: Express, db: TooManyCooksDb, hub: AdminEventHub): void => {
  registerDeleteRoute(
    app,
    hub,
    "/admin/delete-agent",
    "agentName",
    "agent_deleted",
    (value: string): Record<string, unknown> => ({ agent_name: value }),
    async (value: string): Promise<Result<void, DbError>> => await db.adminDeleteAgent(value)
  );
};

/** Shared handler for the two admin delete routes: one required field, one
 *  void Result call, then a push event + `{ deleted: true }` on success. */
const registerDeleteRoute = (
  app: Express,
  hub: AdminEventHub,
  routePath: string,
  field: string,
  event: string,
  payload: (value: string) => Record<string, unknown>,
  op: (value: string) => Promise<Result<void, DbError>>
): void => {
  app.post(routePath, async (req: Request, res: Response) => {
    const value: string | null = requireStringField(res, extractBody(req), field);
    if (value === null) { return; }
    const result: Result<void, DbError> = await op(value);
    if (result.ok) {
      hub.pushEvent(event, payload(value));
      res.send(JSON.stringify({ deleted: true }));
    } else {
      sendDbError(res, 400, result.error);
    }
  });
};

/** Register POST /admin/reset-key route. */
const registerResetKeyRoute = (app: Express, db: TooManyCooksDb): void => {
  app.post("/admin/reset-key", async (req: Request, res: Response) => {
    const agentName: string | null = requireStringField(res, extractBody(req), "agentName");
    if (agentName === null) { return; }
    const result: Result<AgentRegistration, DbError> = await db.adminResetKey(agentName);
    if (result.ok) {
      res.send(JSON.stringify(agentRegistrationToJson(result.value)));
    } else {
      sendDbError(res, 400, result.error);
    }
  });
};

/** Register POST /admin/send-message route. */
const registerSendMessageRoute = (app: Express, db: TooManyCooksDb, hub: AdminEventHub): void => {
  app.post("/admin/send-message", async (req: Request, res: Response) => {
    const body: Record<string, unknown> = extractBody(req);
    const fromAgent: string | null = optionalString(body, "fromAgent");
    const toAgent: string | null = optionalString(body, "toAgent");
    const content: string | null = optionalString(body, "content");
    if (fromAgent === null || toAgent === null || content === null) {
      sendError(res, 400, "fromAgent, toAgent, content required");
      return;
    }
    const result: Result<string, DbError> = await db.adminSendMessage(fromAgent, toAgent, content);
    if (result.ok) {
      hub.pushEvent("message_sent", {
        from_agent: fromAgent,
        to_agent: toAgent,
        message_id: result.value,
      });
      res.send(JSON.stringify({ sent: true, message_id: result.value }));
    } else {
      sendDbError(res, 400, result.error);
    }
  });
};

/** Register POST /admin/reset route. */
const registerResetRoute = (app: Express, db: TooManyCooksDb, hub: AdminEventHub): void => {
  app.post("/admin/reset", async (_req: Request, res: Response) => {
    const result: Result<void, DbError> = await db.adminReset();
    if (result.ok) {
      hub.pushEvent("state_reset", {});
      res.send(JSON.stringify({ reset: true }));
    } else {
      sendDbError(res, 500, result.error);
    }
  });
};

/** Register all admin routes on an Express app. */
export const registerAdminRoutes = (app: Express, db: TooManyCooksDb, hub: AdminEventHub): void => {
  app.use(express.json());
  registerStatusRoute(app, db);
  registerDeleteLockRoute(app, db, hub);
  registerDeleteAgentRoute(app, db, hub);
  registerResetKeyRoute(app, db);
  registerSendMessageRoute(app, db, hub);
  registerResetRoute(app, db, hub);
};
