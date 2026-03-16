/// Tests for lock tool handler (direct import, not via spawned server).

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  type TooManyCooksDb,
  createDataConfig,
  createNotificationEmitter,
  createLoggerWithContext,
  createLoggingContext,
  createLockHandler,
} from "too-many-cooks-core";
import type { SessionIdentity } from "too-many-cooks-core";
import { createDb } from "../src/db-sqlite.js";

const TEST_DB_PATH = ".test_lock_handler.db";

const deleteIfExists = (filePath: string): void => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // Ignore
  }
};

const createTestEmitter = () => {
  const server = new McpServer(
    { name: "test", version: "1.0.0" },
    { capabilities: { tools: { listChanged: false }, logging: {} } },
  );
  return createNotificationEmitter(server);
};

const createTestLogger = () =>
  createLoggerWithContext(createLoggingContext());

describe("lock handler", () => {
  let db: TooManyCooksDb | undefined;
  let agentName = "";
  let agentKey = "";
  let config = createDataConfig({ dbPath: TEST_DB_PATH });

  beforeEach(async () => {
    deleteIfExists(TEST_DB_PATH);
    config = createDataConfig({ dbPath: TEST_DB_PATH });
    const result = createDb(config);
    assert.strictEqual(result.ok, true);
    if (!result.ok) { throw new Error("expected ok"); }
    db = result.value;

    const regResult = await db.register("lock-handler-agent");
    if (!regResult.ok) { throw new Error("expected ok"); }
    agentName = regResult.value.agentName;
    agentKey = regResult.value.agentKey;
  });

  afterEach(() => {
    db?.close();
    deleteIfExists(TEST_DB_PATH);
  });

  const makeSession = (): (() => SessionIdentity) =>
    () => ({ agentName, agentKey });

  it("acquire succeeds on free file", async () => {
    if (!db) { throw new Error("expected db"); }
    const handler = createLockHandler(db, config, createTestEmitter(), createTestLogger(), makeSession());
    const result = await handler({ action: "acquire", file_path: "/test/file.ts", reason: "editing" }, {});
    assert.strictEqual(result.isError, false);
    const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
    assert.strictEqual(parsed.acquired, true);
  });

  it("release succeeds when owned", async () => {
    if (!db) { throw new Error("expected db"); }
    const handler = createLockHandler(db, config, createTestEmitter(), createTestLogger(), makeSession());
    await handler({ action: "acquire", file_path: "/release/file.ts" }, {});
    const result = await handler({ action: "release", file_path: "/release/file.ts" }, {});
    assert.strictEqual(result.isError, false);
    const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
    assert.strictEqual(parsed.released, true);
  });

  it("renew succeeds when owned", async () => {
    if (!db) { throw new Error("expected db"); }
    const handler = createLockHandler(db, config, createTestEmitter(), createTestLogger(), makeSession());
    await handler({ action: "acquire", file_path: "/renew/file.ts" }, {});
    const result = await handler({ action: "renew", file_path: "/renew/file.ts" }, {});
    assert.strictEqual(result.isError, false);
    const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
    assert.strictEqual(parsed.renewed, true);
  });

  it("query returns lock info", async () => {
    if (!db) { throw new Error("expected db"); }
    const handler = createLockHandler(db, config, createTestEmitter(), createTestLogger(), makeSession());
    await handler({ action: "acquire", file_path: "/query/file.ts", reason: "testing" }, {});
    const result = await handler({ action: "query", file_path: "/query/file.ts" }, {});
    assert.strictEqual(result.isError, false);
    const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
    assert.strictEqual(parsed.locked, true);
  });

  it("query returns unlocked for free file", async () => {
    if (!db) { throw new Error("expected db"); }
    const handler = createLockHandler(db, config, createTestEmitter(), createTestLogger(), makeSession());
    const result = await handler({ action: "query", file_path: "/free/file.ts" }, {});
    assert.strictEqual(result.isError, false);
    const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
    assert.strictEqual(parsed.locked, false);
  });

  it("list returns all locks", async () => {
    if (!db) { throw new Error("expected db"); }
    const handler = createLockHandler(db, config, createTestEmitter(), createTestLogger(), makeSession());
    await handler({ action: "acquire", file_path: "/list/a.ts" }, {});
    await handler({ action: "acquire", file_path: "/list/b.ts" }, {});
    const result = await handler({ action: "list" }, {});
    assert.strictEqual(result.isError, false);
    const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
    assert.strictEqual(Array.isArray(parsed.locks), true);
    assert.strictEqual((parsed.locks as unknown[]).length, 2);
  });

  it("force_release fails on non-expired lock", async () => {
    if (!db) { throw new Error("expected db"); }
    // Register second agent
    const reg2 = await db.register("force-handler-agent");
    if (!reg2.ok) { throw new Error("expected ok"); }
    const agent2Name = reg2.value.agentName;
    const agent2Key = reg2.value.agentKey;

    const handler1 = createLockHandler(db, config, createTestEmitter(), createTestLogger(), makeSession());
    await handler1({ action: "acquire", file_path: "/force/file.ts" }, {});

    const getSession2 = (): SessionIdentity => ({ agentName: agent2Name, agentKey: agent2Key });
    const handler2 = createLockHandler(db, config, createTestEmitter(), createTestLogger(), getSession2);
    const result = await handler2({ action: "force_release", file_path: "/force/file.ts" }, {});
    assert.strictEqual(result.isError, true);
  });

  it("fails when action is missing", async () => {
    if (!db) { throw new Error("expected db"); }
    const handler = createLockHandler(db, config, createTestEmitter(), createTestLogger(), makeSession());
    const result = await handler({}, {});
    assert.strictEqual(result.isError, true);
  });

  it("fails with unknown action", async () => {
    if (!db) { throw new Error("expected db"); }
    const handler = createLockHandler(db, config, createTestEmitter(), createTestLogger(), makeSession());
    const result = await handler({ action: "invalid_action" }, {});
    assert.strictEqual(result.isError, true);
  });

  it("acquire fails without file_path", async () => {
    if (!db) { throw new Error("expected db"); }
    const handler = createLockHandler(db, config, createTestEmitter(), createTestLogger(), makeSession());
    const result = await handler({ action: "acquire" }, {});
    assert.strictEqual(result.isError, true);
  });

  it("release fails without file_path", async () => {
    if (!db) { throw new Error("expected db"); }
    const handler = createLockHandler(db, config, createTestEmitter(), createTestLogger(), makeSession());
    const result = await handler({ action: "release" }, {});
    assert.strictEqual(result.isError, true);
  });

  it("renew fails without file_path", async () => {
    if (!db) { throw new Error("expected db"); }
    const handler = createLockHandler(db, config, createTestEmitter(), createTestLogger(), makeSession());
    const result = await handler({ action: "renew" }, {});
    assert.strictEqual(result.isError, true);
  });

  it("query fails without file_path", async () => {
    if (!db) { throw new Error("expected db"); }
    const handler = createLockHandler(db, config, createTestEmitter(), createTestLogger(), makeSession());
    const result = await handler({ action: "query" }, {});
    assert.strictEqual(result.isError, true);
  });

  it("force_release fails without file_path", async () => {
    if (!db) { throw new Error("expected db"); }
    const handler = createLockHandler(db, config, createTestEmitter(), createTestLogger(), makeSession());
    const result = await handler({ action: "force_release" }, {});
    assert.strictEqual(result.isError, true);
  });

  it("fails when not registered and no session", async () => {
    if (!db) { throw new Error("expected db"); }
    const getSession = (): SessionIdentity | null => null;
    const handler = createLockHandler(db, config, createTestEmitter(), createTestLogger(), getSession);
    const result = await handler({ action: "acquire", file_path: "/test.ts" }, {});
    assert.strictEqual(result.isError, true);
  });

  it("works with agent_key override", async () => {
    if (!db) { throw new Error("expected db"); }
    const getSession = (): SessionIdentity | null => null;
    const handler = createLockHandler(db, config, createTestEmitter(), createTestLogger(), getSession);
    const result = await handler({ action: "acquire", file_path: "/override.ts", agent_key: agentKey }, {});
    assert.strictEqual(result.isError, false);
    const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
    assert.strictEqual(parsed.acquired, true);
  });

  it("acquire returns error when held by another", async () => {
    if (!db) { throw new Error("expected db"); }
    const reg2 = await db.register("blocker-agent");
    if (!reg2.ok) { throw new Error("expected ok"); }

    // First agent acquires
    const handler1 = createLockHandler(db, config, createTestEmitter(), createTestLogger(), makeSession());
    await handler1({ action: "acquire", file_path: "/contested.ts" }, {});

    // Second agent tries
    const getSession2 = (): SessionIdentity => ({
      agentName: reg2.value.agentName,
      agentKey: reg2.value.agentKey,
    });
    const handler2 = createLockHandler(db, config, createTestEmitter(), createTestLogger(), getSession2);
    const result = await handler2({ action: "acquire", file_path: "/contested.ts" }, {});
    assert.strictEqual(result.isError, true);
    const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
    assert.strictEqual(parsed.acquired, false);
  });
});
