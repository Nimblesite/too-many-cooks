/// Message send and read contract tests.

import { it } from "node:test";
import assert from "node:assert/strict";

import type { Message } from "../types.gen.js";
import {
  BROADCAST_RECIPIENT,
  EXPECTED_MESSAGE_ID_LENGTH,
  assertError,
  assertOk,
  cleanupState,
  describeSuite,
  expectReceiverMessageCount,
  fetchReceiverMessages,
  messageSetup,
  registerAgent,
  sendFromSender,
  sendToReceiver,
  unwrap,
} from "./setup.test.js";
import type { DbFactory, GetMessagesOptions, MessageState } from "./setup.test.js";

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
    const state: MessageState = getState();
    const msgId: string = await sendToReceiver(state, "hello");
    assert.strictEqual(msgId.length, EXPECTED_MESSAGE_ID_LENGTH);

    const msgs: readonly Message[] = await expectReceiverMessageCount(state, { unreadOnly: true }, 1);
    const [firstMsg]: readonly Message[] = msgs;
    if (firstMsg === undefined) { throw new Error("Expected first message"); }
    assert.strictEqual(firstMsg.content, "hello");
    assert.strictEqual(firstMsg.fromAgent, state.senderName);
  });

  it("send fails with invalid credentials", async (): Promise<void> => {
    const state: MessageState = getState();
    assertError(await state.inst.db.sendMessage(state.senderName, "wrong", state.receiverName, "hi"), "UNAUTHORIZED");
  });

  it("broadcast message reaches other agents", async (): Promise<void> => {
    const state: MessageState = getState();
    const reg3 = await registerAgent(state.inst, "agent3");
    await sendFromSender(state, BROADCAST_RECIPIENT, "announcement");

    const msgs2: readonly Message[] = await fetchReceiverMessages(state);
    const msgs3: readonly Message[] = unwrap(await state.inst.db.getMessages(reg3.agentName, reg3.agentKey));
    assert.ok(msgs2.some((msg: Message): boolean => {return msg.content === "announcement"}));
    assert.ok(msgs3.some((msg: Message): boolean => {return msg.content === "announcement"}));
  });

  it("listAllMessages returns all messages", async (): Promise<void> => {
    const state: MessageState = getState();
    await sendToReceiver(state, "direct");
    await sendFromSender(state, BROADCAST_RECIPIENT, "broadcast");
    const all: readonly Message[] = unwrap(await state.inst.db.listAllMessages());
    assert.strictEqual(all.length, 2);
  });

  it("message contains correct metadata", async (): Promise<void> => {
    const state: MessageState = getState();
    await sendToReceiver(state, "test");
    const msgs: readonly Message[] = await fetchReceiverMessages(state);
    const [msg]: readonly Message[] = msgs;
    if (!msg) { throw new Error("Expected message"); }
    assert.strictEqual(msg.fromAgent, state.senderName);
    assert.strictEqual(msg.toAgent, state.receiverName);
    assert.strictEqual(msg.content, "test");
    assert.ok(msg.createdAt > 0);
    assert.strictEqual(msg.id.length, EXPECTED_MESSAGE_ID_LENGTH);
  });
};

/** Register message read contract tests. */
const registerMessageReadTests = (getState: () => MessageState): void => {
  // Both cases re-read the inbox after the FIRST fetch already marked it read.
  const RE_READ_CASES: ReadonlyArray<{
    readonly name: string;
    readonly options: GetMessagesOptions;
    readonly expected: number;
  }> = [
    { name: "getMessages auto-marks as read", options: { unreadOnly: true }, expected: 0 },
    { name: "getMessages unreadOnly=false returns all messages", options: { unreadOnly: false }, expected: 1 },
  ];

  for (const testCase of RE_READ_CASES) {
    it(testCase.name, async (): Promise<void> => {
      const state: MessageState = getState();
      await sendToReceiver(state, "test");
      await fetchReceiverMessages(state); // Marks read

      await expectReceiverMessageCount(state, testCase.options, testCase.expected);
    });
  }

  it("mark message as read", async (): Promise<void> => {
    const state: MessageState = getState();
    const msgId: string = await sendToReceiver(state, "hi");
    assertOk(await state.inst.db.markRead(msgId, state.receiverName, state.receiverKey));

    await expectReceiverMessageCount(state, { unreadOnly: true }, 0);
  });

  it("markRead fails for nonexistent message", async (): Promise<void> => {
    const state: MessageState = getState();
    assertError(await state.inst.db.markRead("nonexistent-id", state.receiverName, state.receiverKey), "NOT_FOUND");
  });
};
