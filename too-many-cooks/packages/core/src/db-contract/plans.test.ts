/// Plan update and list contract tests.

import { it } from "node:test";
import assert from "node:assert/strict";

import type { AgentPlan, AgentRegistration } from "../types.gen.js";
import {
  applyStandardPlanUpdates,
  assertContainsAll,
  assertError,
  cleanupState,
  describeSuite,
  planSetup,
  registerAgent,
  updateAndGetPlan,
  unwrap,
} from "./setup.test.js";
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
    const state: AgentState = getState();
    const plan: AgentPlan | null = await updateAndGetPlan(state, "build feature", "writing tests");
    if (!plan) { throw new Error("Expected plan"); }
    assert.strictEqual(plan.goal, "build feature");
    assert.strictEqual(plan.currentTask, "writing tests");
    assert.strictEqual(plan.agentName, state.agentName);
    assert.ok(plan.updatedAt > 0);
  });

  it("getPlan returns null for agent without plan", async (): Promise<void> => {
    const state: AgentState = getState();
    const reg2: AgentRegistration = await registerAgent(state.inst, "no-plan");
    assert.strictEqual(unwrap(await state.inst.db.getPlan(reg2.agentName)), null);
  });

  it("updatePlan fails with invalid credentials", async (): Promise<void> => {
    const state: AgentState = getState();
    assertError(await state.inst.db.updatePlan(state.agentName, "wrong", "goal", "task"), "UNAUTHORIZED");
  });

  it("plan updatedAt changes on update", async (): Promise<void> => {
    const state: AgentState = getState();
    const plan1: AgentPlan | null = await updateAndGetPlan(state, "goal", "task1");
    const plan2: AgentPlan | null = await updateAndGetPlan(state, "goal", "task2");

    if (plan1 && plan2) {
      assert.ok(plan2.updatedAt >= plan1.updatedAt);
    }
  });
};

/** Register plan list contract tests. */
const registerPlanListTests = (getState: () => AgentState): void => {
  it("one plan per agent - update replaces", async (): Promise<void> => {
    const state: AgentState = getState();
    const plans: readonly AgentPlan[] = await applyStandardPlanUpdates(state, state);
    const agentPlans: readonly AgentPlan[] = plans.filter((plan: AgentPlan): boolean => {return plan.agentName === state.agentName});
    assert.strictEqual(agentPlans.length, 1);
    assert.strictEqual(agentPlans[0]?.goal, "goal2");
  });

  it("listPlans returns all plans", async (): Promise<void> => {
    const state: AgentState = getState();
    const reg2: AgentRegistration = await registerAgent(state.inst, "agent2");
    const plans: readonly AgentPlan[] = await applyStandardPlanUpdates(state, reg2);
    assert.strictEqual(plans.length, 2);
    assertContainsAll(plans, (plan: AgentPlan): string => {return plan.goal}, ["goal1", "goal2"]);
  });
};
