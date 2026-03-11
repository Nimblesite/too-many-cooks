/// Tests for message tool handler (direct import, not via spawned server).

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
  createMessageHandler,
} from "@too-many-cooks/core";
import type { SessionIdentity } from "@too-many-cooks/core";
import { createDb } from "../src/db-sqlite.js";

const TEST_DB_PATH = ".test_message_handler.db";

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

describe("message handler", () => {
  let db: TooManyCooksDb | undefined;
  let agentName = "";
  let agentKey = "";
  let agent2Name = "";
  let agent2Key = "";

  beforeEach(async () => {
    deleteIfExists(TEST_DB_PATH);
    const config = createDataConfig({ dbPath: TEST_DB_PATH });
    const result = createDb(config);
    assert.strictEqual(result.ok, true);
    if (!result.ok) { throw new Error("expected ok"); }
    db = result.value;

    const reg1 = await db.register("msg-agent-1");
    if (!reg1.ok) { throw new Error("expected ok"); }
    agentName = reg1.value.agentName;
    agentKey = reg1.value.agentKey;

    const reg2 = await db.register("msg-agent-2");
    if (!reg2.ok) { throw new Error("expected ok"); }
    agent2Name = reg2.value.agentName;
    agent2Key = reg2.value.agentKey;
  });

  afterEach(() => {
    db?.close();
    deleteIfExists(TEST_DB_PATH);
  });

  const makeSession = (): (() => SessionIdentity) =>
    () => ({ agentName, agentKey });

  const makeSession2 = (): (() => SessionIdentity) =>
    () => ({ agentName: agent2Name, agentKey: agent2Key });

  it("send succeeds between agents", async () => {
    if (!db) { throw new Error("expected db"); }
    const handler = createMessageHandler(db, createTestEmitter(), createTestLogger(), makeSession());
    const result = await handler({ action: "send", to_agent: agent2Name, content: "hello" }, {});
    assert.strictEqual(result.isError, false);
    const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
    assert.strictEqual(parsed.sent, true);
    assert.strictEqual(typeof parsed.message_id, "string");
  });

  it("get returns messages for agent", async () => {
    if (!db) { throw new Error("expected db"); }
    // Send a message from agent1 to agent2
    const handler1 = createMessageHandler(db, createTestEmitter(), createTestLogger(), makeSession());
    await handler1({ action: "send", to_agent: agent2Name, content: "test msg" }, {});

    // Agent2 gets messages
    const handler2 = createMessageHandler(db, createTestEmitter(), createTestLogger(), makeSession2());
    const result = await handler2({ action: "get" }, {});
    assert.strictEqual(result.isError, false);
    const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
    assert.strictEqual(Array.isArray(parsed.messages), true);
    const messages = parsed.messages as Record<string, unknown>[];
    assert.ok(messages.length > 0);
    assert.strictEqual(messages[0].content, "test msg");
  });

  it("get with unread_only false returns all", async () => {
    if (!db) { throw new Error("expected db"); }
    const handler1 = createMessageHandler(db, createTestEmitter(), createTestLogger(), makeSession());
    await handler1({ action: "send", to_agent: agent2Name, content: "msg1" }, {});

    const handler2 = createMessageHandler(db, createTestEmitter(), createTestLogger(), makeSession2());
    const result = await handler2({ action: "get", unread_only: false }, {});
    assert.strictEqual(result.isError, false);
    const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
    assert.strictEqual(Array.isArray(parsed.messages), true);
  });

  it("mark_read succeeds for valid message", async () => {
    if (!db) { throw new Error("expected db"); }
    // Send message
    const handler1 = createMessageHandler(db, createTestEmitter(), createTestLogger(), makeSession());
    const sendResult = await handler1({ action: "send", to_agent: agent2Name, content: "to mark" }, {});
    const sendParsed = JSON.parse(sendResult.content[0].text) as Record<string, unknown>;
    const messageId = sendParsed.message_id as string;

    // Mark read
    const handler2 = createMessageHandler(db, createTestEmitter(), createTestLogger(), makeSession2());
    const result = await handler2({ action: "mark_read", message_id: messageId }, {});
    assert.strictEqual(result.isError, false);
    const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
    assert.strictEqual(parsed.marked, true);
  });

  it("fails when action is missing", async () => {
    if (!db) { throw new Error("expected db"); }
    const handler = createMessageHandler(db, createTestEmitter(), createTestLogger(), makeSession());
    const result = await handler({}, {});
    assert.strictEqual(result.isError, true);
  });

  it("fails with unknown action", async () => {
    if (!db) { throw new Error("expected db"); }
    const handler = createMessageHandler(db, createTestEmitter(), createTestLogger(), makeSession());
    const result = await handler({ action: "invalid" }, {});
    assert.strictEqual(result.isError, true);
  });

  it("send fails without to_agent", async () => {
    if (!db) { throw new Error("expected db"); }
    const handler = createMessageHandler(db, createTestEmitter(), createTestLogger(), makeSession());
    const result = await handler({ action: "send", content: "hello" }, {});
    assert.strictEqual(result.isError, true);
  });

  it("send fails without content", async () => {
    if (!db) { throw new Error("expected db"); }
    const handler = createMessageHandler(db, createTestEmitter(), createTestLogger(), makeSession());
    const result = await handler({ action: "send", to_agent: agent2Name }, {});
    assert.strictEqual(result.isError, true);
  });

  it("mark_read fails without message_id", async () => {
    if (!db) { throw new Error("expected db"); }
    const handler = createMessageHandler(db, createTestEmitter(), createTestLogger(), makeSession());
    const result = await handler({ action: "mark_read" }, {});
    assert.strictEqual(result.isError, true);
  });

  it("fails when not registered and no session", async () => {
    if (!db) { throw new Error("expected db"); }
    const getSession = (): SessionIdentity | null => null;
    const handler = createMessageHandler(db, createTestEmitter(), createTestLogger(), getSession);
    const result = await handler({ action: "get" }, {});
    assert.strictEqual(result.isError, true);
  });

  it("works with agent_key override", async () => {
    if (!db) { throw new Error("expected db"); }
    const getSession = (): SessionIdentity | null => null;
    const handler = createMessageHandler(db, createTestEmitter(), createTestLogger(), getSession);
    const result = await handler({ action: "send", to_agent: agent2Name, content: "via key", agent_key: agentKey }, {});
    assert.strictEqual(result.isError, false);
    const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
    assert.strictEqual(parsed.sent, true);
  });
});
