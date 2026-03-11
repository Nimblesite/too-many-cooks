/// Plan tool - agent plan management.

import type { Logger } from "../logger.js";
import type { NotificationEmitter } from "../notifications.js";
import { EVENT_PLAN_UPDATED } from "../notifications.js";
import type { TooManyCooksDb } from "../db-interface.js";
import { agentPlanToJson } from "../types.js";
import {
  textContent,
  type SessionGetter,
  type CallToolResult,
  type ToolCallback,
} from "../mcp-types.js";
import { resolveIdentity, makeErrorResult, errorContent } from "./tool_utils.js";

/** Input schema for plan tool. */
export const PLAN_INPUT_SCHEMA = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["update", "get", "list"],
      description: "Plan action to perform",
    },
    goal: {
      type: "string",
      maxLength: 100,
      description: "Your goal (for update). MUST be 100 chars or less.",
    },
    current_task: {
      type: "string",
      maxLength: 100,
      description:
        "What you are doing now (for update). MUST be 100 chars or less.",
    },
  },
  required: ["action"],
} as const;

/** Tool config for plan. */
export const PLAN_TOOL_CONFIG = {
  title: "Plan",
  description:
    "Manage your plan. You must register first (except list). " +
    "REQUIRED: action (update|get|list). " +
    "For update: goal, current_task. " +
    'Example: {"action":"update","goal":"Fix bug",' +
    ' "current_task":"Reading code"}',
  inputSchema: PLAN_INPUT_SCHEMA,
  outputSchema: null,
  annotations: null,
} as const;

/** Create plan tool handler. */
export const createPlanHandler = (
  db: TooManyCooksDb,
  emitter: NotificationEmitter,
  logger: Logger,
  getSession: SessionGetter,
): ToolCallback =>
  async (args: Record<string, unknown>): Promise<CallToolResult> => {
    const actionArg = args.action;
    if (typeof actionArg !== "string") {
      return errorContent("missing_parameter: action is required");
    }
    const action = actionArg;
    const log = logger.child({ tool: "plan", action });

    if (action === "list") {return await handleList(db);}

    const identity = await resolveIdentity(db, args, getSession);
    if (identity.isError) {return identity.result;}
    const { agentName, agentKey } = identity;

    switch (action) {
      case "update":
        return await handleUpdate(
          db,
          emitter,
          log,
          agentName,
          agentKey,
          typeof args.goal === "string" ? args.goal : null,
          typeof args.current_task === "string"
            ? args.current_task
            : null,
        );
      case "get":
        return await handleGet(db, agentName);
      default:
        return {
          content: [
            textContent(
              JSON.stringify({ error: `Unknown action: ${action}` }),
            ),
          ],
          isError: true,
        };
    }
  };

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

const handleUpdate = async (
  db: TooManyCooksDb,
  emitter: NotificationEmitter,
  log: Logger,
  agentName: string,
  agentKey: string,
  goal: string | null,
  currentTask: string | null,
): Promise<CallToolResult> => {
  if (goal === null || currentTask === null) {
    return errorContent("update requires goal, current_task");
  }
  const result = await db.updatePlan(agentName, agentKey, goal, currentTask);
  if (!result.ok) {return makeErrorResult(result.error);}
  emitter.emit(EVENT_PLAN_UPDATED, {
    agent_name: agentName,
    goal,
    current_task: currentTask,
  });
  log.info(`Plan updated for ${agentName}: ${currentTask}`);
  return {
    content: [textContent(JSON.stringify({ updated: true }))],
    isError: false,
  };
};

// ---------------------------------------------------------------------------
// Get
// ---------------------------------------------------------------------------

const handleGet = async (
  db: TooManyCooksDb,
  agentName: string,
): Promise<CallToolResult> => {
  const result = await db.getPlan(agentName);
  if (!result.ok) {return makeErrorResult(result.error);}
  if (result.value !== null) {
    return {
      content: [
        textContent(
          JSON.stringify({ plan: agentPlanToJson(result.value) }),
        ),
      ],
      isError: false,
    };
  }
  return {
    content: [textContent(JSON.stringify({ plan: null }))],
    isError: false,
  };
};

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

const handleList = async (db: TooManyCooksDb): Promise<CallToolResult> => {
  const result = await db.listPlans();
  if (!result.ok) {return makeErrorResult(result.error);}
  return {
    content: [
      textContent(
        JSON.stringify({ plans: result.value.map(agentPlanToJson) }),
      ),
    ],
    isError: false,
  };
};
