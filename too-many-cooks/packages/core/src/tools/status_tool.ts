/// Status tool - system overview.

import type { Logger } from "../logger.js";
import type { MessageHeader, MessageOverview, TooManyCooksDb } from "../db-interface.js";
import type { Result } from "../result.js";
import type { AgentIdentity, AgentPlan, DbError, FileLock } from "../types.js";
import {
  agentIdentityToJson,
  agentPlanToJson,
  fileLockToJson,
} from "../types.js";
import {
  type CallToolResult,
  type SessionGetter,
  type ToolCallback,
  textContent,
} from "../mcp-types.js";
import { type IdentityResult, makeErrorResult, resolveIdentity } from "./tool_utils.js";

/// [STATUS-BOUNDED] Issues #41/#42: cap on the recent-header slice embedded in a
/// status overview. The payload is bounded by this constant regardless of how
/// many messages exist on the server.
const RECENT_MESSAGE_LIMIT: number = 20;

/// [STATUS-BOUNDED] Serialize a header to JSON — id/from/to/timestamps only,
/// NEVER the body. Full message content is the job of the `message get` tool.
const messageHeaderToJson: (header: MessageHeader) => Record<string, unknown> = (
  header: MessageHeader,
): Record<string, unknown> => ({
  id: header.id,
  from_agent: header.fromAgent,
  to_agent: header.toAgent,
  created_at: header.createdAt,
  ...(header.readAt === undefined ? {} : { read_at: header.readAt }),
});

/** Input schema for status tool. */
export const STATUS_INPUT_SCHEMA: {
  readonly type: "object";
  readonly properties: Record<string, unknown>;
} = {
  type: "object",
  properties: {
    agent_key: {
      type: "string",
      description: "Agent key for authentication (optional, uses session if omitted)",
    },
  },
} as const;

/** Tool config for status. */
export const STATUS_TOOL_CONFIG: {
  readonly title: string;
  readonly description: string;
  readonly inputSchema: typeof STATUS_INPUT_SCHEMA;
  readonly outputSchema: null;
  readonly annotations: null;
} = {
  title: "Status",
  description: "Get system overview: agents, locks, plans, messages",
  inputSchema: STATUS_INPUT_SCHEMA,
  outputSchema: null,
  annotations: null,
} as const;

/** Create status tool handler. */
export const createStatusHandler: (
  db: TooManyCooksDb,
  logger: Logger,
  getSession?: SessionGetter,
) => ToolCallback = (
  db: TooManyCooksDb,
  logger: Logger,
  getSession: SessionGetter = (): null => null,
): ToolCallback =>
  {return async (args: Record<string, unknown>): Promise<CallToolResult> => {
    const log: Logger = logger.child({ tool: "status" });

    const agentsResult: Result<readonly AgentIdentity[], DbError> = await db.listAgents();
    if (!agentsResult.ok) {return makeErrorResult(agentsResult.error);}
    const agents: Array<Record<string, unknown>> = agentsResult.value.map(agentIdentityToJson);

    const locksResult: Result<readonly FileLock[], DbError> = await db.listLocks();
    if (!locksResult.ok) {return makeErrorResult(locksResult.error);}
    const locks: Array<Record<string, unknown>> = locksResult.value.map(fileLockToJson);

    const plansResult: Result<readonly AgentPlan[], DbError> = await db.listPlans();
    if (!plansResult.ok) {return makeErrorResult(plansResult.error);}
    const plans: Array<Record<string, unknown>> = plansResult.value.map(agentPlanToJson);

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

    return {
      content: [
        textContent(JSON.stringify({ agents, locks, plans, messages })),
      ],
      isError: false,
    };
  }};
