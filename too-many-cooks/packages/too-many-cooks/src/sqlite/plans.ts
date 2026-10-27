/// SQLite plan operations.

import type Database from "better-sqlite3";

import {
  type AgentPlan,
  type DbError,
  type Logger,
  type Result,
  type TooManyCooksDataConfig,
  agentPlanFromJson,
  success,
} from "too-many-cooks-core";

import type { PlanMethodGroup } from "../db-method-groups.js";
import { asyncDbOp, attempt, authenticated, listAll, now, selectOneOrNull, validatePlanLengths } from "./shared.js";

/** Fetch one agent's plan. */
const SQL_GET_PLAN: string = "SELECT * FROM plans WHERE agent_name = ?";

/** List every plan. */
const SQL_LIST_PLANS: string = "SELECT * FROM plans";

/** Upsert an agent's plan. */
const SQL_UPSERT_PLAN: string = `
      INSERT INTO plans (agent_name, goal, current_task, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(agent_name) DO UPDATE SET
        goal = excluded.goal,
        current_task = excluded.current_task,
        updated_at = excluded.updated_at
    `;

/** Update an agent's plan. */
const updatePlan = (
  db: Database.Database,
  log: Logger,
  agentName: string,
  agentKey: string,
  goal: string,
  currentTask: string,
  maxLen: number
): Result<void, DbError> => {
  log.debug(`Updating plan for ${agentName}`);
  return authenticated(db, agentName, agentKey, (): Result<void, DbError> =>
    upsertPlan(db, agentName, goal, currentTask, maxLen)
  );
};

/** Validate then upsert the plan row. */
const upsertPlan = (
  db: Database.Database,
  agentName: string,
  goal: string,
  currentTask: string,
  maxLen: number
): Result<void, DbError> => {
  const valid: Result<void, DbError> = validatePlanLengths(goal, currentTask, maxLen);
  if (!valid.ok) {
    return valid;
  }
  return attempt((): Result<void, DbError> => {
    db.prepare(SQL_UPSERT_PLAN).run(agentName, goal, currentTask, now());
    return success(undefined);
  });
};

/** Get an agent's plan. */
const getPlan = (db: Database.Database, log: Logger, agentName: string): Result<AgentPlan | null, DbError> => {
  log.trace(`Getting plan for ${agentName}`);
  return selectOneOrNull(db, SQL_GET_PLAN, [agentName], agentPlanFromJson);
};

/** List all plans. */
const listPlans = (db: Database.Database, log: Logger): Result<readonly AgentPlan[], DbError> =>
  listAll(db, log, SQL_LIST_PLANS, agentPlanFromJson, "plans");

/** Build plan operations. */
export const createPlanOps = (
  db: Database.Database,
  log: Logger,
  config: TooManyCooksDataConfig
): PlanMethodGroup => ({
  getPlan: asyncDbOp(getPlan, db, log),
  listPlans: asyncDbOp(listPlans, db, log),
  updatePlan: async (name: string, key: string, goal: string, task: string): Promise<Result<void, DbError>> =>
    await Promise.resolve(updatePlan(db, log, name, key, goal, task, config.maxPlanLength)),
});
