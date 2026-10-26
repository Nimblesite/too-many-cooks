/// Tests for agent plan operations.

import { describe, it } from "node:test";
import assert from "node:assert";
import {
  ERR_UNAUTHORIZED,
  ERR_VALIDATION,
} from "too-many-cooks-core";
import { bindAgentDb } from "./support/db_fixture.js";

const TEST_DB_PATH = ".test_plans.db";

describe("plans", () => {
  const agentDb = bindAgentDb(TEST_DB_PATH, "plan-agent");

  it("updatePlan creates new plan", async () => {
    const db = agentDb.db();
    const { agentName, agentKey } = agentDb.agent();
    const result = await db.updatePlan(
      agentName,
      agentKey,
      "Fix all bugs",
      "Reading codebase",
    );
    assert.strictEqual(result.ok, true);
  });

  it("updatePlan updates existing plan", async () => {
    const db = agentDb.db();
    const { agentName, agentKey } = agentDb.agent();
    await db.updatePlan(agentName, agentKey, "Goal 1", "Task 1");

    const result = await db.updatePlan(agentName, agentKey, "Goal 2", "Task 2");
    assert.strictEqual(result.ok, true);

    const getPlan = await db.getPlan(agentName);
    if (!getPlan.ok) {throw new Error("expected ok");}
    const plan = getPlan.value;
    if (plan === undefined || plan === null) {throw new Error("expected plan");}
    assert.strictEqual(plan.goal, "Goal 2");
    assert.strictEqual(plan.currentTask, "Task 2");
  });

  it("updatePlan fails with invalid credentials", async () => {
    const db = agentDb.db();
    const { agentName } = agentDb.agent();
    const result = await db.updatePlan(agentName, "wrong-key", "Goal", "Task");
    assert.strictEqual(result.ok, false);
    if (result.ok) {throw new Error("expected error");}
    assert.strictEqual(result.error.code, ERR_UNAUTHORIZED);
  });

  it("updatePlan fails for goal exceeding max length", async () => {
    const db = agentDb.db();
    const { agentName, agentKey } = agentDb.agent();
    const longGoal = "x".repeat(101); // Default max is 100
    const result = await db.updatePlan(agentName, agentKey, longGoal, "Task");
    assert.strictEqual(result.ok, false);
    if (result.ok) {throw new Error("expected error");}
    assert.strictEqual(result.error.code, ERR_VALIDATION);
    assert.ok(result.error.message.includes("100"));
  });

  it("updatePlan fails for task exceeding max length", async () => {
    const db = agentDb.db();
    const { agentName, agentKey } = agentDb.agent();
    const longTask = "x".repeat(101);
    const result = await db.updatePlan(agentName, agentKey, "Goal", longTask);
    assert.strictEqual(result.ok, false);
    if (result.ok) {throw new Error("expected error");}
    assert.strictEqual(result.error.code, ERR_VALIDATION);
  });

  it("getPlan returns plan for agent", async () => {
    const db = agentDb.db();
    const { agentName, agentKey } = agentDb.agent();
    await db.updatePlan(agentName, agentKey, "My Goal", "Current Task");

    const result = await db.getPlan(agentName);
    assert.strictEqual(result.ok, true);
    if (!result.ok) {throw new Error("expected ok");}
    const plan = result.value;
    assert.notStrictEqual(plan, undefined);
    if (plan === undefined || plan === null) {throw new Error("expected plan");}
    assert.strictEqual(plan.agentName, agentName);
    assert.strictEqual(plan.goal, "My Goal");
    assert.strictEqual(plan.currentTask, "Current Task");
    assert.ok(plan.updatedAt > 0);
  });

  it("getPlan returns null for agent without plan", async () => {
    const db = agentDb.db();
    // Register agent without setting plan
    const reg2 = await db.register("no-plan-agent");
    if (!reg2.ok) {throw new Error("expected ok");}
    const agent2 = reg2.value;

    const result = await db.getPlan(agent2.agentName);
    assert.strictEqual(result.ok, true);
    if (!result.ok) {throw new Error("expected ok");}
    const plan = result.value;
    assert.strictEqual(plan, null);
  });

  it("listPlans returns all plans", async () => {
    const db = agentDb.db();
    const { agentName, agentKey } = agentDb.agent();
    await db.updatePlan(agentName, agentKey, "Goal 1", "Task 1");

    // Register second agent with plan
    const reg2 = await db.register("plan-agent-2");
    if (!reg2.ok) {throw new Error("expected ok");}
    const agent2 = reg2.value;
    await db.updatePlan(agent2.agentName, agent2.agentKey, "Goal 2", "Task 2");

    const result = await db.listPlans();
    assert.strictEqual(result.ok, true);
    if (!result.ok) {throw new Error("expected ok");}
    const plans = result.value;
    assert.strictEqual(plans.length, 2);
    assert.deepStrictEqual(
      new Set(plans.map((p) => p.goal)),
      new Set(["Goal 1", "Goal 2"]),
    );
  });

  it("plan updatedAt changes on update", async () => {
    const db = agentDb.db();
    const { agentName, agentKey } = agentDb.agent();
    await db.updatePlan(agentName, agentKey, "Goal", "Task 1");
    const getPlan1 = await db.getPlan(agentName);
    if (!getPlan1.ok) {throw new Error("expected ok");}
    const plan1 = getPlan1.value;
    if (plan1 === undefined || plan1 === null) {throw new Error("expected plan");}

    await db.updatePlan(agentName, agentKey, "Goal", "Task 2");
    const getPlan2 = await db.getPlan(agentName);
    if (!getPlan2.ok) {throw new Error("expected ok");}
    const plan2 = getPlan2.value;
    if (plan2 === undefined || plan2 === null) {throw new Error("expected plan");}

    assert.ok(plan2.updatedAt >= plan1.updatedAt);
  });
});
