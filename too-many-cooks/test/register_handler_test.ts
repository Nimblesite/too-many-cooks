/// Tests for register tool handler (direct import, not via spawned server).

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  type TooManyCooksDb,
  createDataConfig,
  createDb,
} from "../lib/src/data/data.js";
import { createNotificationEmitter } from "../lib/src/notifications.js";
import { createLoggerWithContext, createLoggingContext } from "../lib/src/logger.js";
import type { SessionIdentity } from "../lib/src/types.js";
import { createRegisterHandler } from "../lib/src/tools/register_tool.js";

const TEST_DB_PATH = ".test_register_handler.db";

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

describe("register handler", () => {
  let db: TooManyCooksDb | undefined;

  beforeEach(() => {
    deleteIfExists(TEST_DB_PATH);
    const config = createDataConfig({ dbPath: TEST_DB_PATH });
    const result = createDb(config);
    assert.strictEqual(result.ok, true);
    if (!result.ok) { throw new Error("expected ok"); }
    db = result.value;
  });

  afterEach(() => {
    db?.close();
    deleteIfExists(TEST_DB_PATH);
  });

  it("registers a new agent with name", async () => {
    if (!db) { throw new Error("expected db"); }
    let session: SessionIdentity | null = null;
    const setSession = (agentName: string, agentKey: string): void => {
      session = { agentName, agentKey };
    };
    const handler = createRegisterHandler(db, createTestEmitter(), createTestLogger(), setSession);
    const result = await handler({ name: "test-agent" }, {});
    assert.strictEqual(result.isError, false);
    const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
    assert.strictEqual(parsed.agent_name, "test-agent");
    assert.strictEqual(typeof parsed.agent_key, "string");
    assert.notStrictEqual(session, null);
    assert.strictEqual(session!.agentName, "test-agent");
  });

  it("reconnects with existing key", async () => {
    if (!db) { throw new Error("expected db"); }
    const regResult = db.register("reconnect-agent");
    if (!regResult.ok) { throw new Error("expected ok"); }
    const { agentKey } = regResult.value;

    let session: SessionIdentity | null = null;
    const setSession = (agentName: string, key: string): void => {
      session = { agentName, agentKey: key };
    };
    const handler = createRegisterHandler(db, createTestEmitter(), createTestLogger(), setSession);
    const result = await handler({ key: agentKey }, {});
    assert.strictEqual(result.isError, false);
    const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
    assert.strictEqual(parsed.agent_name, "reconnect-agent");
    assert.strictEqual(parsed.agent_key, agentKey);
    assert.notStrictEqual(session, null);
  });

  it("fails when both name and key provided", async () => {
    if (!db) { throw new Error("expected db"); }
    const setSession = (): void => { /* noop */ };
    const handler = createRegisterHandler(db, createTestEmitter(), createTestLogger(), setSession);
    const result = await handler({ name: "agent", key: "some-key" }, {});
    assert.strictEqual(result.isError, true);
    const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
    assert.strictEqual(typeof parsed.error, "string");
  });

  it("fails when neither name nor key provided", async () => {
    if (!db) { throw new Error("expected db"); }
    const setSession = (): void => { /* noop */ };
    const handler = createRegisterHandler(db, createTestEmitter(), createTestLogger(), setSession);
    const result = await handler({}, {});
    assert.strictEqual(result.isError, true);
    const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
    assert.strictEqual(typeof parsed.error, "string");
  });

  it("fails reconnect with invalid key", async () => {
    if (!db) { throw new Error("expected db"); }
    const setSession = (): void => { /* noop */ };
    const handler = createRegisterHandler(db, createTestEmitter(), createTestLogger(), setSession);
    const result = await handler({ key: "nonexistent-key" }, {});
    assert.strictEqual(result.isError, true);
  });

  it("re-registers an already registered name", async () => {
    if (!db) { throw new Error("expected db"); }
    const regResult = db.register("duplicate-agent");
    if (!regResult.ok) { throw new Error("expected ok"); }

    let session: SessionIdentity | null = null;
    const setSession = (agentName: string, agentKey: string): void => {
      session = { agentName, agentKey };
    };
    const handler = createRegisterHandler(db, createTestEmitter(), createTestLogger(), setSession);
    const result = await handler({ name: "duplicate-agent" }, {});
    assert.strictEqual(result.isError, false);
    const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
    assert.strictEqual(parsed.agent_name, "duplicate-agent");
    assert.notStrictEqual(session, null);
  });
});
