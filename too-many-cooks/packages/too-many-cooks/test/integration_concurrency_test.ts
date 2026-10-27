/// Integration tests — spawn MCP server process, agents hit it
/// concurrently: registration, locks, plans, messages, broadcasts,
/// status counts, and concurrent lock release.

import { describe, it } from "node:test";
import assert from "node:assert";

import { assertDefined } from "./support/assertions.js";
import {
  getArrayField,
  getNumberField,
  getRecordArrayField,
  getRecordField,
  parseJsonRecord,
} from "./support/json.js";
import {
  assertAllReportedTrue,
  bindIntegrationLifecycle,
  createIntegrationServer,
  registerAgentPair,
  registerAgents,
} from "./support/integration_server.js";

const TEST_PORT = 4056;
const TMP_PREFIX = "/tmp/tmc-integration-concurrency-";

describe("Too Many Cooks MCP Server Integration", () => {
  // Server for the file; DB reset + fresh MCP client for each test
  const suite = bindIntegrationLifecycle(
    createIntegrationServer(TEST_PORT, TMP_PREFIX),
  );

  it("5 agents register concurrently", async () => {
    const client = suite.client();
    const registerPromises = Array.from({ length: 5 }, async (_, i) =>
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
    const agents = await registerAgents(client, 5);

    // All 5 agents acquire locks on different files concurrently
    const lockPromises = agents.map(async (a) =>
      client.callTool("lock", {
        action: "acquire",
        file_path: `/src/${a.name}.dart`,
        agent_key: a.key,
        reason: "editing",
      }),
    );
    const lockResults = await Promise.all(lockPromises);
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
    const agents = await registerAgents(client, 5);

    const planPromises = agents.map(async (a) =>
      client.callTool("plan", {
        action: "update",
        agent_key: a.key,
        goal: `Goal for ${a.name}`,
        current_task: `Working on ${a.name}`,
      }),
    );
    const results = await Promise.all(planPromises);
    assertAllReportedTrue(results, "updated");
  });

  it("5 agents send messages concurrently", async () => {
    const client = suite.client();
    const agents = await registerAgents(client, 5);

    const msgPromises: Array<Promise<string>> = [];
    for (let i = 0; i < agents.length; i++) {
      const sender = agents[i];
      const recipient = agents[(i + 1) % agents.length];
      assertDefined(sender, "sender agent");
      assertDefined(recipient, "recipient agent");
      msgPromises.push(
        client.callTool("message", {
          action: "send",
          agent_key: sender.key,
          to_agent: recipient.name,
          content: `Hello from ${sender.name}!`,
        }),
      );
    }
    const results = await Promise.all(msgPromises);
    assertAllReportedTrue(results, "sent");
  });

  it("broadcast message to all agents", async () => {
    const client = suite.client();
    const agents = await registerAgents(client, 3);
    const broadcaster = agents[0];
    assertDefined(broadcaster, "broadcasting agent");

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
      assertDefined(recipient, "recipient agent");
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
    const agents = await registerAgents(client, 5);

    // Acquire locks
    for (const a of agents) {
      await client.callTool("lock", {
        action: "acquire",
        file_path: `/src/${a.name}.dart`,
        agent_key: a.key,
      });
    }

    // Update plans
    for (const a of agents) {
      await client.callTool("plan", {
        action: "update",
        agent_key: a.key,
        goal: "Goal",
        current_task: "Task",
      });
    }

    // Send messages between agents
    for (let i = 0; i < agents.length; i++) {
      const sender = agents[i];
      const recipient = agents[(i + 1) % agents.length];
      assertDefined(sender, "sender agent");
      assertDefined(recipient, "recipient agent");
      await client.callTool("message", {
        action: "send",
        agent_key: sender.key,
        to_agent: recipient.name,
        content: `Test msg from ${sender.name}`,
      });
    }

    // Check status as a known agent. [STATUS-BOUNDED] Issues #41/#42 + [MSG-PRIVACY]
    // Issue #11: status returns a bounded OVERVIEW of the caller's own inbox —
    // total/unread counts plus recent UNREAD inbox headers (no bodies). In the
    // ring of direct sends, the viewer has exactly two visible messages (one it
    // sent, one it received); only the received one is an unread inbox header.
    const viewer = agents[0];
    assertDefined(viewer, "viewer agent");
    const statusJson = parseJsonRecord(
      await client.callTool("status", { agent_key: viewer.key }),
    );
    assert.strictEqual(getArrayField(statusJson, "agents").length, 5);
    assert.strictEqual(getArrayField(statusJson, "locks").length, 5);
    assert.strictEqual(getArrayField(statusJson, "plans").length, 5);
    // CRITICAL: Status MUST include the messages field.
    assert.strictEqual(
      "messages" in statusJson,
      true,
      "Status response MUST include messages field",
    );
    const msgs = getRecordField(statusJson, "messages");
    assert.strictEqual(getNumberField(msgs, "total"), 2, "viewer has two visible messages (one sent, one received)");
    assert.strictEqual(getNumberField(msgs, "unread"), 1, "only the received message is an unread inbox item");
    const recent = getRecordArrayField(msgs, "recent");
    assert.strictEqual(recent.length, 1, "recent holds the single unread inbox header");

    // [STATUS-BOUNDED] recent items are headers — routed to the caller, never bodies.
    const firstMsg = recent[0];
    assertDefined(firstMsg, "recent header");
    assert.ok("id" in firstMsg);
    assert.ok("from_agent" in firstMsg);
    assert.strictEqual(firstMsg.to_agent, viewer.name, "recent header must be addressed to the caller");
    assert.ok("created_at" in firstMsg);
    assert.strictEqual("content" in firstMsg, false, "status headers must never carry the body");
  });

  it("agents release locks concurrently", async () => {
    const client = suite.client();
    const agents = await registerAgents(client, 5);

    // Acquire locks
    for (const a of agents) {
      await client.callTool("lock", {
        action: "acquire",
        file_path: `/src/${a.name}.dart`,
        agent_key: a.key,
      });
    }

    // Release all concurrently
    const releasePromises = agents.map(async (a) =>
      client.callTool("lock", {
        action: "release",
        file_path: `/src/${a.name}.dart`,
        agent_key: a.key,
      }),
    );
    const results = await Promise.all(releasePromises);
    assertAllReportedTrue(results, "released");

    // Verify no locks remain
    const status = parseJsonRecord(
      await client.callTool("status", {}),
    );
    assert.strictEqual(getArrayField(status, "locks").length, 0);
  });
});
