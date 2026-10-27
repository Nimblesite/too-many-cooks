/// Status tool - system overview.

import type { z } from "zod";

import type { Logger } from "../logger.js";
import type { MessageHeader, MessageOverview, TooManyCooksDb } from "../db-interface.js";
import type { Result } from "../result.js";
import type { DbError } from "../types.js";
import {
  agentIdentityToJson,
  agentPlanToJson,
  fileLockToJson,
} from "../types.js";
import type { CallToolResult, SessionGetter, ToolCallback } from "../mcp-types.js";
import { agentKeyField, jsonResult, type IdentityResult, makeErrorResult, mapListToJson, resolveIdentity, toJsonSchema, toolConfig } from "./tool_utils.js";

/// [STATUS-BOUNDED] Issues #41/#42: cap on the recent-header slice embedded in a
/// status overview. The payload is bounded by this constant regardless of how
/// many messages exist on the server.
const RECENT_MESSAGE_LIMIT: number = 20;

/// [STATUS-BOUNDED] Serialize a header to JSON — id/from/to/timestamps only,
/// NEVER the body. Full message content is the job of the `message get` tool.
const messageHeaderToJson = (header: MessageHeader): Record<string, unknown> => ({
  id: header.id,
  from_agent: header.fromAgent,
  to_agent: header.toAgent,
  created_at: header.createdAt,
  ...(header.readAt === undefined ? {} : { read_at: header.readAt }),
});

/** Status tool input — the ONE source of the wire schema. */
export const STATUS_INPUT_SHAPE: z.ZodRawShape = { agent_key: agentKeyField };

/** JSON Schema of the status input (derived from the zod shape). */
export const STATUS_INPUT_SCHEMA: Record<string, unknown> = toJsonSchema(STATUS_INPUT_SHAPE);

/** Tool config for status. */
export const STATUS_TOOL_CONFIG = toolConfig(
  "Status",
  "Get system overview: agents, locks, plans, messages",
  STATUS_INPUT_SCHEMA
);

/** Create status tool handler. */
export const createStatusHandler = (
  db: TooManyCooksDb,
  logger: Logger,
  getSession: SessionGetter = (): null => null
): ToolCallback => {
  return async (args: Record<string, unknown>): Promise<CallToolResult> => {
    const log: Logger = logger.child({ tool: "status" });

    const agents: Result<Array<Record<string, unknown>>, DbError> = mapListToJson(await db.listAgents(), agentIdentityToJson);
    if (!agents.ok) {return makeErrorResult(agents.error);}

    const locks: Result<Array<Record<string, unknown>>, DbError> = mapListToJson(await db.listLocks(), fileLockToJson);
    if (!locks.ok) {return makeErrorResult(locks.error);}

    const plans: Result<Array<Record<string, unknown>>, DbError> = mapListToJson(await db.listPlans(), agentPlanToJson);
    if (!plans.ok) {return makeErrorResult(plans.error);}

    // [STATUS-BOUNDED] Issues #41/#42, [MSG-PRIVACY] Issue #11: bounded, SQL-filtered
    // overview. The caller sees only their own unread inbox + broadcasts, as headers
    // (no bodies). Payload size is independent of total message history.
    const identity: IdentityResult = await resolveIdentity(db, args, getSession);
    const agentName: string | null = identity.isError ? null : identity.agentName;
    const overviewResult: Result<MessageOverview, DbError> = await db.getMessageOverview(agentName, RECENT_MESSAGE_LIMIT);
    if (!overviewResult.ok) {return makeErrorResult(overviewResult.error);}
    const messages: Record<string, unknown> = {
      total: overviewResult.value.total,
      unread: overviewResult.value.unread,
      recent: overviewResult.value.recent.map(messageHeaderToJson),
    };

    log.debug("Status queried");

    return jsonResult({ agents: agents.value, locks: locks.value, plans: plans.value, messages });
  };
};
