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
  assertFieldSetEquals,
  assertNonNullish,
  expectErr,
  expectOk,
} from "./support/assertions.js";

const TEST_DB_PATH = ".test_messages.db";
const SEEDED_CONTENT = "Test message";

/** One post-first-read case: the unreadOnly option and the inbox size it yields. */
type UnreadCase = {
  readonly name: string;
  readonly unreadOnly: boolean;
  readonly expected: number;
};

const UNREAD_CASES: readonly UnreadCase[] = [
  { name: "getMessages auto-marks messages as read", unreadOnly: true, expected: 0 },
  { name: "getMessages with unreadOnly=false returns all messages", unreadOnly: false, expected: 1 },
];

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
    assertFieldSetEquals(messages, (m) => m.content, ["Message 1", "Message 2"]);
  });

  /** Runs one post-first-read case against the bound agent's inbox. */
  const runUnreadCase = async (testCase: UnreadCase): Promise<void> => {
    const d = requireDb(db);
    await d.sendMessage(senderName, senderKey, receiverName, SEEDED_CONTENT);

    // First fetch marks as read
    await d.getMessages(receiverName, receiverKey);

    // A second fetch with the case's unreadOnly option returns exactly `expected`
    const messages = expectOk(
      await d.getMessages(receiverName, receiverKey, { unreadOnly: testCase.unreadOnly }),
      "get must be ok",
    );
    assert.strictEqual(messages.length, testCase.expected);
  };

  for (const testCase of UNREAD_CASES) {
    it(testCase.name, async () => {
      await runUnreadCase(testCase);
    });
  }

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
