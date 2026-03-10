/// Tests for inter-agent messaging.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import {
  type TooManyCooksDb,
  createDataConfig,
  createDb,
  ERR_UNAUTHORIZED,
  ERR_VALIDATION,
  ERR_NOT_FOUND,
} from "../lib/src/data/data.js";

const TEST_DB_PATH = ".test_messages.db";

const deleteIfExists = (path: string): void => {
  try {
    if (fs.existsSync(path)) {
      fs.unlinkSync(path);
    }
  } catch {
    // ignore
  }
};

describe("messages", () => {
  let db: TooManyCooksDb | undefined;
  let senderName = "";
  let senderKey = "";
  let receiverName = "";
  let receiverKey = "";

  beforeEach(() => {
    deleteIfExists(TEST_DB_PATH);
    const config = createDataConfig({ dbPath: TEST_DB_PATH });
    const result = createDb(config);
    assert.strictEqual(result.ok, true);
    if (!result.ok) {throw new Error("expected ok");}
    db = result.value;

    // Register sender
    const senderReg = db.register("sender-agent");
    if (!senderReg.ok) {throw new Error("expected ok");}
    const sender = senderReg.value;
    senderName = sender.agentName;
    senderKey = sender.agentKey;

    // Register receiver
    const receiverReg = db.register("receiver-agent");
    if (!receiverReg.ok) {throw new Error("expected ok");}
    const receiver = receiverReg.value;
    receiverName = receiver.agentName;
    receiverKey = receiver.agentKey;
  });

  afterEach(() => {
    db?.close();
    deleteIfExists(TEST_DB_PATH);
  });

  it("sendMessage creates message with ID", () => {
    assert.notStrictEqual(db, undefined);
    if (!db) {throw new Error("expected db");}
    const result = db.sendMessage(
      senderName,
      senderKey,
      receiverName,
      "Hello!",
    );
    assert.strictEqual(result.ok, true);
    if (!result.ok) {throw new Error("expected ok");}
    const messageId = result.value;
    assert.strictEqual(messageId.length, 16);
  });

  it("sendMessage fails with invalid credentials", () => {
    assert.notStrictEqual(db, undefined);
    if (!db) {throw new Error("expected db");}
    const result = db.sendMessage(
      senderName,
      "wrong-key",
      receiverName,
      "Hello!",
    );
    assert.strictEqual(result.ok, false);
    if (result.ok) {throw new Error("expected error");}
    assert.strictEqual(result.error.code, ERR_UNAUTHORIZED);
  });

  it("sendMessage fails for content exceeding max length", () => {
    assert.notStrictEqual(db, undefined);
    if (!db) {throw new Error("expected db");}
    const longContent = "x".repeat(201); // Default max is 200
    const result = db.sendMessage(
      senderName,
      senderKey,
      receiverName,
      longContent,
    );
    assert.strictEqual(result.ok, false);
    if (result.ok) {throw new Error("expected error");}
    assert.strictEqual(result.error.code, ERR_VALIDATION);
    assert.ok(result.error.message.includes("200"));
  });

  it("getMessages returns messages for agent", () => {
    assert.notStrictEqual(db, undefined);
    if (!db) {throw new Error("expected db");}
    db.sendMessage(senderName, senderKey, receiverName, "Message 1");
    db.sendMessage(senderName, senderKey, receiverName, "Message 2");

    const result = db.getMessages(receiverName, receiverKey);
    assert.strictEqual(result.ok, true);
    if (!result.ok) {throw new Error("expected ok");}
    const messages = result.value;
    assert.strictEqual(messages.length, 2);
    assert.deepStrictEqual(
      new Set(messages.map((m) => m.content)),
      new Set(["Message 1", "Message 2"]),
    );
  });

  it("getMessages auto-marks messages as read", () => {
    assert.notStrictEqual(db, undefined);
    if (!db) {throw new Error("expected db");}
    db.sendMessage(senderName, senderKey, receiverName, "Test message");

    // First fetch marks as read
    db.getMessages(receiverName, receiverKey);

    // Second fetch with unreadOnly=true should return empty
    const result = db.getMessages(receiverName, receiverKey, { unreadOnly: true });
    if (!result.ok) {throw new Error("expected ok");}
    const messages = result.value;
    assert.strictEqual(messages.length, 0);
  });

  it("getMessages with unreadOnly=false returns all messages", () => {
    assert.notStrictEqual(db, undefined);
    if (!db) {throw new Error("expected db");}
    db.sendMessage(senderName, senderKey, receiverName, "Test message");

    // First fetch marks as read
    db.getMessages(receiverName, receiverKey);

    // Second fetch with unreadOnly=false should still return message
    const result = db.getMessages(
      receiverName,
      receiverKey,
      { unreadOnly: false },
    );
    if (!result.ok) {throw new Error("expected ok");}
    const messages = result.value;
    assert.strictEqual(messages.length, 1);
  });

  it("getMessages fails with invalid credentials", () => {
    assert.notStrictEqual(db, undefined);
    if (!db) {throw new Error("expected db");}
    const result = db.getMessages(receiverName, "wrong-key");
    assert.strictEqual(result.ok, false);
    if (result.ok) {throw new Error("expected error");}
    assert.strictEqual(result.error.code, ERR_UNAUTHORIZED);
  });

  it("markRead marks specific message", () => {
    assert.notStrictEqual(db, undefined);
    if (!db) {throw new Error("expected db");}
    const sendResult = db.sendMessage(
      senderName,
      senderKey,
      receiverName,
      "To be read",
    );
    if (!sendResult.ok) {throw new Error("expected ok");}
    const messageId = sendResult.value;

    const result = db.markRead(messageId, receiverName, receiverKey);
    assert.strictEqual(result.ok, true);
  });

  it("markRead fails for nonexistent message", () => {
    assert.notStrictEqual(db, undefined);
    if (!db) {throw new Error("expected db");}
    const result = db.markRead("nonexistent-id", receiverName, receiverKey);
    assert.strictEqual(result.ok, false);
    if (result.ok) {throw new Error("expected error");}
    assert.strictEqual(result.error.code, ERR_NOT_FOUND);
  });

  it("broadcast message reaches all agents", () => {
    assert.notStrictEqual(db, undefined);
    if (!db) {throw new Error("expected db");}
    // Send broadcast (to_agent = '*' is broadcast)
    db.sendMessage(senderName, senderKey, "*", "Announcement!");

    // Receiver should get broadcast messages
    const result = db.getMessages(receiverName, receiverKey);
    if (!result.ok) {throw new Error("expected ok");}
    const messages = result.value;
    assert.strictEqual(messages.some((m) => m.content === "Announcement!"), true);
  });

  it("listAllMessages returns all messages", () => {
    assert.notStrictEqual(db, undefined);
    if (!db) {throw new Error("expected db");}
    db.sendMessage(senderName, senderKey, receiverName, "Direct message");
    db.sendMessage(senderName, senderKey, "*", "Broadcast");

    const result = db.listAllMessages();
    assert.strictEqual(result.ok, true);
    if (!result.ok) {throw new Error("expected ok");}
    const messages = result.value;
    assert.strictEqual(messages.length, 2);
  });

  it("message contains correct metadata", () => {
    assert.notStrictEqual(db, undefined);
    if (!db) {throw new Error("expected db");}
    db.sendMessage(senderName, senderKey, receiverName, "Test");

    const result = db.getMessages(receiverName, receiverKey);
    if (!result.ok) {throw new Error("expected ok");}
    const messages = result.value;
    const msg = messages[0]!;

    assert.strictEqual(msg.fromAgent, senderName);
    assert.strictEqual(msg.toAgent, receiverName);
    assert.strictEqual(msg.content, "Test");
    assert.ok(msg.createdAt > 0);
    assert.strictEqual(msg.id.length, 16);
  });
});
