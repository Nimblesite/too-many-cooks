/// Message tool - inter-agent messaging.

import { z } from "zod";

import type { Logger } from "../logger.js";
import type { NotificationEmitter } from "../notifications.js";
import { EVENT_MESSAGE_SENT } from "../notifications.js";
import type { TooManyCooksDb } from "../db-interface.js";
import type { Result } from "../result.js";
import type { DbError, Message } from "../types.js";
import { messageToJson } from "../types.js";
import type { CallToolResult, SessionGetter, ToolCallback } from "../mcp-types.js";
import { DEFAULT_MAX_MESSAGE_LENGTH } from "../config.js";
import { 
  actionContext,
  agentKeyField,
  errorContent,
  jsonResult,
  limitedText,
  listJsonResult,
  makeErrorResult,
  optionalString,
  rejectedNeverTruncated,
  toJsonSchema,
  toolConfig,
  unknownActionError,
  withResolvedAgent,
} from "./tool_utils.js";
import type { ActionContext } from "./tool_utils.js";

/** Message tool input — the ONE source of the wire schema. [MCP-TOOL-LIMITS] */
export const messageInputShape = (maxContentLength: number): z.ZodRawShape => ({
  action: z.enum(["send", "get", "mark_read"]).describe("Message action to perform"),
  to_agent: z.string().optional().describe("Recipient name or * for broadcast (for send)"),
  content: limitedText("content", maxContentLength, "Message content (for send)."),
  message_id: z.string().optional().describe("Message ID (for mark_read)"),
  unread_only: z.boolean().optional().describe("Only return unread messages (default: true)"),
  agent_key: agentKeyField,
});

/** Message tool description — leads with the hard limit agents keep missing. */
export const messageToolDescription = (maxContentLength: number): string =>
  `HARD LIMIT: content must be ${String(maxContentLength)} characters or fewer. ${rejectedNeverTruncated("messages")}` +
  "Keep it short; put detail in a file and send its path. " +
  "Send/receive messages. You must register first. " +
  "REQUIRED: action (send|get|mark_read). " +
  "For send: to_agent, content. For mark_read: message_id. " +
  'Example send: {"action":"send","to_agent":"other","content":"hello"}';

/** JSON Schema of the message input at the default limit (derived from the zod shape). */
export const MESSAGE_INPUT_SCHEMA: Record<string, unknown> = toJsonSchema(messageInputShape(DEFAULT_MAX_MESSAGE_LENGTH));

/** Tool config for message (default limit; the server uses the configured one). */
export const MESSAGE_TOOL_CONFIG = toolConfig(
  "Message",
  messageToolDescription(DEFAULT_MAX_MESSAGE_LENGTH),
  MESSAGE_INPUT_SCHEMA
);

// ---------------------------------------------------------------------------
// Action dispatch
// ---------------------------------------------------------------------------

const dispatchAction = async (
  action: string,
  db: TooManyCooksDb,
  emitter: NotificationEmitter,
  log: Logger,
  agentName: string,
  agentKey: string,
  args: Record<string, unknown>
): Promise<CallToolResult> => {
  switch (action) {
    case "send":
      return await handleSend(
        db,
        emitter,
        log,
        agentName,
        agentKey,
        optionalString(args, "to_agent"),
        optionalString(args, "content")
      );
    case "get":
      return await handleGet(
        db,
        agentName,
        agentKey,
        typeof args.unread_only === "boolean"
          ? args.unread_only
          : true
      );
    case "mark_read":
      return await handleMarkRead(
        db,
        agentName,
        agentKey,
        optionalString(args, "message_id")
      );
    default:
      return unknownActionError(action);
  }
};

/** Create message tool handler. */
export const createMessageHandler = (
  db: TooManyCooksDb,
  emitter: NotificationEmitter,
  logger: Logger,
  getSession: SessionGetter
): ToolCallback => {
  return async (args: Record<string, unknown>): Promise<CallToolResult> => {
    const ctx: ActionContext = actionContext(args, logger, "message", {});
    if (ctx.isError) {return ctx.result;}

    return await withResolvedAgent(db, args, getSession, async (agentName: string, agentKey: string): Promise<CallToolResult> =>
      await dispatchAction(ctx.action, db, emitter, ctx.log, agentName, agentKey, args));
  };
};

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

const handleSend = async (
  db: TooManyCooksDb,
  emitter: NotificationEmitter,
  log: Logger,
  agentName: string,
  agentKey: string,
  toAgent: string | null,
  content: string | null
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
    toAgent
  );
  log.info(`Message sent from ${agentName} to ${toAgent}`);
  return jsonResult({ sent: true, message_id: result.value });
};

// ---------------------------------------------------------------------------
// Get
// ---------------------------------------------------------------------------

const handleGet = async (
  db: TooManyCooksDb,
  agentName: string,
  agentKey: string,
  unreadOnly: boolean
): Promise<CallToolResult> => {
  const result: Result<readonly Message[], DbError> = await db.getMessages(agentName, agentKey, { unreadOnly });
  return listJsonResult(result, "messages", messageToJson);
};

// ---------------------------------------------------------------------------
// Mark read
// ---------------------------------------------------------------------------

const handleMarkRead = async (
  db: TooManyCooksDb,
  agentName: string,
  agentKey: string,
  messageId: string | null
): Promise<CallToolResult> => {
  if (messageId === null) {
    return errorContent("mark_read requires message_id");
  }
  const result: Result<void, DbError> = await db.markRead(messageId, agentName, agentKey);
  if (!result.ok) {return makeErrorResult(result.error);}
  return jsonResult({ marked: true });
};
