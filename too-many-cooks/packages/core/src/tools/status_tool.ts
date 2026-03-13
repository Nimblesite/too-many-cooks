/// Status tool - system overview.

import type { Logger } from "../logger.js";
import type { TooManyCooksDb } from "../db-interface.js";
import type { Result } from "../result.js";
import type { AgentIdentity, AgentPlan, DbError, FileLock, Message } from "../types.js";
import {
  agentIdentityToJson,
  agentPlanToJson,
  fileLockToJson,
  messageToJson,
} from "../types.js";
import {
  type CallToolResult,
  type ToolCallback,
  textContent,
} from "../mcp-types.js";
import { makeErrorResult } from "./tool_utils.js";

/** Input schema for status tool (no inputs required). */
export const STATUS_INPUT_SCHEMA: {
  readonly type: "object";
  readonly properties: Record<string, never>;
} = {
  type: "object",
  properties: {},
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
) => ToolCallback = (
  db: TooManyCooksDb,
  logger: Logger,
): ToolCallback =>
  {return async (): Promise<CallToolResult> => {
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

    const messagesResult: Result<readonly Message[], DbError> = await db.listAllMessages();
    if (!messagesResult.ok) {return makeErrorResult(messagesResult.error);}
    const messages: Array<Record<string, unknown>> = messagesResult.value.map(messageToJson);

    log.debug("Status queried");

    return {
      content: [
        textContent(JSON.stringify({ agents, locks, plans, messages })),
      ],
      isError: false,
    };
  }};
