/// [MSG-PRIVACY] Issue #11: the `status` tool must NOT leak direct messages
/// addressed to other agents. An agent calling `status` may only see
/// broadcasts (to_agent = "*") plus its own inbox/sent messages.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import {
  type TooManyCooksDb,
  createDataConfig,
  createLoggerWithContext,
  createLoggingContext,
  createStatusHandler,
} from "too-many-cooks-core";
import { createDb } from "../src/db-sqlite.js";

const TEST_DB_PATH = ".test_status_message_privacy.db";
const BROADCAST = "*";

const deleteIfExists = (filePath: string): void => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // Ignore
  }
};

const createTestLogger = () =>
  createLoggerWithContext(createLoggingContext());

type StatusMessage = {
  readonly content: string;
};

const statusMessagesFor = async (
  db: TooManyCooksDb,
  agentKey: string,
): Promise<readonly StatusMessage[]> => {
  const handler = createStatusHandler(db, createTestLogger());
  const result = await handler({ agent_key: agentKey }, {});
  assert.strictEqual(result.isError, false, "status must not error");
  const parsed = JSON.parse(result.content[0].text) as { readonly messages: readonly StatusMessage[] };
  return parsed.messages;
};

describe("status tool message privacy (#11)", () => {
  let db: TooManyCooksDb | undefined;

  beforeEach(() => {
    deleteIfExists(TEST_DB_PATH);
    const config = createDataConfig({ dbPath: TEST_DB_PATH });
    const result = createDb(config);
    assert.strictEqual(result.ok, true);
    if (!result.ok) { throw new Error("expected ok db"); }
    db = result.value;
  });

  afterEach(() => {
    db?.close();
    deleteIfExists(TEST_DB_PATH);
  });

  it("does not expose a direct message between two other agents to a third agent", async () => {
    if (!db) { throw new Error("expected db"); }
    const alice = await db.register("privacy-alice");
    const bob = await db.register("privacy-bob");
    const carol = await db.register("privacy-carol");
    if (!alice.ok || !bob.ok || !carol.ok) { throw new Error("expected registrations ok"); }

    const secret = "secret-for-bob-only";
    const sent = await db.sendMessage(alice.value.agentName, alice.value.agentKey, bob.value.agentName, secret);
    assert.strictEqual(sent.ok, true, "direct send must succeed");

    const carolMessages = await statusMessagesFor(db, carol.value.agentKey);
    assert.strictEqual(
      carolMessages.some((m) => m.content === secret),
      false,
      "Carol must NOT see a direct message addressed to Bob",
    );
  });

  it("still shows the recipient their own direct message and broadcasts to everyone", async () => {
    if (!db) { throw new Error("expected db"); }
    const alice = await db.register("privacy-alice2");
    const bob = await db.register("privacy-bob2");
    const carol = await db.register("privacy-carol2");
    if (!alice.ok || !bob.ok || !carol.ok) { throw new Error("expected registrations ok"); }

    const direct = "direct-to-bob";
    const broadcast = "hello-everyone";
    await db.sendMessage(alice.value.agentName, alice.value.agentKey, bob.value.agentName, direct);
    await db.sendMessage(alice.value.agentName, alice.value.agentKey, BROADCAST, broadcast);

    const bobMessages = await statusMessagesFor(db, bob.value.agentKey);
    assert.strictEqual(bobMessages.some((m) => m.content === direct), true, "Bob must see his own direct message");
    assert.strictEqual(bobMessages.some((m) => m.content === broadcast), true, "Bob must see the broadcast");

    const carolMessages = await statusMessagesFor(db, carol.value.agentKey);
    assert.strictEqual(carolMessages.some((m) => m.content === direct), false, "Carol must NOT see Bob's direct message");
    assert.strictEqual(carolMessages.some((m) => m.content === broadcast), true, "Carol must see the broadcast");
  });
});
