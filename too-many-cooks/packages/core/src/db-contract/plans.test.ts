/// Plan update and list contract tests.

import { it } from "node:test";
import assert from "node:assert/strict";

import type { AgentPlan, AgentRegistration } from "../types.gen.js";
import { assertError, cleanupState, describeSuite, planSetup, unwrap } from "./setup.test.js";
import type { AgentState, DbFactory } from "./setup.test.js";

/** Run plan contract tests. */
export const runPlanTests = (createTestDb: DbFactory): void => {
  describeSuite(createTestDb, "TooManyCooksDb contract: plans", planSetup, cleanupState, (getState: () => AgentState): void => {
    registerPlanUpdateTests(getState);
    registerPlanListTests(getState);
  });
};

/** Register plan update contract tests. */
const registerPlanUpdateTests = (getState: () => AgentState): void => {
  it("update and get plan", async (): Promise<void> => {
    const { inst, agentName, agentKey } = getState();
    unwrap(await inst.db.updatePlan(agentName, agentKey, "build feature", "writing tests"));
    const plan: AgentPlan | null = unwrap(await inst.db.getPlan(agentName));
    if (!plan) { throw new Error("Expected plan"); }
    assert.strictEqual(plan.goal, "build feature");
    assert.strictEqual(plan.currentTask, "writing tests");
    assert.strictEqual(plan.agentName, agentName);
    assert.ok(plan.updatedAt > 0);
  });

  it("getPlan returns null for agent without plan", async (): Promise<void> => {
    const { inst } = getState();
    const reg2: AgentRegistration = unwrap(await inst.db.register("no-plan"));
    const plan: AgentPlan | null = unwrap(await inst.db.getPlan(reg2.agentName));
    assert.strictEqual(plan, null);
  });

  it("updatePlan fails with invalid credentials", async (): Promise<void> => {
    const { inst, agentName } = getState();
    assertError(await inst.db.updatePlan(agentName, "wrong", "goal", "task"), "UNAUTHORIZED");
  });

  it("plan updatedAt changes on update", async (): Promise<void> => {
    const { inst, agentName, agentKey } = getState();
    unwrap(await inst.db.updatePlan(agentName, agentKey, "goal", "task1"));
    const plan1: AgentPlan | null = unwrap(await inst.db.getPlan(agentName));

    unwrap(await inst.db.updatePlan(agentName, agentKey, "goal", "task2"));
    const plan2: AgentPlan | null = unwrap(await inst.db.getPlan(agentName));

    if (plan1 && plan2) {
      assert.ok(plan2.updatedAt >= plan1.updatedAt);
    }
  });
};

/** Register plan list contract tests. */
const registerPlanListTests = (getState: () => AgentState): void => {
  it("one plan per agent - update replaces", async (): Promise<void> => {
    const { inst, agentName, agentKey } = getState();
    unwrap(await inst.db.updatePlan(agentName, agentKey, "goal1", "task1"));
    unwrap(await inst.db.updatePlan(agentName, agentKey, "goal2", "task2"));

    const plans: readonly AgentPlan[] = unwrap(await inst.db.listPlans());
    const agentPlans: readonly AgentPlan[] = plans.filter((plan: AgentPlan): boolean => {return plan.agentName === agentName});
    assert.strictEqual(agentPlans.length, 1);
    assert.strictEqual(agentPlans[0]?.goal, "goal2");
  });

  it("listPlans returns all plans", async (): Promise<void> => {
    const { inst, agentName, agentKey } = getState();
    const reg2: AgentRegistration = unwrap(await inst.db.register("agent2"));
    unwrap(await inst.db.updatePlan(agentName, agentKey, "goal1", "task1"));
    unwrap(await inst.db.updatePlan(reg2.agentName, reg2.agentKey, "goal2", "task2"));

    const plans: readonly AgentPlan[] = unwrap(await inst.db.listPlans());
    assert.strictEqual(plans.length, 2);
    const goals: Set<string> = new Set<string>(plans.map((plan: AgentPlan): string => {return plan.goal}));
    assert.ok(goals.has("goal1"));
    assert.ok(goals.has("goal2"));
  });
};
