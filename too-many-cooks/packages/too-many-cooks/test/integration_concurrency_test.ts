/// Integration tests — spawn MCP server process, agents hit it
/// concurrently: registration, locks, plans, messages, broadcasts,
/// status counts, and concurrent lock release.

import { describe, it } from "node:test";
import assert from "node:assert";

import {
  getArrayField,
  getNumberField,
  getRecordArrayField,
  getRecordField,
  parseJsonRecord,
} from "./support/json.js";
import { assertArrayFieldCount } from "./support/assertions.js";
import {
  type Agent,
  assertAllReportedTrue,
  bindIntegrationSuite,
  registerAgentPair,
  registerAgents,
} from "./support/integration_server.js";

const TEST_PORT = 4056;
const TMP_PREFIX = "/tmp/tmc-integration-concurrency-";
const AGENT_COUNT = 5;
const BROADCAST_COUNT = 3;
const VIEWER_VISIBLE_MESSAGES = 2;
const VIEWER_UNREAD_MESSAGES = 1;

describe("Too Many Cooks MCP Server Integration", () => {
  // Server for the file; DB reset + fresh MCP client for each test
  const suite = bindIntegrationSuite(TEST_PORT, TMP_PREFIX);

  /** The file path agent `a` locks in this suite. */
  const agentFile = (a: Agent): string => `/src/${a.name}.dart`;

  /** Acquires every agent's own file lock concurrently; returns the results. */
  const acquireAllLocks = async (
    client: ReturnType<typeof suite.client>,
    agents: readonly Agent[],
  ): Promise<readonly string[]> =>
    await Promise.all(
      agents.map(async (a) =>
        await client.callTool("lock", {
          action: "acquire",
          file_path: agentFile(a),
          agent_key: a.key,
        }),
      ),
    );

  /** Updates every agent's plan concurrently; returns the results. */
  const updateAllPlans = async (
    client: ReturnType<typeof suite.client>,
    agents: readonly Agent[],
    goalFor: (agent: Agent) => string,
    taskFor: (agent: Agent) => string,
  ): Promise<readonly string[]> =>
    await Promise.all(
      agents.map(async (a) =>
        await client.callTool("plan", {
          action: "update",
          agent_key: a.key,
          goal: goalFor(a),
          current_task: taskFor(a),
        }),
      ),
    );

  /** Every agent sends to the next agent in the ring; returns the results. */
  const sendRing = async (
    client: ReturnType<typeof suite.client>,
    agents: readonly Agent[],
    contentFor: (sender: Agent) => string,
  ): Promise<readonly string[]> =>
    await Promise.all(
      agents.map(async (sender, i) => {
        const recipient = agents[(i + 1) % agents.length];
        assert.ok(sender !== undefined, "sender agent");
        assert.ok(recipient !== undefined, "recipient agent");
        return await client.callTool("message", {
          action: "send",
          agent_key: sender.key,
          to_agent: recipient.name,
          content: contentFor(sender),
        });
      }),
    );

  it("5 agents register concurrently", async () => {
    const client = suite.client();
    const registerPromises = Array.from({ length: AGENT_COUNT }, async (_, i) =>
      client.callTool("register", { name: `agent${String(i)}` }),
    );
    const regResults = await Promise.all(registerPromises);

    for (const r of regResults) {
      const json = parseJsonRecord(r);
      assert.ok(json.agent_name !== null && json.agent_name !== undefined);
      assert.ok(json.agent_key !== null && json.agent_key !== undefined);
    }
  });

  it("5 agents acquire locks on different files concurrently", async () => {
    const client = suite.client();
    // Register agents first
    const agents = await registerAgents(client, AGENT_COUNT);

    // All 5 agents acquire locks on different files concurrently
    const lockResults = await acquireAllLocks(client, agents);
    assertAllReportedTrue(lockResults, "acquired");
  });

  it("lock race condition handled correctly", async () => {
    const client = suite.client();
    const [first, second] = await registerAgentPair(client, "first agent", "second agent");

    const contested = "/contested/file.dart";
    const raceResults = await Promise.all([
      client.callTool("lock", {
        action: "acquire",
        file_path: contested,
        agent_key: first.key,
      }),
      client.callTool("lock", {
        action: "acquire",
        file_path: contested,
        agent_key: second.key,
      }),
    ]);

    const acquired0 =
      parseJsonRecord(raceResults[0]).acquired ===
      true;
    const acquired1 =
      parseJsonRecord(raceResults[1]).acquired ===
      true;

    // Exactly one should win the race
    assert.strictEqual(acquired0 !== acquired1, true);
  });

  it("5 agents update plans concurrently", async () => {
    const client = suite.client();
    const agents = await registerAgents(client, AGENT_COUNT);

    const results = await updateAllPlans(
      client,
      agents,
      (agent) => `Goal for ${agent.name}`,
      (agent) => `Working on ${agent.name}`,
    );
    assertAllReportedTrue(results, "updated");
  });

  it("5 agents send messages concurrently", async () => {
    const client = suite.client();
    const agents = await registerAgents(client, AGENT_COUNT);

    const results = await sendRing(client, agents, (sender) => `Hello from ${sender.name}!`);
    assertAllReportedTrue(results, "sent");
  });

  it("broadcast message to all agents", async () => {
    const client = suite.client();
    const agents = await registerAgents(client, BROADCAST_COUNT);
    const broadcaster = agents[0];
    assert.ok(broadcaster !== undefined, "broadcasting agent");

    // Send broadcast
    const broadcastResult = await client.callTool("message", {
      action: "send",
      agent_key: broadcaster.key,
      to_agent: "*",
      content: "Broadcast!",
    });
    assert.strictEqual(
      parseJsonRecord(broadcastResult).sent,
      true,
    );

    // All agents except sender should receive it
    for (let i = 1; i < agents.length; i++) {
      const recipient = agents[i];
      assert.ok(recipient !== undefined, "recipient agent");
      const inboxResult = await client.callTool("message", {
        action: "get",
        agent_key: recipient.key,
      });
      const json = parseJsonRecord(inboxResult);
      const messages = getArrayField(json, "messages");
      assert.ok(messages.length > 0);
    }
  });

  it("status shows correct counts including messages", async () => {
    const client = suite.client();
    const agents = await registerAgents(client, AGENT_COUNT);

    await acquireAllLocks(client, agents);
    await updateAllPlans(client, agents, () => "Goal", () => "Task");
    await sendRing(client, agents, (sender) => `Test msg from ${sender.name}`);

    // Check status as a known agent. [STATUS-BOUNDED] Issues #41/#42 + [MSG-PRIVACY]
    // Issue #11: status returns a bounded OVERVIEW of the caller's own inbox —
    // total/unread counts plus recent UNREAD inbox headers (no bodies). In the
    // ring of direct sends, the viewer has exactly two visible messages (one it
    // sent, one it received); only the received one is an unread inbox header.
    const viewer = agents[0];
    assert.ok(viewer !== undefined, "viewer agent");
    const status = parseJsonRecord(
      await client.callTool("status", { agent_key: viewer.key }),
    );
    assertArrayFieldCount(status, "agents", AGENT_COUNT);
    assertArrayFieldCount(status, "locks", AGENT_COUNT);
    assertArrayFieldCount(status, "plans", AGENT_COUNT);
    // CRITICAL: Status MUST include the messages field.
    assert.strictEqual(
      "messages" in status,
      true,
      "Status response MUST include messages field",
    );
    const msgs = getRecordField(status, "messages");
    assert.strictEqual(getNumberField(msgs, "total"), VIEWER_VISIBLE_MESSAGES, "viewer has two visible messages (one sent, one received)");
    assert.strictEqual(getNumberField(msgs, "unread"), VIEWER_UNREAD_MESSAGES, "only the received message is an unread inbox item");
    const recent = getRecordArrayField(msgs, "recent");
    assert.strictEqual(recent.length, VIEWER_UNREAD_MESSAGES, "recent holds the single unread inbox header");

    // [STATUS-BOUNDED] recent items are headers — routed to the caller, never bodies.
    const firstMsg = recent[0];
    assert.ok(firstMsg !== undefined, "recent header");
    assert.ok("id" in firstMsg);
    assert.ok("from_agent" in firstMsg);
    assert.strictEqual(firstMsg.to_agent, viewer.name, "recent header must be addressed to the caller");
    assert.ok("created_at" in firstMsg);
    assert.strictEqual("content" in firstMsg, false, "status headers must never carry the body");
  });

  it("agents release locks concurrently", async () => {
    const client = suite.client();
    const agents = await registerAgents(client, AGENT_COUNT);

    // Acquire locks
    await acquireAllLocks(client, agents);

    // Release all concurrently
    const releasePromises = agents.map(async (a) =>
      client.callTool("lock", {
        action: "release",
        file_path: agentFile(a),
        agent_key: a.key,
      }),
    );
    const results = await Promise.all(releasePromises);
    assertAllReportedTrue(results, "released");

    // Verify no locks remain
    const status = parseJsonRecord(
      await client.callTool("status", {}),
    );
    assertArrayFieldCount(status, "locks", 0);
  });
});
