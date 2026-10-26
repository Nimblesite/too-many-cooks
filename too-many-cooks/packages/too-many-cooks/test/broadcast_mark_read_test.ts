/// E2E test: broadcast messages can be marked read and stop reappearing.
/// Regression test for https://github.com/Nimblesite/too-many-cooks/issues/7

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import type { SessionGetter, TooManyCooksDb } from "too-many-cooks-core";
import {
  freshTestDb,
  registerAgent,
  requireDb,
  teardownTestDb,
} from "./support/db_fixture.js";
import {
  messageHandlerFor,
  nameKeySession,
  parseToolJson,
} from "./support/handlers.js";
import { getRecordArrayField, getStringField } from "./support/json.js";

const TEST_DB_PATH = ".test_broadcast_mark_read.db";

describe("broadcast mark_read bug (issue #7)", () => {
  let db: TooManyCooksDb | undefined;
  let senderName = "";
  let senderKey = "";
  let receiverName = "";
  let receiverKey = "";
  let thirdAgentName = "";
  let thirdAgentKey = "";

  beforeEach(async () => {
    const fixture = freshTestDb(TEST_DB_PATH);
    db = fixture.db;

    const sender = await registerAgent(db, "broadcast-sender");
    senderName = sender.agentName;
    senderKey = sender.agentKey;

    const receiver = await registerAgent(db, "broadcast-receiver");
    receiverName = receiver.agentName;
    receiverKey = receiver.agentKey;

    const third = await registerAgent(db, "broadcast-third");
    thirdAgentName = third.agentName;
    thirdAgentKey = third.agentKey;
  });

  afterEach(() => {
    teardownTestDb(db, TEST_DB_PATH);
  });

  const makeSenderSession = (): SessionGetter =>
    nameKeySession(senderName, senderKey);

  const makeReceiverSession = (): SessionGetter =>
    nameKeySession(receiverName, receiverKey);

  const makeThirdSession = (): SessionGetter =>
    nameKeySession(thirdAgentName, thirdAgentKey);

  it("mark_read succeeds on a broadcast message", async () => {
    const d = requireDb(db);

    // Sender broadcasts a message
    const senderHandler = messageHandlerFor(d, makeSenderSession());
    const sendResult = await senderHandler({ action: "send", to_agent: "*", content: "broadcast announcement" }, {});
    assert.strictEqual(sendResult.isError, false);
    const sendParsed = parseToolJson(sendResult);
    const broadcastId = getStringField(sendParsed, "message_id");

    // Receiver fetches messages — should see the broadcast
    const receiverHandler = messageHandlerFor(d, makeReceiverSession());
    const getResult1 = await receiverHandler({ action: "get" }, {});
    assert.strictEqual(getResult1.isError, false);
    const getParsed1 = parseToolJson(getResult1);
    const messages1 = getRecordArrayField(getParsed1, "messages");
    assert.ok(messages1.some((m) => m.id === broadcastId), "broadcast should appear in get");

    // Receiver marks the broadcast as read — THIS IS THE BUG: returns NOT_FOUND
    const markResult = await receiverHandler({ action: "mark_read", message_id: broadcastId }, {});
    assert.strictEqual(markResult.isError, false, "mark_read on broadcast must succeed, not return NOT_FOUND");
    const markParsed = parseToolJson(markResult);
    assert.strictEqual(markParsed.marked, true);
  });

  it("broadcast disappears from inbox after mark_read", async () => {
    const d = requireDb(db);

    // Sender broadcasts
    const senderHandler = messageHandlerFor(d, makeSenderSession());
    const sendResult = await senderHandler({ action: "send", to_agent: "*", content: "ephemeral broadcast" }, {});
    const sendParsed = parseToolJson(sendResult);
    const broadcastId = getStringField(sendParsed, "message_id");

    // Receiver gets messages (first fetch)
    const receiverHandler = messageHandlerFor(d, makeReceiverSession());
    const getResult1 = await receiverHandler({ action: "get" }, {});
    const parsed1 = parseToolJson(getResult1);
    const msgs1 = getRecordArrayField(parsed1, "messages");
    assert.ok(msgs1.some((m) => m.id === broadcastId), "broadcast visible on first get");

    // Receiver marks broadcast as read
    await receiverHandler({ action: "mark_read", message_id: broadcastId }, {});

    // Receiver gets messages again with unread_only (default) — broadcast must NOT reappear
    const getResult2 = await receiverHandler({ action: "get" }, {});
    const parsed2 = parseToolJson(getResult2);
    const msgs2 = getRecordArrayField(parsed2, "messages");
    assert.ok(
      !msgs2.some((m) => m.id === broadcastId),
      "broadcast must not reappear after mark_read",
    );
  });

  it("broadcast read by one agent is still unread for another", async () => {
    const d = requireDb(db);

    // Sender broadcasts
    const senderHandler = messageHandlerFor(d, makeSenderSession());
    const sendResult = await senderHandler({ action: "send", to_agent: "*", content: "multi-reader broadcast" }, {});
    const sendParsed = parseToolJson(sendResult);
    const broadcastId = getStringField(sendParsed, "message_id");

    // Receiver marks it as read
    const receiverHandler = messageHandlerFor(d, makeReceiverSession());
    await receiverHandler({ action: "get" }, {});
    await receiverHandler({ action: "mark_read", message_id: broadcastId }, {});

    // Third agent should STILL see it as unread
    const thirdHandler = messageHandlerFor(d, makeThirdSession());
    const getResult = await thirdHandler({ action: "get" }, {});
    const parsed = parseToolJson(getResult);
    const msgs = getRecordArrayField(parsed, "messages");
    assert.ok(
      msgs.some((m) => m.id === broadcastId),
      "broadcast must still be visible to agents who haven't read it",
    );
  });

  it("auto-mark-read on get prevents broadcast from reappearing", async () => {
    const d = requireDb(db);

    // Sender broadcasts
    const senderHandler = messageHandlerFor(d, makeSenderSession());
    await senderHandler({ action: "send", to_agent: "*", content: "auto-read broadcast" }, {});

    // Receiver fetches messages (auto-marks as read)
    const receiverHandler = messageHandlerFor(d, makeReceiverSession());
    const getResult1 = await receiverHandler({ action: "get" }, {});
    const parsed1 = parseToolJson(getResult1);
    const msgs1 = getRecordArrayField(parsed1, "messages");
    assert.strictEqual(msgs1.length, 1, "first get should return the broadcast");

    // Second get with unread_only should return nothing
    const getResult2 = await receiverHandler({ action: "get" }, {});
    const parsed2 = parseToolJson(getResult2);
    const msgs2 = getRecordArrayField(parsed2, "messages");
    assert.strictEqual(msgs2.length, 0, "second get should return no messages after auto-mark-read");
  });
});
