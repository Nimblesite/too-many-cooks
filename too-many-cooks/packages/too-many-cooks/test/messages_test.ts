/// Tests for inter-agent messaging.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import {
  type TooManyCooksDb,
  ERR_UNAUTHORIZED,
  ERR_VALIDATION,
  ERR_NOT_FOUND,
} from "too-many-cooks-core";
import {
  freshTestDb,
  registerAgentPair,
  requireDb,
  teardownTestDb,
} from "./support/db_fixture.js";
import {
  assertNonNullish,
  expectErr,
  expectOk,
} from "./support/assertions.js";

const TEST_DB_PATH = ".test_messages.db";

describe("messages", () => {
  let db: TooManyCooksDb | undefined;
  let senderName = "";
  let senderKey = "";
  let receiverName = "";
  let receiverKey = "";

  beforeEach(async () => {
    const fixture = freshTestDb(TEST_DB_PATH);
    db = fixture.db;

    // Register sender and receiver
    const [sender, receiver] = await registerAgentPair(db, "sender-agent", "receiver-agent");
    senderName = sender.agentName;
    senderKey = sender.agentKey;
    receiverName = receiver.agentName;
    receiverKey = receiver.agentKey;
  });

  afterEach(async () => {
    await teardownTestDb(db, TEST_DB_PATH);
  });

  it("sendMessage creates message with ID", async () => {
    const d = requireDb(db);
    const messageId = expectOk(
      await d.sendMessage(senderName, senderKey, receiverName, "Hello!"),
      "send must be ok",
    );
    assert.strictEqual(messageId.length, 16);
  });

  it("sendMessage fails with invalid credentials", async () => {
    const d = requireDb(db);
    const error = expectErr(
      await d.sendMessage(senderName, "wrong-key", receiverName, "Hello!"),
      "send must fail",
    );
    assert.strictEqual(error.code, ERR_UNAUTHORIZED);
  });

  it("sendMessage fails for content exceeding max length", async () => {
    const d = requireDb(db);
    const longContent = "x".repeat(201); // Default max is 200
    const error = expectErr(
      await d.sendMessage(senderName, senderKey, receiverName, longContent),
      "send must fail",
    );
    assert.strictEqual(error.code, ERR_VALIDATION);
    assert.ok(error.message.includes("200"));
  });

  it("getMessages returns messages for agent", async () => {
    const d = requireDb(db);
    await d.sendMessage(senderName, senderKey, receiverName, "Message 1");
    await d.sendMessage(senderName, senderKey, receiverName, "Message 2");

    const messages = expectOk(
      await d.getMessages(receiverName, receiverKey),
      "get must be ok",
    );
    assert.strictEqual(messages.length, 2);
    assert.deepStrictEqual(
      new Set(messages.map((m) => m.content)),
      new Set(["Message 1", "Message 2"]),
    );
  });

  it("getMessages auto-marks messages as read", async () => {
    const d = requireDb(db);
    await d.sendMessage(senderName, senderKey, receiverName, "Test message");

    // First fetch marks as read
    await d.getMessages(receiverName, receiverKey);

    // Second fetch with unreadOnly=true should return empty
    const messages = expectOk(
      await d.getMessages(receiverName, receiverKey, { unreadOnly: true }),
      "get must be ok",
    );
    assert.strictEqual(messages.length, 0);
  });

  it("getMessages with unreadOnly=false returns all messages", async () => {
    const d = requireDb(db);
    await d.sendMessage(senderName, senderKey, receiverName, "Test message");

    // First fetch marks as read
    await d.getMessages(receiverName, receiverKey);

    // Second fetch with unreadOnly=false should still return message
    const messages = expectOk(
      await d.getMessages(receiverName, receiverKey, { unreadOnly: false }),
      "get must be ok",
    );
    assert.strictEqual(messages.length, 1);
  });

  it("getMessages fails with invalid credentials", async () => {
    const d = requireDb(db);
    const error = expectErr(
      await d.getMessages(receiverName, "wrong-key"),
      "get must fail",
    );
    assert.strictEqual(error.code, ERR_UNAUTHORIZED);
  });

  it("markRead marks specific message", async () => {
    const d = requireDb(db);
    const messageId = expectOk(
      await d.sendMessage(senderName, senderKey, receiverName, "To be read"),
      "send must be ok",
    );

    const result = await d.markRead(messageId, receiverName, receiverKey);
    assert.strictEqual(result.ok, true);
  });

  it("markRead fails for nonexistent message", async () => {
    const d = requireDb(db);
    const error = expectErr(
      await d.markRead("nonexistent-id", receiverName, receiverKey),
      "mark must fail",
    );
    assert.strictEqual(error.code, ERR_NOT_FOUND);
  });

  it("broadcast message reaches all agents", async () => {
    const d = requireDb(db);
    // Send broadcast (to_agent = '*' is broadcast)
    await d.sendMessage(senderName, senderKey, "*", "Announcement!");

    // Receiver should get broadcast messages
    const messages = expectOk(
      await d.getMessages(receiverName, receiverKey),
      "get must be ok",
    );
    assert.strictEqual(messages.some((m) => m.content === "Announcement!"), true);
  });

  it("listAllMessages returns all messages", async () => {
    const d = requireDb(db);
    await d.sendMessage(senderName, senderKey, receiverName, "Direct message");
    await d.sendMessage(senderName, senderKey, "*", "Broadcast");

    const messages = expectOk(await d.listAllMessages(), "list must be ok");
    assert.strictEqual(messages.length, 2);
  });

  it("message contains correct metadata", async () => {
    const d = requireDb(db);
    await d.sendMessage(senderName, senderKey, receiverName, "Test");

    const messages = expectOk(
      await d.getMessages(receiverName, receiverKey),
      "get must be ok",
    );
    const msg = assertNonNullish(messages[0], "inbox should hold the sent message");

    assert.strictEqual(msg.fromAgent, senderName);
    assert.strictEqual(msg.toAgent, receiverName);
    assert.strictEqual(msg.content, "Test");
    assert.ok(msg.createdAt > 0);
    assert.strictEqual(msg.id.length, 16);
  });
});
