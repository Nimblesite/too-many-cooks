/// Tests for message tool handler (direct import, not via spawned server).

import { describe, it } from "node:test";
import assert from "node:assert";
import type { SessionGetter, TooManyCooksDb } from "too-many-cooks-core";
import {
  type RegisteredAgent,
  bindAgentsDb,
} from "./support/db_fixture.js";
import {
  agentSession,
  messageHandlerFor,
  parseToolJson,
  runToolErr,
  runToolOk,
} from "./support/handlers.js";
import { assertDefined } from "./support/assertions.js";
import { getRecordArrayField, getStringField } from "./support/json.js";

const TEST_DB_PATH = ".test_message_handler.db";
const AGENT_LABELS: readonly string[] = ["msg-agent-1", "msg-agent-2"];
const SENDER = 0;
const RECIPIENT = 1;

/** One message-tool validation failure: the case name and its arguments. */
type MessageErrorCase = {
  readonly name: string;
  readonly args: () => Record<string, unknown>;
};

describe("message handler", () => {
  const agentsDb = bindAgentsDb(TEST_DB_PATH, AGENT_LABELS);

  const db = (): TooManyCooksDb => agentsDb.db();

  const agentAt = (index: number): RegisteredAgent => {
    const agent = agentsDb.agents()[index];
    assertDefined(agent, `agent ${String(index)}`);
    return agent;
  };

  const sessionFor = (index: number): SessionGetter => agentSession(agentAt(index));

  const unauthenticated = (): SessionGetter => () => null;

  const errorCases: readonly MessageErrorCase[] = [
    { name: "fails when action is missing", args: (): Record<string, unknown> => ({}) },
    {
      name: "fails with unknown action",
      args: (): Record<string, unknown> => ({ action: "invalid" }),
    },
    {
      name: "send fails without to_agent",
      args: (): Record<string, unknown> => ({ action: "send", content: "hello" }),
    },
    {
      name: "send fails without content",
      args: (): Record<string, unknown> => ({
        action: "send",
        to_agent: agentAt(RECIPIENT).agentName,
      }),
    },
    {
      name: "mark_read fails without message_id",
      args: (): Record<string, unknown> => ({ action: "mark_read" }),
    },
  ];

  it("send succeeds between agents", async () => {
    const parsed = await runToolOk(
      messageHandlerFor(db(), sessionFor(SENDER)),
      { action: "send", to_agent: agentAt(RECIPIENT).agentName, content: "hello" },
    );
    assert.strictEqual(parsed.sent, true);
    assert.strictEqual(typeof parsed.message_id, "string");
  });

  it("get returns messages for agent", async () => {
    const handler1 = messageHandlerFor(db(), sessionFor(SENDER));
    await handler1({ action: "send", to_agent: agentAt(RECIPIENT).agentName, content: "test msg" }, {});

    const parsed = await runToolOk(
      messageHandlerFor(db(), sessionFor(RECIPIENT)),
      { action: "get" },
    );
    assert.strictEqual(Array.isArray(parsed.messages), true);
    const messages = getRecordArrayField(parsed, "messages");
    assert.ok(messages.length > 0);
    const first = messages[0];
    assertDefined(first, "first inbox message");
    assert.strictEqual(first.content, "test msg");
  });

  it("get with unread_only false returns all", async () => {
    const handler1 = messageHandlerFor(db(), sessionFor(SENDER));
    await handler1({ action: "send", to_agent: agentAt(RECIPIENT).agentName, content: "msg1" }, {});

    const parsed = await runToolOk(
      messageHandlerFor(db(), sessionFor(RECIPIENT)),
      { action: "get", unread_only: false },
    );
    assert.strictEqual(Array.isArray(parsed.messages), true);
  });

  it("mark_read succeeds for valid message", async () => {
    const handler1 = messageHandlerFor(db(), sessionFor(SENDER));
    const sendResult = await handler1({ action: "send", to_agent: agentAt(RECIPIENT).agentName, content: "to mark" }, {});
    const messageId = getStringField(parseToolJson(sendResult), "message_id");

    const parsed = await runToolOk(
      messageHandlerFor(db(), sessionFor(RECIPIENT)),
      { action: "mark_read", message_id: messageId },
    );
    assert.strictEqual(parsed.marked, true);
  });

  for (const testCase of errorCases) {
    it(testCase.name, async () => {
      await runToolErr(messageHandlerFor(db(), sessionFor(SENDER)), testCase.args());
    });
  }

  it("fails when not registered and no session", async () => {
    await runToolErr(messageHandlerFor(db(), unauthenticated()), { action: "get" });
  });

  it("works with agent_key override", async () => {
    const parsed = await runToolOk(
      messageHandlerFor(db(), unauthenticated()),
      {
        action: "send",
        to_agent: agentAt(RECIPIENT).agentName,
        content: "via key",
        agent_key: agentAt(SENDER).agentKey,
      },
    );
    assert.strictEqual(parsed.sent, true);
  });
});
