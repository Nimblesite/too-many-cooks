/// [STATUS-BOUNDED] Issues #41/#42: the `status` tool must be an overview, not a
/// message dump. Its payload size must be bounded by a constant regardless of how
/// many messages exist, it must never embed full message bodies, and by default an
/// agent must only see its own unread inbox (own + unread) — never read messages,
/// never another agent's direct messages.

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

const TEST_DB_PATH = ".test_status_bounded_payload.db";
const SEEDED_MESSAGES = 100;
const PAYLOAD_CEILING_CHARS = 8000;
const RECENT_HEADER_CEILING = 25;

const deleteIfExists = (filePath: string): void => {
  try {
    if (fs.existsSync(filePath)) { fs.unlinkSync(filePath); }
  } catch {
    // Ignore
  }
};

const createTestLogger = () =>
  createLoggerWithContext(createLoggingContext());

type MessagesOverview = {
  readonly total: number;
  readonly unread: number;
  readonly recent: ReadonlyArray<Record<string, unknown>>;
};

describe("status tool bounded payload (#41/#42)", () => {
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

  it("bounds payload, drops bodies, and reports counts even with a large message history", async () => {
    if (!db) { throw new Error("expected db"); }
    const conn: TooManyCooksDb = db;
    const sender = await conn.register("bounded-sender");
    const reader = await conn.register("bounded-reader");
    if (!sender.ok || !reader.ok) { throw new Error("expected registrations ok"); }

    // 100 long-bodied messages from sender -> reader. Full bodies would blow the payload.
    const longBody = "x".repeat(150);
    for (let i = 0; i < SEEDED_MESSAGES; i += 1) {
      const sent = await conn.sendMessage(
        sender.value.agentName, sender.value.agentKey, reader.value.agentName, longBody,
      );
      assert.strictEqual(sent.ok, true, "seed send must succeed");
    }

    const handler = createStatusHandler(conn, createTestLogger());
    const result = await handler({ agent_key: reader.value.agentKey }, {});
    assert.strictEqual(result.isError, false, "status must not error");

    const rawText: string = result.content[0].text;
    assert.ok(
      rawText.length < PAYLOAD_CEILING_CHARS,
      `status payload must stay under ${String(PAYLOAD_CEILING_CHARS)} chars regardless of history, got ${String(rawText.length)}`,
    );

    const parsed = JSON.parse(rawText) as { readonly messages: MessagesOverview };
    const messages: MessagesOverview = parsed.messages;
    assert.strictEqual(typeof messages, "object", "messages must be an overview object, not a flat array");
    assert.strictEqual(Array.isArray(messages), false, "messages must NOT be a flat array of every row");
    assert.strictEqual(messages.total, SEEDED_MESSAGES, "messages.total must report the full count");
    assert.strictEqual(messages.unread, SEEDED_MESSAGES, "every seeded message is unread for the reader");
    assert.ok(
      messages.recent.length <= RECENT_HEADER_CEILING,
      `recent header slice must be bounded, got ${String(messages.recent.length)}`,
    );
    assert.ok(messages.recent.length > 0, "recent must contain at least one header");

    for (const header of messages.recent) {
      assert.strictEqual(
        "content" in header,
        false,
        "status headers must NEVER include the full message body",
      );
      assert.strictEqual(header.to_agent, reader.value.agentName, "recent must be the caller's own inbox only");
    }
  });

  it("recent excludes already-read messages and other agents' direct messages", async () => {
    if (!db) { throw new Error("expected db"); }
    const conn: TooManyCooksDb = db;
    const alice = await conn.register("bounded-alice");
    const bob = await conn.register("bounded-bob");
    const carol = await conn.register("bounded-carol");
    if (!alice.ok || !bob.ok || !carol.ok) { throw new Error("expected registrations ok"); }

    // Alice -> Bob (direct). Carol must never see it.
    const toBob = await conn.sendMessage(alice.value.agentName, alice.value.agentKey, bob.value.agentName, "for-bob");
    assert.strictEqual(toBob.ok, true);
    // Alice -> Carol, then Carol reads it: must drop out of Carol's unread recent.
    const toCarol = await conn.sendMessage(alice.value.agentName, alice.value.agentKey, carol.value.agentName, "for-carol");
    assert.strictEqual(toCarol.ok, true);
    if (!toCarol.ok) { throw new Error("expected msg id"); }
    const marked = await conn.markRead(toCarol.value, carol.value.agentName, carol.value.agentKey);
    assert.strictEqual(marked.ok, true, "mark read must succeed");

    const handler = createStatusHandler(conn, createTestLogger());
    const result = await handler({ agent_key: carol.value.agentKey }, {});
    assert.strictEqual(result.isError, false);
    const parsed = JSON.parse(result.content[0].text) as { readonly messages: MessagesOverview };

    assert.strictEqual(parsed.messages.unread, 0, "Carol has no unread messages after reading hers");
    assert.strictEqual(
      parsed.messages.recent.length,
      0,
      "Carol's recent must be empty: her only message is read, Bob's is not hers",
    );
  });
});
