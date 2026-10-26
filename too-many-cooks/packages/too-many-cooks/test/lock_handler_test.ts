/// Tests for lock tool handler (direct import, not via spawned server).

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import {
  type CallToolResult,
  type TooManyCooksDataConfig,
  createDataConfig,
  createLockHandler,
} from "too-many-cooks-core";
import type { SessionIdentity } from "too-many-cooks-core";
import { bindTestDb, registerAgent } from "./support/db_fixture.js";
import { createTestEmitter, createTestLogger, parseToolJson } from "./support/handlers.js";
import { getArrayField } from "./support/json.js";

const TEST_DB_PATH = ".test_lock_handler.db";
const LOCK_AGENT_NAME = "lock-handler-agent";

describe("lock handler", () => {
  const testDb = bindTestDb(TEST_DB_PATH);
  const initialConfig: TooManyCooksDataConfig = createDataConfig({ dbPath: TEST_DB_PATH });
  let agentName = "";
  let agentKey = "";
  let config: TooManyCooksDataConfig = initialConfig;

  beforeEach(async () => {
    config = testDb.config();
    const agent = await registerAgent(testDb.db(), LOCK_AGENT_NAME);
    agentName = agent.agentName;
    agentKey = agent.agentKey;
  });

  const makeSession = (): (() => SessionIdentity) =>
    () => ({ agentName, agentKey });

  /** Calls the lock handler for the current db/config and session. */
  const runLockHandler = async (
    args: Record<string, unknown>,
    getSession: () => SessionIdentity | null,
  ): Promise<CallToolResult> => {
    const handler = createLockHandler(
      testDb.db(), config, createTestEmitter(), createTestLogger(), getSession,
    );
    return handler(args, {});
  };

  const runAsAgent = async (
    args: Record<string, unknown>,
  ): Promise<CallToolResult> => runLockHandler(args, makeSession());

  const nullSession = (): SessionIdentity | null => null;

  it("acquire succeeds on free file", async () => {
    const result = await runAsAgent({ action: "acquire", file_path: "/test/file.ts", reason: "editing" });
    assert.strictEqual(result.isError, false);
    const parsed = parseToolJson(result);
    assert.strictEqual(parsed.acquired, true);
  });

  it("release succeeds when owned", async () => {
    await runAsAgent({ action: "acquire", file_path: "/release/file.ts" });
    const result = await runAsAgent({ action: "release", file_path: "/release/file.ts" });
    assert.strictEqual(result.isError, false);
    const parsed = parseToolJson(result);
    assert.strictEqual(parsed.released, true);
  });

  it("renew succeeds when owned", async () => {
    await runAsAgent({ action: "acquire", file_path: "/renew/file.ts" });
    const result = await runAsAgent({ action: "renew", file_path: "/renew/file.ts" });
    assert.strictEqual(result.isError, false);
    const parsed = parseToolJson(result);
    assert.strictEqual(parsed.renewed, true);
  });

  it("query returns lock info", async () => {
    await runAsAgent({ action: "acquire", file_path: "/query/file.ts", reason: "testing" });
    const result = await runAsAgent({ action: "query", file_path: "/query/file.ts" });
    assert.strictEqual(result.isError, false);
    const parsed = parseToolJson(result);
    assert.strictEqual(parsed.locked, true);
  });

  it("query returns unlocked for free file", async () => {
    const result = await runAsAgent({ action: "query", file_path: "/free/file.ts" });
    assert.strictEqual(result.isError, false);
    const parsed = parseToolJson(result);
    assert.strictEqual(parsed.locked, false);
  });

  it("list returns all locks", async () => {
    await runAsAgent({ action: "acquire", file_path: "/list/a.ts" });
    await runAsAgent({ action: "acquire", file_path: "/list/b.ts" });
    const result = await runAsAgent({ action: "list" });
    assert.strictEqual(result.isError, false);
    const parsed = parseToolJson(result);
    assert.strictEqual(Array.isArray(parsed.locks), true);
    assert.strictEqual(getArrayField(parsed, "locks").length, 2);
  });

  it("force_release fails on non-expired lock", async () => {
    // Register second agent
    const agent2 = await registerAgent(testDb.db(), "force-handler-agent");
    const getSession2 = (): SessionIdentity => ({ agentName: agent2.agentName, agentKey: agent2.agentKey });

    await runAsAgent({ action: "acquire", file_path: "/force/file.ts" });
    const result = await runLockHandler({ action: "force_release", file_path: "/force/file.ts" }, getSession2);
    assert.strictEqual(result.isError, true);
  });

  it("fails when action is missing", async () => {
    const result = await runAsAgent({});
    assert.strictEqual(result.isError, true);
  });

  it("fails with unknown action", async () => {
    const result = await runAsAgent({ action: "invalid_action" });
    assert.strictEqual(result.isError, true);
  });

  it("acquire fails without file_path", async () => {
    const result = await runAsAgent({ action: "acquire" });
    assert.strictEqual(result.isError, true);
  });

  it("release fails without file_path", async () => {
    const result = await runAsAgent({ action: "release" });
    assert.strictEqual(result.isError, true);
  });

  it("renew fails without file_path", async () => {
    const result = await runAsAgent({ action: "renew" });
    assert.strictEqual(result.isError, true);
  });

  it("query fails without file_path", async () => {
    const result = await runAsAgent({ action: "query" });
    assert.strictEqual(result.isError, true);
  });

  it("force_release fails without file_path", async () => {
    const result = await runAsAgent({ action: "force_release" });
    assert.strictEqual(result.isError, true);
  });

  it("fails when not registered and no session", async () => {
    const result = await runLockHandler({ action: "acquire", file_path: "/test.ts" }, nullSession);
    assert.strictEqual(result.isError, true);
  });

  it("works with agent_key override", async () => {
    const result = await runLockHandler(
      { action: "acquire", file_path: "/override.ts", agent_key: agentKey },
      nullSession,
    );
    assert.strictEqual(result.isError, false);
    const parsed = parseToolJson(result);
    assert.strictEqual(parsed.acquired, true);
  });

  it("acquire returns error when held by another", async () => {
    const agent2 = await registerAgent(testDb.db(), "blocker-agent");

    // First agent acquires
    await runAsAgent({ action: "acquire", file_path: "/contested.ts" });

    // Second agent tries
    const getSession2 = (): SessionIdentity => ({
      agentName: agent2.agentName,
      agentKey: agent2.agentKey,
    });
    const result = await runLockHandler({ action: "acquire", file_path: "/contested.ts" }, getSession2);
    assert.strictEqual(result.isError, true);
    const parsed = parseToolJson(result);
    assert.strictEqual(parsed.acquired, false);
  });
});
