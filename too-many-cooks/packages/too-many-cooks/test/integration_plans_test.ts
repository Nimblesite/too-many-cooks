/// Integration tests — plan tool behaviour: one plan per agent
/// (update replaces, never duplicates), get, and list.

import { describe, it } from "node:test";
import assert from "node:assert";

import { assertNonNullish } from "./support/assertions.js";
import { getRecordArrayField, getRecordField } from "./support/json.js";
import {
  type Agent,
  bindIntegrationSuite,
  callToolJson,
  callToolArrayField,
  registerAgents,
  registerSingleAgent,
  statusJson,
} from "./support/integration_server.js";

const TEST_PORT = 4058;
const TMP_PREFIX = "/tmp/tmc-integration-plans-";
const PLAN_TOOL = "plan";
const ROUNDS = 3;
const AGENT_COUNT = 3;

describe("Too Many Cooks MCP Server Integration", () => {
  // Server for the file; DB reset + fresh MCP client for each test
  const suite = bindIntegrationSuite(TEST_PORT, TMP_PREFIX);

  /** Updates `agent`'s plan through the plan tool. */
  const updatePlanFor = async (
    client: ReturnType<typeof suite.client>,
    agent: Agent,
    goal: string,
    currentTask: string,
  ): Promise<void> => {
    await client.callTool(PLAN_TOOL, {
      action: "update",
      agent_key: agent.key,
      goal,
      current_task: currentTask,
    });
  };

  /** The single plan the server reports, asserted to exist. */
  const solePlan = async (client: ReturnType<typeof suite.client>) => {
    const plans = getRecordArrayField(await statusJson(client), "plans");
    assert.strictEqual(plans.length, 1, "MUST have exactly 1 plan");
    return assertNonNullish(plans[0], "the single plan");
  };

  // CRITICAL: One plan per agent - updating replaces, doesn't create new
  it("updating plan replaces existing - ONE PLAN PER AGENT", async () => {
    const client = suite.client();
    const agent = await registerSingleAgent(client, "planning agent");

    // Create initial plan, then verify one plan exists
    await updatePlanFor(client, agent, "Initial goal", "Initial task");
    await solePlan(client);

    // Update the plan
    await updatePlanFor(client, agent, "Updated goal", "Updated task");

    // CRITICAL: Still only ONE plan - update replaced, didn't create new
    const plan = await solePlan(client);

    // Verify the plan was actually updated
    assert.strictEqual(plan.goal, "Updated goal");
    assert.strictEqual(plan.current_task, "Updated task");
  });

  it("each agent has exactly one plan after multiple updates", async () => {
    const client = suite.client();
    const agents = await registerAgents(client, AGENT_COUNT);

    // Each agent updates their plan 3 times
    for (let round = 0; round < ROUNDS; round++) {
      for (const agent of agents) {
        await updatePlanFor(
          client,
          agent,
          `Goal round ${String(round)}`,
          `Task round ${String(round)}`,
        );
      }
    }

    // CRITICAL: Should have exactly 3 plans (one per agent), NOT 9
    const plans = getRecordArrayField(await statusJson(client), "plans");
    assert.strictEqual(
      plans.length,
      AGENT_COUNT,
      "MUST have exactly 3 plans (one per agent), not 9",
    );

    // Verify each plan shows the latest update (round 2)
    for (const plan of plans) {
      assert.strictEqual(plan.goal, "Goal round 2");
      assert.strictEqual(plan.current_task, "Task round 2");
    }
  });

  // PLAN TOOL: get and list actions
  it("plan get retrieves specific agent plan", async () => {
    const client = suite.client();
    const agent = await registerSingleAgent(client, "planning agent");

    // Create plan
    await updatePlanFor(client, agent, "Test goal", "Test task");

    const json = await callToolJson(client, PLAN_TOOL, {
      action: "get",
      agent_key: agent.key,
    });
    const plan = getRecordField(json, "plan");
    assert.strictEqual(plan.goal, "Test goal");
  });

  it("plan list returns all plans", async () => {
    const client = suite.client();
    const agents = await registerAgents(client, 2);

    // Create plans for both agents
    for (const agent of agents) {
      await updatePlanFor(client, agent, `Goal for ${agent.name}`, "Task");
    }

    const plans = await callToolArrayField(client, PLAN_TOOL, "list", "plans");
    assert.strictEqual(plans.length, 2);
  });
});
