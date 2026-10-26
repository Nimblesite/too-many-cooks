/// Integration tests — plan tool behaviour: one plan per agent
/// (update replaces, never duplicates), get, and list.

import { describe, it } from "node:test";
import assert from "node:assert";

import { assertDefined } from "./support/assertions.js";
import { getRecordArrayField, getRecordField, parseJsonRecord } from "./support/json.js";
import {
  bindIntegrationLifecycle,
  createIntegrationServer,
  registerAgents,
} from "./support/integration_server.js";

const TEST_PORT = 4058;
const TMP_PREFIX = "/tmp/tmc-integration-plans-";

describe("Too Many Cooks MCP Server Integration", () => {
  // Server for the file; DB reset + fresh MCP client for each test
  const suite = bindIntegrationLifecycle(
    createIntegrationServer(TEST_PORT, TMP_PREFIX),
  );

  // CRITICAL: One plan per agent - updating replaces, doesn't create new
  it("updating plan replaces existing - ONE PLAN PER AGENT", async () => {
    const client = suite.client();
    const agents = await registerAgents(client, 1);
    const agent = agents[0];
    assertDefined(agent, "planning agent");

    // Create initial plan
    await client.callTool("plan", {
      action: "update",
      agent_key: agent.key,
      goal: "Initial goal",
      current_task: "Initial task",
    });

    // Verify one plan exists
    let status = parseJsonRecord(
      await client.callTool("status", {}),
    );
    let plans = getRecordArrayField(status, "plans");
    assert.strictEqual(plans.length, 1, "Should have exactly 1 plan");

    // Update the plan
    await client.callTool("plan", {
      action: "update",
      agent_key: agent.key,
      goal: "Updated goal",
      current_task: "Updated task",
    });

    // CRITICAL: Still only ONE plan - update replaced, didn't create new
    status = parseJsonRecord(
      await client.callTool("status", {}),
    );
    plans = getRecordArrayField(status, "plans");
    assert.strictEqual(
      plans.length,
      1,
      "MUST have exactly 1 plan - update replaces, not creates",
    );

    // Verify the plan was actually updated
    const plan = plans[0];
    assertDefined(plan, "the single plan");
    assert.strictEqual(plan.goal, "Updated goal");
    assert.strictEqual(plan.current_task, "Updated task");
  });

  it("each agent has exactly one plan after multiple updates", async () => {
    const client = suite.client();
    const agents = await registerAgents(client, 3);

    // Each agent updates their plan 3 times
    for (let round = 0; round < 3; round++) {
      for (const agent of agents) {
        await client.callTool("plan", {
          action: "update",
          agent_key: agent.key,
          goal: `Goal round ${String(round)}`,
          current_task: `Task round ${String(round)}`,
        });
      }
    }

    // CRITICAL: Should have exactly 3 plans (one per agent), NOT 9
    const status = parseJsonRecord(
      await client.callTool("status", {}),
    );
    const plans = getRecordArrayField(status, "plans");
    assert.strictEqual(
      plans.length,
      3,
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
    const agents = await registerAgents(client, 1);
    const agent = agents[0];
    assertDefined(agent, "planning agent");

    // Create plan
    await client.callTool("plan", {
      action: "update",
      agent_key: agent.key,
      goal: "Test goal",
      current_task: "Test task",
    });

    // Get plan
    const result = await client.callTool("plan", {
      action: "get",
      agent_key: agent.key,
    });
    const json = parseJsonRecord(result);
    const plan = getRecordField(json, "plan");
    assert.strictEqual(plan.goal, "Test goal");
  });

  it("plan list returns all plans", async () => {
    const client = suite.client();
    const agents = await registerAgents(client, 2);

    // Create plans for both agents
    for (const agent of agents) {
      await client.callTool("plan", {
        action: "update",
        agent_key: agent.key,
        goal: `Goal for ${agent.name}`,
        current_task: "Task",
      });
    }

    // List plans
    const result = await client.callTool("plan", { action: "list" });
    const json = parseJsonRecord(result);
    const plans = getRecordArrayField(json, "plans");
    assert.strictEqual(plans.length, 2);
  });
});
