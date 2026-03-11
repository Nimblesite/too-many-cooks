/**
 * Notification system for push-based updates.
 *
 * All events are pushed automatically to every connected client
 * (agents + VSIX). There is no subscribe tool — subscriptions
 * are managed entirely by the server based on connection state.
 *
 * Agents receive notifications via MCP logging messages on their
 * Streamable HTTP session. This is CRITICAL — agents must know
 * about new messages, lock changes, and agent status in
 * real-time without polling.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type Result, error, success } from "./result.js";

// ---------------------------------------------------------------------------
// Event constants
// ---------------------------------------------------------------------------

export const EVENT_AGENT_REGISTERED = "agent_registered";
export const EVENT_AGENT_ACTIVATED = "agent_activated";
export const EVENT_AGENT_DEACTIVATED = "agent_deactivated";
export const EVENT_LOCK_ACQUIRED = "lock_acquired";
export const EVENT_LOCK_RELEASED = "lock_released";
export const EVENT_LOCK_RENEWED = "lock_renewed";
export const EVENT_MESSAGE_SENT = "message_sent";
export const EVENT_PLAN_UPDATED = "plan_updated";

export const AGENT_LOGGER_NAME = "too-many-cooks";
export const BROADCAST_RECIPIENT = "*";

// ---------------------------------------------------------------------------
// Callback types
// ---------------------------------------------------------------------------

export type EventPushFn = (
  event: string,
  payload: Record<string, unknown>,
) => void;

export type EventPushToAgentFn = (
  event: string,
  payload: Record<string, unknown>,
  toAgent: string,
) => void;

// ---------------------------------------------------------------------------
// AgentEventHub
// ---------------------------------------------------------------------------

export type AgentEventHub = {
  readonly servers: Map<string, McpServer>;
  /** sessionId → agentName, populated on register. */
  readonly sessionAgentNames: Map<string, string>;
  /** Sessions with an active Streamable HTTP GET stream. */
  readonly activeStreamSessions: Set<string>;
  readonly pushEvent: EventPushFn;
  readonly pushToAgent: EventPushToAgentFn;
};

// ---------------------------------------------------------------------------
// sendNotification
// ---------------------------------------------------------------------------

export const sendNotification = async (
  server: McpServer,
  data: Record<string, unknown>,
): Promise<Result<void, string>> => {
  try {
    await server.sendLoggingMessage({
      level: "info",
      logger: AGENT_LOGGER_NAME,
      data,
    });
    return success(undefined);
  } catch (e: unknown) {
    return error(String(e));
  }
};

// ---------------------------------------------------------------------------
// createAgentEventHub
// ---------------------------------------------------------------------------

/** Swallow promise rejection silently. */
const noop = (): void => { /* noop */ };

/** Fire-and-forget a promise. */
const fireAndForget = (promise: Promise<void>): void => {
  promise.catch(noop);
};

/** Build a structured event data envelope. */
const makeEventData = (
  event: string,
  payload: Record<string, unknown>,
): Record<string, unknown> => ({
  event,
  timestamp: Date.now(),
  payload,
});

/** Create send function that pushes to a single agent session. */
const createSendFn = (
  activeStreamSessions: Set<string>,
): ((sid: string, srv: McpServer, d: Record<string, unknown>) => Promise<void>) =>
  async (sessionId: string, server: McpServer, data: Record<string, unknown>): Promise<void> => {
    if (!activeStreamSessions.has(sessionId)) {
      // No active Streamable HTTP connection — skip silently.
      // Do NOT delete the session — the agent may reconnect later.
      return;
    }
    console.error(`[TMC] [AGENT-PUSH] Sending to ${sessionId}`);
    const result = await sendNotification(server, data);
    if (result.ok) {
      console.error(`[TMC] [AGENT-PUSH] Sent OK to ${sessionId}`);
    } else {
      console.error(`[TMC] [AGENT-PUSH] Skipped ${sessionId} (send failed)`);
    }
  };

export const createAgentEventHub = (): AgentEventHub => {
  const servers = new Map<string, McpServer>();
  const sessionAgentNames = new Map<string, string>();
  const activeStreamSessions = new Set<string>();
  const send = createSendFn(activeStreamSessions);

  const pushEvent: EventPushFn = (event, payload) => {
    console.error(
      `[TMC] [AGENT-PUSH] ${event} → ${String(servers.size)} agent(s)`,
    );
    const data = makeEventData(event, payload);
    for (const [sessionId, server] of [...servers.entries()]) {
      fireAndForget(send(sessionId, server, data));
    }
  };

  const pushToAgent: EventPushToAgentFn = (event, payload, toAgent) => {
    const data = makeEventData(event, payload);
    if (toAgent === BROADCAST_RECIPIENT) {
      console.error(
        `[TMC] [AGENT-PUSH] ${event} (broadcast) → ${String(servers.size)} agent(s)`,
      );
      for (const [sessionId, server] of [...servers.entries()]) {
        fireAndForget(send(sessionId, server, data));
      }
    } else {
      for (const [sessionId, agentName] of [...sessionAgentNames.entries()]) {
        if (agentName === toAgent) {
          const server = servers.get(sessionId);
          if (server !== undefined) {
            fireAndForget(send(sessionId, server, data));
          }
        }
      }
    }
  };

  return { servers, sessionAgentNames, activeStreamSessions, pushEvent, pushToAgent };
};

// ---------------------------------------------------------------------------
// NotificationEmitter
// ---------------------------------------------------------------------------

export type NotificationEmitter = {
  readonly emit: (
    event: string,
    payload: Record<string, unknown>,
  ) => void;
  /** Push only to admin (VSIX), not to agents. */
  readonly emitAdmin: (
    event: string,
    payload: Record<string, unknown>,
  ) => void;
  /** Push only to a specific agent by name, or '*' for all. */
  readonly emitToAgent: (
    event: string,
    payload: Record<string, unknown>,
    toAgent: string,
  ) => void;
};

export const createNotificationEmitter = (
  _server: McpServer,
  adminPush?: EventPushFn,
  agentPush?: EventPushFn,
  agentPushToAgent?: EventPushToAgentFn,
): NotificationEmitter => {
  const emit: NotificationEmitter["emit"] = (event, payload) => {
    adminPush?.(event, payload);
    agentPush?.(event, payload);
  };

  const emitAdmin: NotificationEmitter["emitAdmin"] = (event, payload) => {
    adminPush?.(event, payload);
  };

  const emitToAgent: NotificationEmitter["emitToAgent"] = (
    event,
    payload,
    toAgent,
  ) => {
    adminPush?.(event, payload);
    agentPushToAgent?.(event, payload, toAgent);
  };

  return { emit, emitAdmin, emitToAgent };
};
