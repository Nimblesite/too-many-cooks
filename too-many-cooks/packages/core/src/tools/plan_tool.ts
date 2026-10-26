/// Plan tool - agent plan management.

import type { Logger } from "../logger.js";
import type { NotificationEmitter } from "../notifications.js";
import { EVENT_PLAN_UPDATED } from "../notifications.js";
import type { TooManyCooksDb } from "../db-interface.js";
import type { Result } from "../result.js";
import type { AgentPlan, DbError } from "../types.js";
import { agentPlanToJson } from "../types.js";
import type { CallToolResult, SessionGetter, ToolCallback } from "../mcp-types.js";
import { errorContent, jsonResult, listJsonResult, makeErrorResult, requireActionArg, toolConfig, unknownActionError, withResolvedAgent } from "./tool_utils.js";

/** Input schema for plan tool. */
export const PLAN_INPUT_SCHEMA: {
  readonly type: "object";
  readonly properties: Record<string, unknown>;
  readonly required: readonly string[];
} = {
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
export const PLAN_TOOL_CONFIG = toolConfig(
  "Plan",
  "Manage your plan. You must register first (except list). " +
    "REQUIRED: action (update|get|list). " +
    "For update: goal, current_task. " +
    'Example: {"action":"update","goal":"Fix bug",' +
    ' "current_task":"Reading code"}',
  PLAN_INPUT_SCHEMA
);

/** Create plan tool handler. */
export const createPlanHandler = (
  db: TooManyCooksDb,
  emitter: NotificationEmitter,
  logger: Logger,
  getSession: SessionGetter
): ToolCallback => {
  return async (args: Record<string, unknown>): Promise<CallToolResult> => {
    const actionOrError: string | CallToolResult = requireActionArg(args);
    if (typeof actionOrError !== "string") {return actionOrError;}
    const action: string = actionOrError;
    const log: Logger = logger.child({ tool: "plan", action });

    if (action === "list") {return await handleList(db);}

    return await withResolvedAgent(db, args, getSession, async (agentName: string, agentKey: string): Promise<CallToolResult> => {
      switch (action) {
        case "update":
          return await handleUpdate(
            db,
            emitter,
            log,
            agentName,
            agentKey,
            typeof args.goal === "string" ? args.goal : null,
            typeof args.current_task === "string" ? args.current_task : null
          );
        case "get":
          return await handleGet(db, agentName);
        default:
          return unknownActionError(action);
      }
    });
  };
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
  currentTask: string | null
): Promise<CallToolResult> => {
  if (goal === null || currentTask === null) {
    return errorContent("update requires goal, current_task");
  }
  const result: Result<void, DbError> = await db.updatePlan(agentName, agentKey, goal, currentTask);
  if (!result.ok) {return makeErrorResult(result.error);}
  emitter.emit(EVENT_PLAN_UPDATED, {
    agent_name: agentName,
    goal,
    current_task: currentTask,
  });
  log.info(`Plan updated for ${agentName}: ${currentTask}`);
  return jsonResult({ updated: true });
};

// ---------------------------------------------------------------------------
// Get
// ---------------------------------------------------------------------------

const handleGet = async (db: TooManyCooksDb, agentName: string): Promise<CallToolResult> => {
  const result: Result<AgentPlan | null, DbError> = await db.getPlan(agentName);
  if (!result.ok) {return makeErrorResult(result.error);}
  if (result.value !== null) {
    return jsonResult({ plan: agentPlanToJson(result.value) });
  }
  return jsonResult({ plan: null });
};

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

const handleList = async (db: TooManyCooksDb): Promise<CallToolResult> => {
  const result: Result<readonly AgentPlan[], DbError> = await db.listPlans();
  return listJsonResult(result, "plans", agentPlanToJson);
};
