/// [STATUS-BOUNDED] Issues #41/#42: the `status` tool must be an overview, not a
/// message dump. Its payload size must be bounded by a constant regardless of how
/// many messages exist, it must never embed full message bodies, and by default an
/// agent must only see its own unread inbox (own + unread) — never read messages,
/// never another agent's direct messages.

import { describe, it } from "node:test";
import assert from "node:assert";
import {
  type TooManyCooksDb,
  createStatusHandler,
} from "too-many-cooks-core";
import { bindTestDb, registerAgent } from "./support/db_fixture.js";
import {
  createTestLogger,
  firstTextBlock,
  statusOverviewFor,
} from "./support/handlers.js";
import {
  getNumberField,
  getRecordArrayField,
  getRecordField,
  parseJsonRecord,
} from "./support/json.js";

const TEST_DB_PATH = ".test_status_bounded_payload.db";
const SEEDED_MESSAGES = 100;
const PAYLOAD_CEILING_CHARS = 8000;
const RECENT_HEADER_CEILING = 25;

describe("status tool bounded payload (#41/#42)", () => {
  const testDb = bindTestDb(TEST_DB_PATH);

  it("bounds payload, drops bodies, and reports counts even with a large message history", async () => {
    const db = testDb.db();
    const conn: TooManyCooksDb = db;
    const sender = await registerAgent(conn, "bounded-sender");
    const reader = await registerAgent(conn, "bounded-reader");

    // 100 long-bodied messages from sender -> reader. Full bodies would blow the payload.
    const longBody = "x".repeat(150);
    for (let i = 0; i < SEEDED_MESSAGES; i += 1) {
      const sent = await conn.sendMessage(
        sender.agentName, sender.agentKey, reader.agentName, longBody,
      );
      assert.strictEqual(sent.ok, true, "seed send must succeed");
    }

    const handler = createStatusHandler(conn, createTestLogger());
    const result = await handler({ agent_key: reader.agentKey }, {});
    assert.strictEqual(result.isError, false, "status must not error");

    const rawText = firstTextBlock(result);
    assert.ok(
      rawText.length < PAYLOAD_CEILING_CHARS,
      `status payload must stay under ${String(PAYLOAD_CEILING_CHARS)} chars regardless of history, got ${String(rawText.length)}`,
    );

    const messages = getRecordField(parseJsonRecord(rawText), "messages");
    assert.strictEqual(typeof messages, "object", "messages must be an overview object, not a flat array");
    assert.strictEqual(Array.isArray(messages), false, "messages must NOT be a flat array of every row");
    assert.strictEqual(getNumberField(messages, "total"), SEEDED_MESSAGES, "messages.total must report the full count");
    assert.strictEqual(getNumberField(messages, "unread"), SEEDED_MESSAGES, "every seeded message is unread for the reader");
    const recent = getRecordArrayField(messages, "recent");
    assert.ok(
      recent.length <= RECENT_HEADER_CEILING,
      `recent header slice must be bounded, got ${String(recent.length)}`,
    );
    assert.ok(recent.length > 0, "recent must contain at least one header");

    for (const header of recent) {
      assert.strictEqual(
        "content" in header,
        false,
        "status headers must NEVER include the full message body",
      );
      assert.strictEqual(header.to_agent, reader.agentName, "recent must be the caller's own inbox only");
    }
  });

  it("recent excludes already-read messages and other agents' direct messages", async () => {
    const db = testDb.db();
    const conn: TooManyCooksDb = db;
    const alice = await registerAgent(conn, "bounded-alice");
    const bob = await registerAgent(conn, "bounded-bob");
    const carol = await registerAgent(conn, "bounded-carol");

    // Alice -> Bob (direct). Carol must never see it.
    const toBob = await conn.sendMessage(alice.agentName, alice.agentKey, bob.agentName, "for-bob");
    assert.strictEqual(toBob.ok, true);
    // Alice -> Carol, then Carol reads it: must drop out of Carol's unread recent.
    const toCarol = await conn.sendMessage(alice.agentName, alice.agentKey, carol.agentName, "for-carol");
    assert.strictEqual(toCarol.ok, true);
    if (!toCarol.ok) { throw new Error("expected msg id"); }
    const marked = await conn.markRead(toCarol.value, carol.agentName, carol.agentKey);
    assert.strictEqual(marked.ok, true, "mark read must succeed");

    const messages = await statusOverviewFor(conn, carol.agentKey);

    assert.strictEqual(messages.unread, 0, "Carol has no unread messages after reading hers");
    assert.strictEqual(
      messages.recent.length,
      0,
      "Carol's recent must be empty: her only message is read, Bob's is not hers",
    );
  });
});
