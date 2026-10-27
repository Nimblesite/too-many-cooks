/// Tests for plan tool handler (direct import, not via spawned server).

import { describe, it } from "node:test";
import assert from "node:assert";
import type { SessionGetter, ToolCallback } from "too-many-cooks-core";
import { bindAgentDb, registerAgent } from "./support/db_fixture.js";
import { agentSession, planHandlerFor, runToolErr, runToolOk } from "./support/handlers.js";
import { getArrayField, getRecordField } from "./support/json.js";

const TEST_DB_PATH = ".test_plan_handler.db";
const AGENT_LABEL = "plan-agent";
const SECOND_AGENT_LABEL = "plan-agent-2";

/** One plan-tool validation failure: the case name and its arguments. */
type PlanErrorCase = {
  readonly name: string;
  readonly args: Record<string, unknown>;
};

const PLAN_ERROR_CASES: readonly PlanErrorCase[] = [
  { name: "fails when action is missing", args: {} },
  { name: "fails with unknown action", args: { action: "delete" } },
  { name: "update fails without goal", args: { action: "update", current_task: "stuff" } },
  { name: "update fails without current_task", args: { action: "update", goal: "stuff" } },
];

describe("plan handler", () => {
  const agentDb = bindAgentDb(TEST_DB_PATH, AGENT_LABEL);

  /** Sends an update through `handler` directly (setup step). */
  const seedPlan = async (
    handler: ToolCallback,
    goal: string,
    task: string,
  ): Promise<void> => {
    await handler({ action: "update", goal, current_task: task }, {});
  };

  const sessionFor = (): SessionGetter => agentSession(agentDb.agent());

  const unauthenticated = (): SessionGetter => () => null;

  it("update succeeds with goal and current_task", async () => {
    const parsed = await runToolOk(
      planHandlerFor(agentDb.db(), sessionFor()),
      { action: "update", goal: "Fix bugs", current_task: "Reading code" },
    );
    assert.strictEqual(parsed.updated, true);
  });

  it("get returns plan after update", async () => {
    const handler = planHandlerFor(agentDb.db(), sessionFor());
    await seedPlan(handler, "Ship feature", "Writing tests");
    const parsed = await runToolOk(handler, { action: "get" });
    const plan = getRecordField(parsed, "plan");
    assert.strictEqual(plan.goal, "Ship feature");
    assert.strictEqual(plan.current_task, "Writing tests");
  });

  it("get returns null when no plan", async () => {
    const parsed = await runToolOk(
      planHandlerFor(agentDb.db(), sessionFor()),
      { action: "get" },
    );
    assert.strictEqual(parsed.plan, null);
  });

  it("list returns all plans", async () => {
    const handler = planHandlerFor(agentDb.db(), sessionFor());
    await seedPlan(handler, "Goal A", "Task A");

    const agent2 = await registerAgent(agentDb.db(), SECOND_AGENT_LABEL);
    const handler2 = planHandlerFor(agentDb.db(), agentSession(agent2));
    await seedPlan(handler2, "Goal B", "Task B");

    const parsed = await runToolOk(handler, { action: "list" });
    assert.strictEqual(Array.isArray(parsed.plans), true);
    assert.strictEqual(getArrayField(parsed, "plans").length, 2);
  });

  for (const testCase of PLAN_ERROR_CASES) {
    it(testCase.name, async () => {
      await runToolErr(planHandlerFor(agentDb.db(), sessionFor()), testCase.args);
    });
  }

  it("fails when not registered and no session", async () => {
    await runToolErr(planHandlerFor(agentDb.db(), unauthenticated()), {
      action: "update",
      goal: "g",
      current_task: "t",
    });
  });

  it("works with agent_key override", async () => {
    const parsed = await runToolOk(
      planHandlerFor(agentDb.db(), unauthenticated()),
      {
        action: "update",
        goal: "via key",
        current_task: "testing",
        agent_key: agentDb.agent().agentKey,
      },
    );
    assert.strictEqual(parsed.updated, true);
  });

  it("list works without registration", async () => {
    await runToolOk(planHandlerFor(agentDb.db(), unauthenticated()), { action: "list" });
  });
});
