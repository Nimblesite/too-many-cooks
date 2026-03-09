/// Admin REST endpoints for the VSCode extension.
///
/// The VSIX talks to these endpoints - never touches the DB directly.
/// Streamable HTTP endpoint pushes all state changes in real-time.

import express, { type Request, type Response, type Express } from "express";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  type TooManyCooksDb,
  agentIdentityToJson,
  fileLockToJson,
  agentPlanToJson,
  messageToJson,
  agentRegistrationToJson,
  dbErrorToJson,
} from "./data/data.js";

/** Logger name for admin push events. */
const ADMIN_LOGGER_NAME = "too-many-cooks-admin";

/** Admin event hub - manages Streamable HTTP transports for pushing real-time events to the VSIX. */
export type AdminEventHub = {
  readonly transports: Map<string, StreamableHTTPServerTransport>;
  readonly servers: Map<string, McpServer>;
  readonly pushEvent: (
    event: string,
    payload: Record<string, unknown>,
  ) => void;
};

/** Send a push event to all connected admin servers. */
const sendToServer = async (
  entry: [string, McpServer],
  data: Record<string, unknown>,
  servers: Map<string, McpServer>,
  transports: Map<string, StreamableHTTPServerTransport>,
): Promise<void> => {
  const [key, server] = entry;
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

/** Create an admin event hub for Streamable HTTP push. */
export const createAdminEventHub = (): AdminEventHub => {
  const transports = new Map<string, StreamableHTTPServerTransport>();
  const servers = new Map<string, McpServer>();

  const pushEvent = (
    event: string,
    payload: Record<string, unknown>,
  ): void => {
    console.error(
      `[TMC] [PUSH] ${event} -> ${String(servers.size)} server(s), ${String(transports.size)} transport(s)`,
    );
    const data: Record<string, unknown> = {
      event,
      timestamp: Date.now(),
      payload,
    };
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    Promise.all(
      [...servers.entries()].map(
        // eslint-disable-next-line require-await
        async (entry) => sendToServer(entry, data, servers, transports),
      ),
    );
  };

  return { transports, servers, pushEvent };
};

/** Send an error response. */
const sendError = (res: Response, code: number, message: string): void => {
  res.status(code).send(message);
};

/** Extract a string field from the request body, or undefined. */
const stringField = (
  body: Record<string, unknown>,
  field: string,
): string | undefined => {
  const value = body[field];
  return typeof value === "string" ? value : undefined;
};

/** Register GET /admin/status route. */
const registerStatusRoute = (app: Express, db: TooManyCooksDb): void => {
  app.get("/admin/status", (_req: Request, res: Response) => {
    const agentsResult = db.listAgents();
    const agents = agentsResult.ok
      ? agentsResult.value.map(agentIdentityToJson)
      : [];
    const locksResult = db.listLocks();
    const locks = locksResult.ok
      ? locksResult.value.map(fileLockToJson)
      : [];
    const plansResult = db.listPlans();
    const plans = plansResult.ok
      ? plansResult.value.map(agentPlanToJson)
      : [];
    const messagesResult = db.listAllMessages();
    const messages = messagesResult.ok
      ? messagesResult.value.map(messageToJson)
      : [];
    res
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ agents, locks, plans, messages }));
  });
};

/** Register POST /admin/delete-lock route. */
const registerDeleteLockRoute = (
  app: Express,
  db: TooManyCooksDb,
  hub: AdminEventHub,
): void => {
  app.post("/admin/delete-lock", (req: Request, res: Response) => {
    const filePath = stringField(req.body as Record<string, unknown>, "filePath");
    if (filePath === undefined) {
      sendError(res, 400, "filePath required");
      return;
    }
    const result = db.adminDeleteLock(filePath);
    if (result.ok) {
      hub.pushEvent("lock_released", { file_path: filePath });
      res.send(JSON.stringify({ deleted: true }));
    } else {
      sendError(res, 400, JSON.stringify(dbErrorToJson(result.error)));
    }
  });
};

/** Register POST /admin/delete-agent route. */
const registerDeleteAgentRoute = (
  app: Express,
  db: TooManyCooksDb,
  hub: AdminEventHub,
): void => {
  app.post("/admin/delete-agent", (req: Request, res: Response) => {
    const agentName = stringField(req.body as Record<string, unknown>, "agentName");
    if (agentName === undefined) {
      sendError(res, 400, "agentName required");
      return;
    }
    const result = db.adminDeleteAgent(agentName);
    if (result.ok) {
      hub.pushEvent("agent_deleted", { agent_name: agentName });
      res.send(JSON.stringify({ deleted: true }));
    } else {
      sendError(res, 400, JSON.stringify(dbErrorToJson(result.error)));
    }
  });
};

/** Register POST /admin/reset-key route. */
const registerResetKeyRoute = (
  app: Express,
  db: TooManyCooksDb,
): void => {
  app.post("/admin/reset-key", (req: Request, res: Response) => {
    const agentName = stringField(req.body as Record<string, unknown>, "agentName");
    if (agentName === undefined) {
      sendError(res, 400, "agentName required");
      return;
    }
    const result = db.adminResetKey(agentName);
    if (result.ok) {
      res.send(JSON.stringify(agentRegistrationToJson(result.value)));
    } else {
      sendError(res, 400, JSON.stringify(dbErrorToJson(result.error)));
    }
  });
};

/** Register POST /admin/send-message route. */
const registerSendMessageRoute = (
  app: Express,
  db: TooManyCooksDb,
  hub: AdminEventHub,
): void => {
  app.post("/admin/send-message", (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const fromAgent = stringField(body, "fromAgent");
    const toAgent = stringField(body, "toAgent");
    const content = stringField(body, "content");
    if (fromAgent === undefined || toAgent === undefined || content === undefined) {
      sendError(res, 400, "fromAgent, toAgent, content required");
      return;
    }
    const result = db.adminSendMessage(fromAgent, toAgent, content);
    if (result.ok) {
      hub.pushEvent("message_sent", {
        from_agent: fromAgent,
        to_agent: toAgent,
        message_id: result.value,
      });
      res.send(JSON.stringify({ sent: true, message_id: result.value }));
    } else {
      sendError(res, 400, JSON.stringify(dbErrorToJson(result.error)));
    }
  });
};

/** Register POST /admin/reset route. */
const registerResetRoute = (
  app: Express,
  db: TooManyCooksDb,
  hub: AdminEventHub,
): void => {
  app.post("/admin/reset", (_req: Request, res: Response) => {
    const result = db.adminReset();
    if (result.ok) {
      hub.pushEvent("state_reset", {});
      res.send(JSON.stringify({ reset: true }));
    } else {
      sendError(res, 500, JSON.stringify(dbErrorToJson(result.error)));
    }
  });
};

/** Register all admin routes on an Express app. */
export const registerAdminRoutes = (
  app: Express,
  db: TooManyCooksDb,
  hub: AdminEventHub,
): void => {
  app.use(express.json());
  registerStatusRoute(app, db);
  registerDeleteLockRoute(app, db, hub);
  registerDeleteAgentRoute(app, db, hub);
  registerResetKeyRoute(app, db);
  registerSendMessageRoute(app, db, hub);
  registerResetRoute(app, db, hub);
};
