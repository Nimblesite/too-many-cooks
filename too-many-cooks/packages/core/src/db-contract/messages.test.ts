/// Message send and read contract tests.

import { it } from "node:test";
import assert from "node:assert/strict";

import type { TooManyCooksDb } from "../db-interface.js";
import type { AgentRegistration, Message } from "../types.gen.js";
import {
  BROADCAST_RECIPIENT,
  EXPECTED_MESSAGE_ID_LENGTH,
  assertError,
  cleanupState,
  describeSuite,
  messageSetup,
  unwrap,
} from "./setup.test.js";
import type { DbFactory, MessageState } from "./setup.test.js";

/** Run message contract tests. */
export const runMessageTests = (createTestDb: DbFactory): void => {
  describeSuite(createTestDb, "TooManyCooksDb contract: messages", messageSetup, cleanupState, (getState: () => MessageState): void => {
    registerMessageSendTests(getState);
    registerMessageReadTests(getState);
  });
};

/** Register message send contract tests. */
const registerMessageSendTests = (getState: () => MessageState): void => {
  it("send and receive message", async (): Promise<void> => {
    const { inst, senderName, senderKey, receiverName, receiverKey } = getState();
    const msgId: string = unwrap(await inst.db.sendMessage(senderName, senderKey, receiverName, "hello"));
    assert.strictEqual(msgId.length, EXPECTED_MESSAGE_ID_LENGTH);

    const msgs: readonly Message[] = unwrap(await inst.db.getMessages(receiverName, receiverKey, { unreadOnly: true }));
    assert.strictEqual(msgs.length, 1);
    const [firstMsg]: readonly Message[] = msgs;
    if (firstMsg === undefined) { throw new Error("Expected first message"); }
    assert.strictEqual(firstMsg.content, "hello");
    assert.strictEqual(firstMsg.fromAgent, senderName);
  });

  it("send fails with invalid credentials", async (): Promise<void> => {
    const { inst, senderName, receiverName } = getState();
    assertError(await inst.db.sendMessage(senderName, "wrong", receiverName, "hi"), "UNAUTHORIZED");
  });

  it("broadcast message reaches other agents", async (): Promise<void> => {
    const { inst, senderName, senderKey, receiverName, receiverKey } = getState();
    const reg3: AgentRegistration = unwrap(await inst.db.register("agent3"));
    unwrap(await inst.db.sendMessage(senderName, senderKey, BROADCAST_RECIPIENT, "announcement"));

    const msgs2: readonly Message[] = unwrap(await inst.db.getMessages(receiverName, receiverKey));
    const msgs3: readonly Message[] = unwrap(await inst.db.getMessages(reg3.agentName, reg3.agentKey));
    assert.ok(msgs2.some((msg: Message): boolean => {return msg.content === "announcement"}));
    assert.ok(msgs3.some((msg: Message): boolean => {return msg.content === "announcement"}));
  });

  it("listAllMessages returns all messages", async (): Promise<void> => {
    const { inst, senderName, senderKey, receiverName } = getState();
    unwrap(await inst.db.sendMessage(senderName, senderKey, receiverName, "direct"));
    unwrap(await inst.db.sendMessage(senderName, senderKey, BROADCAST_RECIPIENT, "broadcast"));
    const all: readonly Message[] = unwrap(await inst.db.listAllMessages());
    assert.strictEqual(all.length, 2);
  });

  it("message contains correct metadata", async (): Promise<void> => {
    const { inst, senderName, senderKey, receiverName, receiverKey } = getState();
    unwrap(await inst.db.sendMessage(senderName, senderKey, receiverName, "test"));
    const msgs: readonly Message[] = unwrap(await inst.db.getMessages(receiverName, receiverKey));
    const [msg]: readonly Message[] = msgs;
    if (!msg) { throw new Error("Expected message"); }
    assert.strictEqual(msg.fromAgent, senderName);
    assert.strictEqual(msg.toAgent, receiverName);
    assert.strictEqual(msg.content, "test");
    assert.ok(msg.createdAt > 0);
    assert.strictEqual(msg.id.length, EXPECTED_MESSAGE_ID_LENGTH);
  });
};

/** Register message read contract tests. */
const registerMessageReadTests = (getState: () => MessageState): void => {
  it("getMessages auto-marks as read", async (): Promise<void> => {
    const { inst, senderName, senderKey, receiverName, receiverKey } = getState();
    unwrap(await inst.db.sendMessage(senderName, senderKey, receiverName, "test"));

    // First fetch auto-marks as read
    unwrap(await inst.db.getMessages(receiverName, receiverKey));

    // Second fetch with unreadOnly returns empty
    const unread: readonly Message[] = unwrap(await inst.db.getMessages(receiverName, receiverKey, { unreadOnly: true }));
    assert.strictEqual(unread.length, 0);
  });

  it("getMessages unreadOnly=false returns all messages", async (): Promise<void> => {
    const { inst, senderName, senderKey, receiverName, receiverKey } = getState();
    unwrap(await inst.db.sendMessage(senderName, senderKey, receiverName, "test"));
    unwrap(await inst.db.getMessages(receiverName, receiverKey)); // Marks read

    const all: readonly Message[] = unwrap(await inst.db.getMessages(receiverName, receiverKey, { unreadOnly: false }));
    assert.strictEqual(all.length, 1);
  });

  it("mark message as read", async (): Promise<void> => {
    const { inst, senderName, senderKey, receiverName, receiverKey } = getState();
    const msgId: string = unwrap(await inst.db.sendMessage(senderName, senderKey, receiverName, "hi"));
    const markResult: Awaited<ReturnType<TooManyCooksDb["markRead"]>> = await inst.db.markRead(msgId, receiverName, receiverKey);
    assert.strictEqual(markResult.ok, true);

    const unread: readonly Message[] = unwrap(await inst.db.getMessages(receiverName, receiverKey, { unreadOnly: true }));
    assert.strictEqual(unread.length, 0);
  });

  it("markRead fails for nonexistent message", async (): Promise<void> => {
    const { inst, receiverName, receiverKey } = getState();
    assertError(await inst.db.markRead("nonexistent-id", receiverName, receiverKey), "NOT_FOUND");
  });
};
