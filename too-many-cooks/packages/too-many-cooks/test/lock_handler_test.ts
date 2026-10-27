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
import {
  createTestEmitter,
  createTestLogger,
  parseToolJson,
  runToolErr,
  runToolOk,
} from "./support/handlers.js";
import { assertArrayFieldCount } from "./support/assertions.js";

const TEST_DB_PATH = ".test_lock_handler.db";
const LOCK_AGENT_NAME = "lock-handler-agent";
const SECOND_AGENT_LABEL = "force-handler-agent";
const CONTESTED_AGENT_LABEL = "blocker-agent";

/** One "action succeeds once the agent owns the file" case. */
type OwnedActionCase = {
  readonly name: string;
  readonly action: string;
  readonly flag: string;
  readonly filePath: string;
};

const OWNED_ACTION_CASES: readonly OwnedActionCase[] = [
  { name: "release succeeds when owned", action: "release", flag: "released", filePath: "/release/file.ts" },
  { name: "renew succeeds when owned", action: "renew", flag: "renewed", filePath: "/renew/file.ts" },
];

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

  /** Session getter for a freshly registered second agent. */
  const sessionForNewAgent = async (
    label: string,
  ): Promise<() => SessionIdentity> => {
    const agent = await registerAgent(testDb.db(), label);
    return () => ({ agentName: agent.agentName, agentKey: agent.agentKey });
  };

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

  /** Runs a lock-handler call as `getSession`, expecting success. */
  const runOkAs = async (
    getSession: () => SessionIdentity | null,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> =>
    runToolOk(
      async (toolArgs: Record<string, unknown>): Promise<CallToolResult> =>
        runLockHandler(toolArgs, getSession),
      args,
    );

  /** Runs a lock-handler call as `getSession`, expecting a tool error. */
  const runErrAs = async (
    getSession: () => SessionIdentity | null,
    args: Record<string, unknown>,
  ): Promise<CallToolResult> =>
    runToolErr(
      async (toolArgs: Record<string, unknown>): Promise<CallToolResult> =>
        runLockHandler(toolArgs, getSession),
      args,
    );

  /** Runs a lock-handler call as the bound agent, expecting success. */
  const runAsAgentOk = async (
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => await runOkAs(makeSession(), args);

  /** Runs a lock-handler call as the bound agent, expecting a tool error. */
  const runAsAgentErr = async (
    args: Record<string, unknown>,
  ): Promise<CallToolResult> => await runErrAs(makeSession(), args);

  const nullSession = (): SessionIdentity | null => null;

  it("acquire succeeds on free file", async () => {
    const parsed = await runAsAgentOk({ action: "acquire", file_path: "/test/file.ts", reason: "editing" });
    assert.strictEqual(parsed.acquired, true);
  });

  for (const testCase of OWNED_ACTION_CASES) {
    it(testCase.name, async () => {
      await runAsAgentOk({ action: "acquire", file_path: testCase.filePath });
      const parsed = await runAsAgentOk({ action: testCase.action, file_path: testCase.filePath });
      assert.strictEqual(parsed[testCase.flag], true);
    });
  }

  it("query returns lock info", async () => {
    await runAsAgentOk({ action: "acquire", file_path: "/query/file.ts", reason: "testing" });
    const parsed = await runAsAgentOk({ action: "query", file_path: "/query/file.ts" });
    assert.strictEqual(parsed.locked, true);
  });

  it("query returns unlocked for free file", async () => {
    const parsed = await runAsAgentOk({ action: "query", file_path: "/free/file.ts" });
    assert.strictEqual(parsed.locked, false);
  });

  it("list returns all locks", async () => {
    await runAsAgentOk({ action: "acquire", file_path: "/list/a.ts" });
    await runAsAgentOk({ action: "acquire", file_path: "/list/b.ts" });
    const parsed = await runAsAgentOk({ action: "list" });
    assertArrayFieldCount(parsed, "locks", 2);
  });

  it("force_release fails on non-expired lock", async () => {
    const getSession2 = await sessionForNewAgent(SECOND_AGENT_LABEL);

    await runAsAgentOk({ action: "acquire", file_path: "/force/file.ts" });
    await runErrAs(getSession2, { action: "force_release", file_path: "/force/file.ts" });
  });

  it("fails when action is missing", async () => {
    await runAsAgentErr({});
  });

  it("fails with unknown action", async () => {
    await runAsAgentErr({ action: "invalid_action" });
  });

  it("acquire fails without file_path", async () => {
    await runAsAgentErr({ action: "acquire" });
  });

  it("release fails without file_path", async () => {
    await runAsAgentErr({ action: "release" });
  });

  it("renew fails without file_path", async () => {
    await runAsAgentErr({ action: "renew" });
  });

  it("query fails without file_path", async () => {
    await runAsAgentErr({ action: "query" });
  });

  it("force_release fails without file_path", async () => {
    await runAsAgentErr({ action: "force_release" });
  });

  it("fails when not registered and no session", async () => {
    await runErrAs(nullSession, { action: "acquire", file_path: "/test.ts" });
  });

  it("works with agent_key override", async () => {
    const parsed = await runOkAs(nullSession, { action: "acquire", file_path: "/override.ts", agent_key: agentKey });
    assert.strictEqual(parsed.acquired, true);
  });

  it("acquire returns error when held by another", async () => {
    const getSession2 = await sessionForNewAgent(CONTESTED_AGENT_LABEL);

    // First agent acquires, second agent tries
    await runAsAgentOk({ action: "acquire", file_path: "/contested.ts" });
    const result = await runErrAs(getSession2, { action: "acquire", file_path: "/contested.ts" });
    const parsed = parseToolJson(result);
    assert.strictEqual(parsed.acquired, false);
  });
});
