/// Tests for message tool handler (direct import, not via spawned server).

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import {
  type TooManyCooksDb,
  createMessageHandler,
} from "too-many-cooks-core";
import type { SessionIdentity } from "too-many-cooks-core";
import { freshTestDb, registerAgent, teardownTestDb } from "./support/db_fixture.js";
import { createTestEmitter, createTestLogger, parseToolJson } from "./support/handlers.js";
import { assertDefined } from "./support/assertions.js";
import { getRecordArrayField, getStringField } from "./support/json.js";

const TEST_DB_PATH = ".test_message_handler.db";

describe("message handler", () => {
  let db: TooManyCooksDb | undefined;
  let agentName = "";
  let agentKey = "";
  let agent2Name = "";
  let agent2Key = "";

  beforeEach(async () => {
    const fixture = freshTestDb(TEST_DB_PATH);
    db = fixture.db;

    const agent1 = await registerAgent(db, "msg-agent-1");
    agentName = agent1.agentName;
    agentKey = agent1.agentKey;

    const agent2 = await registerAgent(db, "msg-agent-2");
    agent2Name = agent2.agentName;
    agent2Key = agent2.agentKey;
  });

  afterEach(() => {
    teardownTestDb(db, TEST_DB_PATH);
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
    const parsed = parseToolJson(result);
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
    const parsed = parseToolJson(result);
    assert.strictEqual(Array.isArray(parsed.messages), true);
    const messages = getRecordArrayField(parsed, "messages");
    assert.ok(messages.length > 0);
    const first = messages[0];
    assertDefined(first, "first inbox message");
    assert.strictEqual(first.content, "test msg");
  });

  it("get with unread_only false returns all", async () => {
    if (!db) { throw new Error("expected db"); }
    const handler1 = createMessageHandler(db, createTestEmitter(), createTestLogger(), makeSession());
    await handler1({ action: "send", to_agent: agent2Name, content: "msg1" }, {});

    const handler2 = createMessageHandler(db, createTestEmitter(), createTestLogger(), makeSession2());
    const result = await handler2({ action: "get", unread_only: false }, {});
    assert.strictEqual(result.isError, false);
    const parsed = parseToolJson(result);
    assert.strictEqual(Array.isArray(parsed.messages), true);
  });

  it("mark_read succeeds for valid message", async () => {
    if (!db) { throw new Error("expected db"); }
    // Send message
    const handler1 = createMessageHandler(db, createTestEmitter(), createTestLogger(), makeSession());
    const sendResult = await handler1({ action: "send", to_agent: agent2Name, content: "to mark" }, {});
    const sendParsed = parseToolJson(sendResult);
    const messageId = getStringField(sendParsed, "message_id");

    // Mark read
    const handler2 = createMessageHandler(db, createTestEmitter(), createTestLogger(), makeSession2());
    const result = await handler2({ action: "mark_read", message_id: messageId }, {});
    assert.strictEqual(result.isError, false);
    const parsed = parseToolJson(result);
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
    const parsed = parseToolJson(result);
    assert.strictEqual(parsed.sent, true);
  });
});
