/// E2E test: broadcast messages can be marked read and stop reappearing.
/// Regression test for https://github.com/Nimblesite/too-many-cooks/issues/7

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import {
  type TooManyCooksDb,
  createDataConfig,
  createNotificationEmitter,
  createLoggerWithContext,
  createLoggingContext,
  createMessageHandler,
} from "too-many-cooks-core";
import type { SessionIdentity } from "too-many-cooks-core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createDb } from "../src/db-sqlite.js";

const TEST_DB_PATH = ".test_broadcast_mark_read.db";

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

describe("broadcast mark_read bug (issue #7)", () => {
  let db: TooManyCooksDb | undefined;
  let senderName = "";
  let senderKey = "";
  let receiverName = "";
  let receiverKey = "";
  let thirdAgentName = "";
  let thirdAgentKey = "";

  beforeEach(async () => {
    deleteIfExists(TEST_DB_PATH);
    const config = createDataConfig({ dbPath: TEST_DB_PATH });
    const result = createDb(config);
    assert.strictEqual(result.ok, true);
    if (!result.ok) { throw new Error("expected ok"); }
    db = result.value;

    const reg1 = await db.register("broadcast-sender");
    if (!reg1.ok) { throw new Error("expected ok"); }
    senderName = reg1.value.agentName;
    senderKey = reg1.value.agentKey;

    const reg2 = await db.register("broadcast-receiver");
    if (!reg2.ok) { throw new Error("expected ok"); }
    receiverName = reg2.value.agentName;
    receiverKey = reg2.value.agentKey;

    const reg3 = await db.register("broadcast-third");
    if (!reg3.ok) { throw new Error("expected ok"); }
    thirdAgentName = reg3.value.agentName;
    thirdAgentKey = reg3.value.agentKey;
  });

  afterEach(() => {
    db?.close();
    deleteIfExists(TEST_DB_PATH);
  });

  const makeSenderSession = (): (() => SessionIdentity) =>
    () => ({ agentName: senderName, agentKey: senderKey });

  const makeReceiverSession = (): (() => SessionIdentity) =>
    () => ({ agentName: receiverName, agentKey: receiverKey });

  const makeThirdSession = (): (() => SessionIdentity) =>
    () => ({ agentName: thirdAgentName, agentKey: thirdAgentKey });

  it("mark_read succeeds on a broadcast message", async () => {
    if (!db) { throw new Error("expected db"); }

    // Sender broadcasts a message
    const senderHandler = createMessageHandler(db, createTestEmitter(), createTestLogger(), makeSenderSession());
    const sendResult = await senderHandler({ action: "send", to_agent: "*", content: "broadcast announcement" }, {});
    assert.strictEqual(sendResult.isError, false);
    const sendParsed = JSON.parse(sendResult.content[0].text) as Record<string, unknown>;
    const broadcastId = sendParsed.message_id as string;

    // Receiver fetches messages — should see the broadcast
    const receiverHandler = createMessageHandler(db, createTestEmitter(), createTestLogger(), makeReceiverSession());
    const getResult1 = await receiverHandler({ action: "get" }, {});
    assert.strictEqual(getResult1.isError, false);
    const getParsed1 = JSON.parse(getResult1.content[0].text) as Record<string, unknown>;
    const messages1 = getParsed1.messages as Record<string, unknown>[];
    assert.ok(messages1.some((m) => m.id === broadcastId), "broadcast should appear in get");

    // Receiver marks the broadcast as read — THIS IS THE BUG: returns NOT_FOUND
    const markResult = await receiverHandler({ action: "mark_read", message_id: broadcastId }, {});
    assert.strictEqual(markResult.isError, false, "mark_read on broadcast must succeed, not return NOT_FOUND");
    const markParsed = JSON.parse(markResult.content[0].text) as Record<string, unknown>;
    assert.strictEqual(markParsed.marked, true);
  });

  it("broadcast disappears from inbox after mark_read", async () => {
    if (!db) { throw new Error("expected db"); }

    // Sender broadcasts
    const senderHandler = createMessageHandler(db, createTestEmitter(), createTestLogger(), makeSenderSession());
    const sendResult = await senderHandler({ action: "send", to_agent: "*", content: "ephemeral broadcast" }, {});
    const sendParsed = JSON.parse(sendResult.content[0].text) as Record<string, unknown>;
    const broadcastId = sendParsed.message_id as string;

    // Receiver gets messages (first fetch)
    const receiverHandler = createMessageHandler(db, createTestEmitter(), createTestLogger(), makeReceiverSession());
    const getResult1 = await receiverHandler({ action: "get" }, {});
    const parsed1 = JSON.parse(getResult1.content[0].text) as Record<string, unknown>;
    const msgs1 = parsed1.messages as Record<string, unknown>[];
    assert.ok(msgs1.some((m) => m.id === broadcastId), "broadcast visible on first get");

    // Receiver marks broadcast as read
    await receiverHandler({ action: "mark_read", message_id: broadcastId }, {});

    // Receiver gets messages again with unread_only (default) — broadcast must NOT reappear
    const getResult2 = await receiverHandler({ action: "get" }, {});
    const parsed2 = JSON.parse(getResult2.content[0].text) as Record<string, unknown>;
    const msgs2 = parsed2.messages as Record<string, unknown>[];
    assert.ok(
      !msgs2.some((m) => m.id === broadcastId),
      "broadcast must not reappear after mark_read",
    );
  });

  it("broadcast read by one agent is still unread for another", async () => {
    if (!db) { throw new Error("expected db"); }

    // Sender broadcasts
    const senderHandler = createMessageHandler(db, createTestEmitter(), createTestLogger(), makeSenderSession());
    const sendResult = await senderHandler({ action: "send", to_agent: "*", content: "multi-reader broadcast" }, {});
    const sendParsed = JSON.parse(sendResult.content[0].text) as Record<string, unknown>;
    const broadcastId = sendParsed.message_id as string;

    // Receiver marks it as read
    const receiverHandler = createMessageHandler(db, createTestEmitter(), createTestLogger(), makeReceiverSession());
    await receiverHandler({ action: "get" }, {});
    await receiverHandler({ action: "mark_read", message_id: broadcastId }, {});

    // Third agent should STILL see it as unread
    const thirdHandler = createMessageHandler(db, createTestEmitter(), createTestLogger(), makeThirdSession());
    const getResult = await thirdHandler({ action: "get" }, {});
    const parsed = JSON.parse(getResult.content[0].text) as Record<string, unknown>;
    const msgs = parsed.messages as Record<string, unknown>[];
    assert.ok(
      msgs.some((m) => m.id === broadcastId),
      "broadcast must still be visible to agents who haven't read it",
    );
  });

  it("auto-mark-read on get prevents broadcast from reappearing", async () => {
    if (!db) { throw new Error("expected db"); }

    // Sender broadcasts
    const senderHandler = createMessageHandler(db, createTestEmitter(), createTestLogger(), makeSenderSession());
    await senderHandler({ action: "send", to_agent: "*", content: "auto-read broadcast" }, {});

    // Receiver fetches messages (auto-marks as read)
    const receiverHandler = createMessageHandler(db, createTestEmitter(), createTestLogger(), makeReceiverSession());
    const getResult1 = await receiverHandler({ action: "get" }, {});
    const parsed1 = JSON.parse(getResult1.content[0].text) as Record<string, unknown>;
    const msgs1 = parsed1.messages as Record<string, unknown>[];
    assert.strictEqual(msgs1.length, 1, "first get should return the broadcast");

    // Second get with unread_only should return nothing
    const getResult2 = await receiverHandler({ action: "get" }, {});
    const parsed2 = JSON.parse(getResult2.content[0].text) as Record<string, unknown>;
    const msgs2 = parsed2.messages as Record<string, unknown>[];
    assert.strictEqual(msgs2.length, 0, "second get should return no messages after auto-mark-read");
  });
});
