/// Message tool - inter-agent messaging.

import type { Logger } from "../logger.js";
import type { NotificationEmitter } from "../notifications.js";
import { EVENT_MESSAGE_SENT } from "../notifications.js";
import type { TooManyCooksDb } from "../db-interface.js";
import type { Result } from "../result.js";
import type { DbError, Message } from "../types.js";
import { messageToJson } from "../types.js";
import type { CallToolResult, SessionGetter, ToolCallback } from "../mcp-types.js";
import { errorContent, jsonResult, listJsonResult, makeErrorResult, requireActionArg, unknownActionError, withResolvedAgent } from "./tool_utils.js";

/** Input schema for message tool. */
export const MESSAGE_INPUT_SCHEMA: {
  readonly type: "object";
  readonly properties: Record<string, unknown>;
  readonly required: readonly string[];
} = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["send", "get", "mark_read"],
      description: "Message action to perform",
    },
    to_agent: {
      type: "string",
      description: "Recipient name or * for broadcast (for send)",
    },
    content: {
      type: "string",
      maxLength: 200,
      description: "Message content (for send). MUST be 200 chars or less.",
    },
    message_id: {
      type: "string",
      description: "Message ID (for mark_read)",
    },
    unread_only: {
      type: "boolean",
      description: "Only return unread messages (default: true)",
    },
  },
  required: ["action"],
} as const;

/** Tool config for message. */
export const MESSAGE_TOOL_CONFIG: {
  readonly title: string;
  readonly description: string;
  readonly inputSchema: typeof MESSAGE_INPUT_SCHEMA;
  readonly outputSchema: null;
  readonly annotations: null;
} = {
  title: "Message",
  description:
    "Send/receive messages. You must register first. " +
    "REQUIRED: action (send|get|mark_read). " +
    "For send: to_agent, content. For mark_read: message_id. " +
    'Example send: {"action":"send","to_agent":"other","content":"hello"}',
  inputSchema: MESSAGE_INPUT_SCHEMA,
  outputSchema: null,
  annotations: null,
} as const;

// ---------------------------------------------------------------------------
// Action dispatch
// ---------------------------------------------------------------------------

const dispatchAction: (
  action: string,
  db: TooManyCooksDb,
  emitter: NotificationEmitter,
  log: Logger,
  agentName: string,
  agentKey: string,
  args: Record<string, unknown>,
) => Promise<CallToolResult> = async (
  action: string,
  db: TooManyCooksDb,
  emitter: NotificationEmitter,
  log: Logger,
  agentName: string,
  agentKey: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> => {
  switch (action) {
    case "send":
      return await handleSend(
        db,
        emitter,
        log,
        agentName,
        agentKey,
        typeof args.to_agent === "string" ? args.to_agent : null,
        typeof args.content === "string" ? args.content : null,
      );
    case "get":
      return await handleGet(
        db,
        agentName,
        agentKey,
        typeof args.unread_only === "boolean"
          ? args.unread_only
          : true,
      );
    case "mark_read":
      return await handleMarkRead(
        db,
        agentName,
        agentKey,
        typeof args.message_id === "string" ? args.message_id : null,
      );
    default:
      return unknownActionError(action);
  }
};

/** Create message tool handler. */
export const createMessageHandler: (
  db: TooManyCooksDb,
  emitter: NotificationEmitter,
  logger: Logger,
  getSession: SessionGetter,
) => ToolCallback = (
  db: TooManyCooksDb,
  emitter: NotificationEmitter,
  logger: Logger,
  getSession: SessionGetter,
): ToolCallback =>
  {return async (args: Record<string, unknown>): Promise<CallToolResult> => {
    const actionOrError: string | CallToolResult = requireActionArg(args);
    if (typeof actionOrError !== "string") {return actionOrError;}
    const action: string = actionOrError;
    const log: Logger = logger.child({ tool: "message", action });

    return await withResolvedAgent(db, args, getSession, async (agentName: string, agentKey: string): Promise<CallToolResult> =>
      await dispatchAction(action, db, emitter, log, agentName, agentKey, args));
  }};

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

const handleSend: (
  db: TooManyCooksDb,
  emitter: NotificationEmitter,
  log: Logger,
  agentName: string,
  agentKey: string,
  toAgent: string | null,
  content: string | null,
) => Promise<CallToolResult> = async (
  db: TooManyCooksDb,
  emitter: NotificationEmitter,
  log: Logger,
  agentName: string,
  agentKey: string,
  toAgent: string | null,
  content: string | null,
): Promise<CallToolResult> => {
  if (toAgent === null || content === null) {
    return errorContent("send requires to_agent and content");
  }
  const result: Result<string, DbError> = await db.sendMessage(agentName, agentKey, toAgent, content);
  if (!result.ok) {return makeErrorResult(result.error);}
  emitter.emitToAgent(
    EVENT_MESSAGE_SENT,
    {
      message_id: result.value,
      from_agent: agentName,
      to_agent: toAgent,
      content,
    },
    toAgent,
  );
  log.info(`Message sent from ${agentName} to ${toAgent}`);
  return jsonResult({ sent: true, message_id: result.value });
};

// ---------------------------------------------------------------------------
// Get
// ---------------------------------------------------------------------------

const handleGet: (
  db: TooManyCooksDb,
  agentName: string,
  agentKey: string,
  unreadOnly: boolean,
) => Promise<CallToolResult> = async (
  db: TooManyCooksDb,
  agentName: string,
  agentKey: string,
  unreadOnly: boolean,
): Promise<CallToolResult> => {
  const result: Result<readonly Message[], DbError> = await db.getMessages(agentName, agentKey, { unreadOnly });
  return listJsonResult(result, "messages", messageToJson);
};

// ---------------------------------------------------------------------------
// Mark read
// ---------------------------------------------------------------------------

const handleMarkRead: (
  db: TooManyCooksDb,
  agentName: string,
  agentKey: string,
  messageId: string | null,
) => Promise<CallToolResult> = async (
  db: TooManyCooksDb,
  agentName: string,
  agentKey: string,
  messageId: string | null,
): Promise<CallToolResult> => {
  if (messageId === null) {
    return errorContent("mark_read requires message_id");
  }
  const result: Result<void, DbError> = await db.markRead(messageId, agentName, agentKey);
  if (!result.ok) {return makeErrorResult(result.error);}
  return jsonResult({ marked: true });
};
