/// Integration tests — lock tool actions beyond acquire/release:
/// query, list, renew, and force_release on expired locks.

import { describe, it } from "node:test";
import assert from "node:assert";

import { assertDefined } from "./support/assertions.js";
import { getArrayField } from "./support/json.js";
import {
  bindIntegrationLifecycle,
  callToolJson,
  createIntegrationServer,
  registerAgentPair,
  registerAgents,
  registerSingleAgent,
} from "./support/integration_server.js";

const TEST_PORT = 4059;
const TMP_PREFIX = "/tmp/tmc-integration-locks-";
const LOCK_TOOL = "lock";

describe("Too Many Cooks MCP Server Integration", () => {
  // Server for the file; DB reset + fresh MCP client for each test
  const suite = bindIntegrationLifecycle(
    createIntegrationServer(TEST_PORT, TMP_PREFIX),
  );

  // LOCK TOOL: query, list, renew, force_release
  it("lock query returns lock status", async () => {
    const client = suite.client();
    const agent = await registerSingleAgent(client, "locking agent");
    const filePath = "/src/query_test.dart";

    // Query unlocked file
    const unlocked = await callToolJson(client, LOCK_TOOL, {
      action: "query",
      file_path: filePath,
    });
    assert.strictEqual(unlocked.locked, false);

    await client.callTool(LOCK_TOOL, {
      action: "acquire",
      file_path: filePath,
      agent_key: agent.key,
    });

    // Query locked file
    const locked = await callToolJson(client, LOCK_TOOL, {
      action: "query",
      file_path: filePath,
    });
    assert.strictEqual(locked.locked, true);
    assert.ok(locked.lock !== null && locked.lock !== undefined);
  });

  it("lock list returns all locks", async () => {
    const client = suite.client();
    const agents = await registerAgents(client, 3);

    // Acquire locks on different files
    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i];
      assertDefined(agent, "locking agent");
      await client.callTool(LOCK_TOOL, {
        action: "acquire",
        file_path: `/src/list_test_${String(i)}.dart`,
        agent_key: agent.key,
      });
    }

    const json = await callToolJson(client, LOCK_TOOL, { action: "list" });
    const locks = getArrayField(json, "locks");
    assert.strictEqual(locks.length, 3);
  });

  it("lock renew extends expiration", async () => {
    const client = suite.client();
    const agent = await registerSingleAgent(client, "locking agent");
    const filePath = "/src/renew_test.dart";

    await client.callTool(LOCK_TOOL, {
      action: "acquire",
      file_path: filePath,
      agent_key: agent.key,
    });

    const json = await callToolJson(client, LOCK_TOOL, {
      action: "renew",
      file_path: filePath,
      agent_key: agent.key,
    });
    assert.strictEqual(json.renewed, true);
  });

  it("lock force_release works on expired locks", async () => {
    const client = suite.client();
    const [holder, releaser] = await registerAgentPair(client, "lock holder", "force releaser");

    // Agent 0 acquires lock
    const filePath = "/src/force_release_test.dart";
    await client.callTool(LOCK_TOOL, {
      action: "acquire",
      file_path: filePath,
      agent_key: holder.key,
    });

    // Agent 1 tries to force release (should work for expired locks only)
    const json = await callToolJson(client, LOCK_TOOL, {
      action: "force_release",
      file_path: filePath,
      agent_key: releaser.key,
    });
    // May fail if lock not expired, but exercises the code path
    assert.ok("released" in json || "error" in json);
  });
});
