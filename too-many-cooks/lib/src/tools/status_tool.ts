/// Status tool - system overview.

import type { Logger } from "../logger.js";
import {
  type TooManyCooksDb,
  agentIdentityToJson,
  agentPlanToJson,
  fileLockToJson,
  messageToJson,
} from "../data/data.js";
import {
  textContent,
  type CallToolResult,
  type ToolCallback,
} from "../types.js";
import { makeErrorResult } from "./tool_utils.js";

/** Input schema for status tool (no inputs required). */
export const STATUS_INPUT_SCHEMA = {
  type: "object",
  properties: {},
} as const;

/** Tool config for status. */
export const STATUS_TOOL_CONFIG = {
  title: "Status",
  description: "Get system overview: agents, locks, plans, messages",
  inputSchema: STATUS_INPUT_SCHEMA,
  outputSchema: null,
  annotations: null,
} as const;

/** Create status tool handler. */
export const createStatusHandler = (
  db: TooManyCooksDb,
  logger: Logger,
): ToolCallback =>
  async (): Promise<CallToolResult> => {
    const log = logger.child({ tool: "status" });

    const agentsResult = db.listAgents();
    if (!agentsResult.ok) {return await Promise.resolve(makeErrorResult(agentsResult.error));}
    const agents = agentsResult.value.map(agentIdentityToJson);

    const locksResult = db.listLocks();
    if (!locksResult.ok) {return await Promise.resolve(makeErrorResult(locksResult.error));}
    const locks = locksResult.value.map(fileLockToJson);

    const plansResult = db.listPlans();
    if (!plansResult.ok) {return await Promise.resolve(makeErrorResult(plansResult.error));}
    const plans = plansResult.value.map(agentPlanToJson);

    const messagesResult = db.listAllMessages();
    if (!messagesResult.ok) {return await Promise.resolve(makeErrorResult(messagesResult.error));}
    const messages = messagesResult.value.map(messageToJson);

    log.debug("Status queried");

    return await Promise.resolve({
      content: [
        textContent(JSON.stringify({ agents, locks, plans, messages })),
      ],
      isError: false,
    });
  };
