/// Tests for agent plan operations.

import { describe, it } from "node:test";
import assert from "node:assert";
import {
  type AgentPlan,
  type TooManyCooksDb,
  ERR_UNAUTHORIZED,
  ERR_VALIDATION,
} from "too-many-cooks-core";
import { type AgentActor, agentActor, bindAgentDb } from "./support/db_fixture.js";
import {
  assertFieldSetEquals,
  assertNonNullish,
  expectErr,
  expectOk,
} from "./support/assertions.js";

const TEST_DB_PATH = ".test_plans.db";
const MAX_PLAN_LENGTH = 100;

describe("plans", () => {
  const agentDb = bindAgentDb(TEST_DB_PATH, "plan-agent");

  /** Db plus the bound agent's credentials ([DEDUP-DESLOP]). */
  const actor = (): AgentActor => agentActor(agentDb);

  /** Reads `agentName`'s plan, asserting the call succeeded. */
  const readPlan = async (
    db: TooManyCooksDb,
    agentName: string,
  ): Promise<AgentPlan | null> => expectOk(await db.getPlan(agentName), "get must be ok");

  /** Reads `agentName`'s plan, asserting it exists. */
  const requirePlan = async (
    db: TooManyCooksDb,
    agentName: string,
    label: string,
  ): Promise<AgentPlan> => assertNonNullish(await readPlan(db, agentName), label);

  it("updatePlan creates new plan", async () => {
    const { db, agentName, agentKey } = actor();
    const result = await db.updatePlan(
      agentName,
      agentKey,
      "Fix all bugs",
      "Reading codebase",
    );
    assert.strictEqual(result.ok, true);
  });

  it("updatePlan updates existing plan", async () => {
    const { db, agentName, agentKey } = actor();
    await db.updatePlan(agentName, agentKey, "Goal 1", "Task 1");

    const result = await db.updatePlan(agentName, agentKey, "Goal 2", "Task 2");
    assert.strictEqual(result.ok, true);

    const plan = await requirePlan(db, agentName, "expected plan");
    assert.strictEqual(plan.goal, "Goal 2");
    assert.strictEqual(plan.currentTask, "Task 2");
  });

  it("updatePlan fails with invalid credentials", async () => {
    const { db, agentName } = actor();
    const error = expectErr(
      await db.updatePlan(agentName, "wrong-key", "Goal", "Task"),
      "update must fail",
    );
    assert.strictEqual(error.code, ERR_UNAUTHORIZED);
  });

  it("updatePlan fails for goal exceeding max length", async () => {
    const { db, agentName, agentKey } = actor();
    const longGoal = "x".repeat(MAX_PLAN_LENGTH + 1); // Default max is 100
    const error = expectErr(
      await db.updatePlan(agentName, agentKey, longGoal, "Task"),
      "update must fail",
    );
    assert.strictEqual(error.code, ERR_VALIDATION);
    assert.ok(error.message.includes(String(MAX_PLAN_LENGTH)));
  });

  it("updatePlan fails for task exceeding max length", async () => {
    const { db, agentName, agentKey } = actor();
    const longTask = "x".repeat(MAX_PLAN_LENGTH + 1);
    const error = expectErr(
      await db.updatePlan(agentName, agentKey, "Goal", longTask),
      "update must fail",
    );
    assert.strictEqual(error.code, ERR_VALIDATION);
  });

  it("getPlan returns plan for agent", async () => {
    const { db, agentName, agentKey } = actor();
    await db.updatePlan(agentName, agentKey, "My Goal", "Current Task");

    const plan = await requirePlan(db, agentName, "expected plan");
    assert.strictEqual(plan.agentName, agentName);
    assert.strictEqual(plan.goal, "My Goal");
    assert.strictEqual(plan.currentTask, "Current Task");
    assert.ok(plan.updatedAt > 0);
  });

  it("getPlan returns null for agent without plan", async () => {
    const db = agentDb.db();
    // Register agent without setting plan
    const agent2 = expectOk(await db.register("no-plan-agent"), "reg must be ok");

    const plan = await readPlan(db, agent2.agentName);
    assert.strictEqual(plan, null);
  });

  it("listPlans returns all plans", async () => {
    const { db, agentName, agentKey } = actor();
    await db.updatePlan(agentName, agentKey, "Goal 1", "Task 1");

    // Register second agent with plan
    const agent2 = expectOk(await db.register("plan-agent-2"), "reg must be ok");
    await db.updatePlan(agent2.agentName, agent2.agentKey, "Goal 2", "Task 2");

    const plans = expectOk(await db.listPlans(), "list must be ok");
    assertFieldSetEquals(plans, (p) => p.goal, ["Goal 1", "Goal 2"]);
  });

  it("plan updatedAt changes on update", async () => {
    const { db, agentName, agentKey } = actor();
    await db.updatePlan(agentName, agentKey, "Goal", "Task 1");
    const plan1 = await requirePlan(db, agentName, "expected plan before");

    await db.updatePlan(agentName, agentKey, "Goal", "Task 2");
    const plan2 = await requirePlan(db, agentName, "expected plan after");

    assert.ok(plan2.updatedAt >= plan1.updatedAt);
  });
});
