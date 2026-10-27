/// E2E test: broadcast messages can be marked read and stop reappearing.
/// Regression test for https://github.com/Nimblesite/too-many-cooks/issues/7

import { describe, it } from "node:test";
import assert from "node:assert";
import type { CallToolResult, SessionGetter, ToolCallback } from "too-many-cooks-core";
import { bindAgentsDb } from "./support/db_fixture.js";
import {
  agentSession,
  messageHandlerFor,
  parseToolJson,
  sendBroadcast,
} from "./support/handlers.js";
import { getRecordArrayField } from "./support/json.js";

const TEST_DB_PATH = ".test_broadcast_mark_read.db";
const AGENT_LABELS: readonly string[] = [
  "broadcast-sender",
  "broadcast-receiver",
  "broadcast-third",
];
const SENDER = 0;
const RECEIVER = 1;
const THIRD = 2;

describe("broadcast mark_read bug (issue #7)", () => {
  const agentsDb = bindAgentsDb(TEST_DB_PATH, AGENT_LABELS);

  const sessionFor = (index: number): SessionGetter =>
    agentSession(agentsDb.agentAt(index));

  const senderHandler = (): ToolCallback =>
    messageHandlerFor(agentsDb.db(), sessionFor(SENDER));

  const receiverHandler = (): ToolCallback =>
    messageHandlerFor(agentsDb.db(), sessionFor(RECEIVER));

  /** Reads `handler`'s inbox, asserting the call succeeded. */
  const inboxOf = async (
    handler: ToolCallback,
  ): Promise<Array<Record<string, unknown>>> => {
    const result = await handler({ action: "get" }, {});
    assert.strictEqual(result.isError, false, "get must succeed");
    return getRecordArrayField(parseToolJson(result), "messages");
  };

  /** Marks `messageId` read through `handler`; asserts it succeeded. */
  const markReadVia = async (
    handler: ToolCallback,
    messageId: string,
  ): Promise<CallToolResult> => {
    const result = await handler({ action: "mark_read", message_id: messageId }, {});
    assert.strictEqual(result.isError, false, "mark_read must succeed");
    return result;
  };

  it("mark_read succeeds on a broadcast message", async () => {
    const broadcastId = await sendBroadcast(
      senderHandler(),
      "broadcast announcement",
    );

    const messages = await inboxOf(receiverHandler());
    assert.ok(messages.some((m) => m.id === broadcastId), "broadcast should appear in get");

    // THIS IS THE BUG: mark_read on a broadcast used to return NOT_FOUND
    const markResult = await markReadVia(receiverHandler(), broadcastId);
    assert.strictEqual(markResult.isError, false, "mark_read on broadcast must succeed, not return NOT_FOUND");
    assert.strictEqual(parseToolJson(markResult).marked, true);
  });

  it("broadcast disappears from inbox after mark_read", async () => {
    const broadcastId = await sendBroadcast(senderHandler(), "ephemeral broadcast");

    const firstInbox = await inboxOf(receiverHandler());
    assert.ok(firstInbox.some((m) => m.id === broadcastId), "broadcast visible on first get");

    await markReadVia(receiverHandler(), broadcastId);

    // unread_only (default) must NOT bring the read broadcast back
    const secondInbox = await inboxOf(receiverHandler());
    assert.ok(
      !secondInbox.some((m) => m.id === broadcastId),
      "broadcast must not reappear after mark_read",
    );
  });

  it("broadcast read by one agent is still unread for another", async () => {
    const broadcastId = await sendBroadcast(senderHandler(), "multi-reader broadcast");

    await inboxOf(receiverHandler());
    await markReadVia(receiverHandler(), broadcastId);

    const thirdHandler = messageHandlerFor(agentsDb.db(), sessionFor(THIRD));
    const thirdInbox = await inboxOf(thirdHandler);
    assert.ok(
      thirdInbox.some((m) => m.id === broadcastId),
      "broadcast must still be visible to agents who haven't read it",
    );
  });

  it("auto-mark-read on get prevents broadcast from reappearing", async () => {
    await sendBroadcast(senderHandler(), "auto-read broadcast");

    const firstInbox = await inboxOf(receiverHandler());
    assert.strictEqual(firstInbox.length, 1, "first get should return the broadcast");

    const secondInbox = await inboxOf(receiverHandler());
    assert.strictEqual(secondInbox.length, 0, "second get should return no messages after auto-mark-read");
  });
});
