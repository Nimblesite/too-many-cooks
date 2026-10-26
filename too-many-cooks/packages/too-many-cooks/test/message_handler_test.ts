/// Tests for message tool handler (direct import, not via spawned server).

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import type { SessionIdentity, TooManyCooksDb } from "too-many-cooks-core";
import {
  freshTestDb,
  registerAgentPair,
  requireDb,
  teardownTestDb,
} from "./support/db_fixture.js";
import {
  messageHandlerFor,
  parseToolJson,
  runToolErr,
  runToolOk,
} from "./support/handlers.js";
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

    const [agent1, agent2] = await registerAgentPair(db, "msg-agent-1", "msg-agent-2");
    agentName = agent1.agentName;
    agentKey = agent1.agentKey;
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
    const d = requireDb(db);
    const parsed = await runToolOk(
      messageHandlerFor(d, makeSession()),
      { action: "send", to_agent: agent2Name, content: "hello" },
    );
    assert.strictEqual(parsed.sent, true);
    assert.strictEqual(typeof parsed.message_id, "string");
  });

  it("get returns messages for agent", async () => {
    const d = requireDb(db);
    // Send a message from agent1 to agent2
    const handler1 = messageHandlerFor(d, makeSession());
    await handler1({ action: "send", to_agent: agent2Name, content: "test msg" }, {});

    // Agent2 gets messages
    const parsed = await runToolOk(messageHandlerFor(d, makeSession2()), { action: "get" });
    assert.strictEqual(Array.isArray(parsed.messages), true);
    const messages = getRecordArrayField(parsed, "messages");
    assert.ok(messages.length > 0);
    const first = messages[0];
    assertDefined(first, "first inbox message");
    assert.strictEqual(first.content, "test msg");
  });

  it("get with unread_only false returns all", async () => {
    const d = requireDb(db);
    const handler1 = messageHandlerFor(d, makeSession());
    await handler1({ action: "send", to_agent: agent2Name, content: "msg1" }, {});

    const parsed = await runToolOk(
      messageHandlerFor(d, makeSession2()),
      { action: "get", unread_only: false },
    );
    assert.strictEqual(Array.isArray(parsed.messages), true);
  });

  it("mark_read succeeds for valid message", async () => {
    const d = requireDb(db);
    // Send message
    const handler1 = messageHandlerFor(d, makeSession());
    const sendResult = await handler1({ action: "send", to_agent: agent2Name, content: "to mark" }, {});
    const sendParsed = parseToolJson(sendResult);
    const messageId = getStringField(sendParsed, "message_id");

    // Mark read
    const parsed = await runToolOk(
      messageHandlerFor(d, makeSession2()),
      { action: "mark_read", message_id: messageId },
    );
    assert.strictEqual(parsed.marked, true);
  });

  it("fails when action is missing", async () => {
    const d = requireDb(db);
    await runToolErr(messageHandlerFor(d, makeSession()), {});
  });

  it("fails with unknown action", async () => {
    const d = requireDb(db);
    await runToolErr(messageHandlerFor(d, makeSession()), { action: "invalid" });
  });

  it("send fails without to_agent", async () => {
    const d = requireDb(db);
    await runToolErr(messageHandlerFor(d, makeSession()), { action: "send", content: "hello" });
  });

  it("send fails without content", async () => {
    const d = requireDb(db);
    await runToolErr(messageHandlerFor(d, makeSession()), { action: "send", to_agent: agent2Name });
  });

  it("mark_read fails without message_id", async () => {
    const d = requireDb(db);
    await runToolErr(messageHandlerFor(d, makeSession()), { action: "mark_read" });
  });

  it("fails when not registered and no session", async () => {
    const d = requireDb(db);
    const getSession = (): SessionIdentity | null => null;
    await runToolErr(messageHandlerFor(d, getSession), { action: "get" });
  });

  it("works with agent_key override", async () => {
    const d = requireDb(db);
    const getSession = (): SessionIdentity | null => null;
    const parsed = await runToolOk(
      messageHandlerFor(d, getSession),
      { action: "send", to_agent: agent2Name, content: "via key", agent_key: agentKey },
    );
    assert.strictEqual(parsed.sent, true);
  });
});
