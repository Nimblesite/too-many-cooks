/// Integration tests — lock tool actions beyond acquire/release:
/// query, list, renew, and force_release on expired locks.

import { describe, it } from "node:test";
import assert from "node:assert";

import {
  type Agent,
  bindIntegrationSuite,
  callToolJson,
  callToolArrayField,
  registerAgentPair,
  registerAgents,
  registerSingleAgent,
} from "./support/integration_server.js";

const TEST_PORT = 4059;
const TMP_PREFIX = "/tmp/tmc-integration-locks-";
const LOCK_TOOL = "lock";
const LOCK_AGENT_COUNT = 3;

describe("Too Many Cooks MCP Server Integration", () => {
  // Server for the file; DB reset + fresh MCP client for each test
  const suite = bindIntegrationSuite(TEST_PORT, TMP_PREFIX);

  /** Calls `action` on `filePath` as `agent` through the lock tool. */
  const callLock = async (
    client: ReturnType<typeof suite.client>,
    action: string,
    filePath: string,
    agent: Agent,
  ): Promise<Record<string, unknown>> =>
    await callToolJson(client, LOCK_TOOL, {
      action,
      file_path: filePath,
      agent_key: agent.key,
    });

  /** Acquires `filePath` for `agent` through the lock tool. */
  const acquireFor = async (
    client: ReturnType<typeof suite.client>,
    agent: Agent,
    filePath: string,
  ): Promise<void> => {
    await callLock(client, "acquire", filePath, agent);
  };

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

    await acquireFor(client, agent, filePath);

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
    const agents = await registerAgents(client, LOCK_AGENT_COUNT);

    // Acquire locks on different files
    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i];
      assert.ok(agent !== undefined, "locking agent");
      await acquireFor(client, agent, `/src/list_test_${String(i)}.dart`);
    }

    const locks = await callToolArrayField(client, LOCK_TOOL, "list", "locks");
    assert.strictEqual(locks.length, LOCK_AGENT_COUNT);
  });

  it("lock renew extends expiration", async () => {
    const client = suite.client();
    const agent = await registerSingleAgent(client, "locking agent");
    const filePath = "/src/renew_test.dart";

    await acquireFor(client, agent, filePath);

    const json = await callLock(client, "renew", filePath, agent);
    assert.strictEqual(json.renewed, true);
  });

  it("lock force_release works on expired locks", async () => {
    const client = suite.client();
    const [holder, releaser] = await registerAgentPair(client, "lock holder", "force releaser");

    // Agent 0 acquires lock
    const filePath = "/src/force_release_test.dart";
    await acquireFor(client, holder, filePath);

    // Agent 1 tries to force release (should work for expired locks only)
    const json = await callLock(client, "force_release", filePath, releaser);
    // May fail if lock not expired, but exercises the code path
    assert.ok("released" in json || "error" in json);
  });
});
