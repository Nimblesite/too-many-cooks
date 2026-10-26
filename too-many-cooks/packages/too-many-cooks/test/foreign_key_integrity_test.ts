/// Tests that SQLite foreign key constraints are enforced and cascade deletes
/// work for every child table — locks, plans, AND messages (both directions).
/// Originally only locks/plans/from_agent were covered, which let orphaned
/// inbound messages survive after a recipient was deleted (visible in the
/// VSIX as messages with no matching agent in the agents tree).

import { describe, it, afterEach } from "node:test";
import assert from "node:assert";

import Database from "better-sqlite3";
import { freshTestDb, openTestDb, registerAgent } from "./support/db_fixture.js";
import { deleteIfExists } from "./support/fs_helpers.js";
import {
  getNumberField,
  getStringField,
  isRecord,
} from "./support/json.js";

/** to_agent FK clause (any quoting style) whose ON DELETE action is NO ACTION. */
const TO_AGENT_FK_NO_ACTION: RegExp = /FOREIGN KEY \(\W*to_agent\W*\) REFERENCES[^,]*ON DELETE NO ACTION/u;

/** to_agent FK clause (any quoting style) whose ON DELETE action is CASCADE. */
const TO_AGENT_FK_CASCADE: RegExp = /FOREIGN KEY \(\W*to_agent\W*\) REFERENCES[^,]*ON DELETE CASCADE/u;

const TEST_FK_DB_PATH = ".test_fk_integrity.db";
const BROADCAST: string = "*";

const openRawDb = (): Database.Database => {
  const db = new Database(TEST_FK_DB_PATH);
  db.pragma("foreign_keys = ON");
  return db;
};

/// [VSIX-REMOVE-AGENT] Issue #43, Hypothesis A: rebuild the messages table the way
/// it looked BEFORE the to_agent cascade migration — to_agent ON DELETE NO ACTION —
/// simulating a DB that predates 20260525_add_to_agent_fk_cascade.
const downgradeMessagesToPreCascade = (path: string): void => {
  const db = new Database(path);
  db.pragma("foreign_keys = OFF");
  db.exec(`
    DROP TABLE IF EXISTS message_reads;
    DROP TABLE IF EXISTS messages;
    CREATE TABLE messages (
      id TEXT PRIMARY KEY NOT NULL,
      from_agent TEXT NOT NULL,
      to_agent TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      read_at BIGINT,
      CONSTRAINT messages_from_agent_fkey FOREIGN KEY (from_agent) REFERENCES identity (agent_name) ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT messages_to_agent_fkey FOREIGN KEY (to_agent) REFERENCES identity (agent_name) ON DELETE NO ACTION ON UPDATE CASCADE
    );
    CREATE TABLE message_reads (
      message_id TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      read_at BIGINT NOT NULL,
      PRIMARY KEY (message_id, agent_name),
      CONSTRAINT message_reads_message_id_fkey FOREIGN KEY (message_id) REFERENCES messages (id) ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT message_reads_agent_name_fkey FOREIGN KEY (agent_name) REFERENCES identity (agent_name) ON DELETE CASCADE ON UPDATE CASCADE
    );
  `);
  db.close();
};

const messagesDdl = (path: string): string => {
  const db = new Database(path);
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'messages'").get();
  db.close();
  return isRecord(row) ? getStringField(row, "sql") : "";
};

/** COUNT(*) helper: narrows a `SELECT COUNT(*) as c` row to its number. */
const countOf = (row: unknown): number => {
  if (!isRecord(row)) { throw new Error("expected a COUNT(*) row"); }
  return getNumberField(row, "c");
};

describe("foreign_key_integrity", () => {
  afterEach(() => { deleteIfExists(TEST_FK_DB_PATH); });

  it("cascade deletes locks when agent is deleted directly", async () => {
    const result = freshTestDb(TEST_FK_DB_PATH);

    const reg = await registerAgent(result.db, "fk-test-agent");

    await result.db.acquireLock("/fk/test.ts", reg.agentName, reg.agentKey, null, 60000);
    await result.db.close();

    const db = openRawDb();
    db.prepare("DELETE FROM identity WHERE agent_name = ?").run("fk-test-agent");
    const lockRow = db.prepare("SELECT * FROM locks WHERE agent_name = ?").get("fk-test-agent");
    db.close();

    assert.strictEqual(lockRow, undefined, "Lock must be cascade deleted with agent");
  });

  it("cascade deletes plans when agent is deleted directly", async () => {
    const result = freshTestDb(TEST_FK_DB_PATH);

    const reg = await registerAgent(result.db, "fk-plan-agent");

    await result.db.updatePlan(reg.agentName, reg.agentKey, "Goal", "Task");
    await result.db.close();

    const db = openRawDb();
    db.prepare("DELETE FROM identity WHERE agent_name = ?").run("fk-plan-agent");
    const planRow = db.prepare("SELECT * FROM plans WHERE agent_name = ?").get("fk-plan-agent");
    db.close();

    assert.strictEqual(planRow, undefined, "Plan must be cascade deleted with agent");
  });

  it("rejects lock insertion for nonexistent agent when FKs enforced", async () => {
    const result = freshTestDb(TEST_FK_DB_PATH);
    await result.db.close();

    const db = openRawDb();
    assert.throws(
      () => {
        db.prepare(
          "INSERT INTO locks (file_path, agent_name, acquired_at, expires_at) VALUES (?, ?, ?, ?)",
        ).run("/bad/file.ts", "ghost-agent", Date.now(), Date.now() + 60000);
      },
      /FOREIGN KEY constraint failed/u,
      "Inserting a lock for a nonexistent agent must fail",
    );
    db.close();
  });

  it("cascade deletes outbound messages (from_agent) when sender is deleted", async () => {
    const result = freshTestDb(TEST_FK_DB_PATH);

    const sender = await registerAgent(result.db, "fk-msg-sender");
    const receiver = await registerAgent(result.db, "fk-msg-receiver");

    const sent = await result.db.sendMessage(
      sender.agentName, sender.agentKey, receiver.agentName, "hi receiver",
    );
    assert.strictEqual(sent.ok, true);
    await result.db.close();

    const db = openRawDb();
    const before = countOf(db.prepare("SELECT COUNT(*) as c FROM messages WHERE from_agent = ?").get("fk-msg-sender"));
    assert.strictEqual(before, 1, "Sanity: sender must have one outbound message before delete");

    db.prepare("DELETE FROM identity WHERE agent_name = ?").run("fk-msg-sender");

    const after = countOf(db.prepare("SELECT COUNT(*) as c FROM messages WHERE from_agent = ?").get("fk-msg-sender"));
    const receiverInbox = countOf(db.prepare("SELECT COUNT(*) as c FROM messages WHERE to_agent = ?").get("fk-msg-receiver"));
    db.close();

    assert.strictEqual(after, 0, "Outbound messages from deleted sender must be cascade-deleted");
    assert.strictEqual(receiverInbox, 0, "Receiver inbox referencing dead sender must be cleaned");
  });

  it("cascade deletes inbound messages (to_agent) when recipient is deleted — the bug the user reported", async () => {
    const result = freshTestDb(TEST_FK_DB_PATH);

    const sender = await registerAgent(result.db, "fk-survives-sender");
    const recipient = await registerAgent(result.db, "fk-doomed-recipient");

    const sent1 = await result.db.sendMessage(
      sender.agentName, sender.agentKey, recipient.agentName, "msg 1",
    );
    const sent2 = await result.db.sendMessage(
      sender.agentName, sender.agentKey, recipient.agentName, "msg 2",
    );
    assert.strictEqual(sent1.ok, true);
    assert.strictEqual(sent2.ok, true);
    await result.db.close();

    const db = openRawDb();
    const before = countOf(db.prepare("SELECT COUNT(*) as c FROM messages WHERE to_agent = ?").get("fk-doomed-recipient"));
    assert.strictEqual(before, 2, "Sanity: recipient must have two inbound messages before delete");

    db.prepare("DELETE FROM identity WHERE agent_name = ?").run("fk-doomed-recipient");

    const after = countOf(db.prepare("SELECT COUNT(*) as c FROM messages WHERE to_agent = ?").get("fk-doomed-recipient"));
    const senderStillThere: unknown = db.prepare("SELECT agent_name FROM identity WHERE agent_name = ?").get("fk-survives-sender");
    db.close();

    assert.strictEqual(after, 0, "Inbound messages to deleted recipient MUST be cascade-deleted — no orphans");
    assert.notStrictEqual(senderStillThere, undefined, "Sender must survive deletion of recipient");
  });

  it("rejects message insertion for nonexistent to_agent when FKs enforced", async () => {
    const result = freshTestDb(TEST_FK_DB_PATH);

    await registerAgent(result.db, "fk-orphan-sender");
    await result.db.close();

    const db = openRawDb();
    assert.throws(
      () => {
        db.prepare(
          "INSERT INTO messages (id, from_agent, to_agent, content, created_at) VALUES (?, ?, ?, ?, ?)",
        ).run("orphan-msg-id", "fk-orphan-sender", "ghost-recipient", "boom", Date.now());
      },
      /FOREIGN KEY constraint failed/u,
      "Inserting a message to a nonexistent recipient must fail",
    );
    db.close();
  });

  it("broadcast sentinel row exists so to_agent='*' is FK-valid", async () => {
    const result = freshTestDb(TEST_FK_DB_PATH);

    const sender = await registerAgent(result.db, "fk-broadcast-sender");

    const broadcast = await result.db.sendMessage(
      sender.agentName, sender.agentKey, BROADCAST, "hello everyone",
    );
    assert.strictEqual(broadcast.ok, true, "Broadcast send must succeed thanks to '*' sentinel row");
    await result.db.close();

    const db = openRawDb();
    const sentinelRow = db.prepare("SELECT agent_name AS agentName, active FROM identity WHERE agent_name = ?").get(BROADCAST);
    const broadcastRowRaw = db.prepare("SELECT to_agent AS toAgent, content FROM messages WHERE to_agent = ?").get(BROADCAST);
    db.close();

    assert.notStrictEqual(sentinelRow, undefined, "Broadcast sentinel identity row must exist");
    const sentinelActive = isRecord(sentinelRow)
      ? getNumberField(sentinelRow, "active")
      : undefined;
    assert.strictEqual(sentinelActive, 0, "Sentinel must be inactive so it never appears in agent lists");
    assert.notStrictEqual(broadcastRowRaw, undefined, "Broadcast message must be stored against to_agent='*'");
    const content = isRecord(broadcastRowRaw) ? getStringField(broadcastRowRaw, "content") : "";
    assert.strictEqual(content, "hello everyone");
  });

  it("register rejects '*' because it would collide with the broadcast sentinel", async () => {
    const result = freshTestDb(TEST_FK_DB_PATH);

    const rejected = await result.db.register(BROADCAST);
    await result.db.close();

    assert.strictEqual(rejected.ok, false, "Registering '*' must be rejected");
    if (rejected.ok) { return; }
    assert.match(rejected.error.message, /reserved/iu, "Error message must explain the reservation");
  });

  it("adminDeleteAgent refuses to delete the broadcast sentinel", async () => {
    const result = freshTestDb(TEST_FK_DB_PATH);

    const refused = await result.db.adminDeleteAgent(BROADCAST);
    assert.strictEqual(refused.ok, false, "adminDeleteAgent must refuse to delete the sentinel");

    const sender = await registerAgent(result.db, "fk-still-broadcasting");
    const broadcast = await result.db.sendMessage(
      sender.agentName, sender.agentKey, BROADCAST, "still works",
    );
    await result.db.close();

    assert.strictEqual(broadcast.ok, true, "Broadcast must still work after refused delete attempt");
  });

  it("cascade is end-to-end: adminDeleteAgent wipes locks, plans, outbound AND inbound messages", async () => {
    const result = freshTestDb(TEST_FK_DB_PATH);

    const alice = await registerAgent(result.db, "fk-alice");
    const bob = await registerAgent(result.db, "fk-bob");

    await result.db.acquireLock("/a.ts", alice.agentName, alice.agentKey, "edit", 60000);
    await result.db.acquireLock("/b.ts", alice.agentName, alice.agentKey, "edit", 60000);
    await result.db.updatePlan(alice.agentName, alice.agentKey, "Goal", "Task");
    await result.db.sendMessage(alice.agentName, alice.agentKey, bob.agentName, "out 1");
    await result.db.sendMessage(alice.agentName, alice.agentKey, bob.agentName, "out 2");
    await result.db.sendMessage(bob.agentName, bob.agentKey, alice.agentName, "in 1");
    await result.db.sendMessage(alice.agentName, alice.agentKey, BROADCAST, "shout");

    const wipe = await result.db.adminDeleteAgent("fk-alice");
    assert.strictEqual(wipe.ok, true, "adminDeleteAgent must succeed");

    const locksAfter = await result.db.listLocks();
    const plansAfter = await result.db.listPlans();
    const messagesAfter = await result.db.listAllMessages();
    const agentsAfter = await result.db.listAgents();
    await result.db.close();

    assert.strictEqual(locksAfter.ok, true);
    assert.strictEqual(plansAfter.ok, true);
    assert.strictEqual(messagesAfter.ok, true);
    assert.strictEqual(agentsAfter.ok, true);
    if (!locksAfter.ok || !plansAfter.ok || !messagesAfter.ok || !agentsAfter.ok) { return; }

    assert.strictEqual(locksAfter.value.length, 0, "All of alice's locks must be gone");
    assert.strictEqual(plansAfter.value.length, 0, "Alice's plan must be gone");
    const aliceMessages = messagesAfter.value.filter(
      (m) => m.fromAgent === "fk-alice" || m.toAgent === "fk-alice",
    );
    assert.strictEqual(aliceMessages.length, 0, "Every message touching alice (from OR to) must be gone");
    assert.strictEqual(messagesAfter.value.length, 0, "All four cross-agent messages must cascade out");
    assert.strictEqual(agentsAfter.value.length, 1, "Only bob remains as an active agent");
    assert.strictEqual(agentsAfter.value[0]?.agentName, "fk-bob");
  });

  /// [VSIX-REMOVE-AGENT] Issue #43, Hypothesis A: on a DB that predates the
  /// to_agent cascade migration, reopening through createDb must repair the schema
  /// ([DB-MIGRATE] DataProviderMigrate diffs the FK and rebuilds the table with
  /// ON DELETE CASCADE) so that deleting a
  /// recipient cascade-deletes their inbound messages — no orphans survive. This
  /// is the legacy-DB counterpart to the fresh-DB cascade tests above.
  it("repairs a pre-cascade messages table on reopen, then cascade-deletes inbound messages (#43)", async () => {
    deleteIfExists(TEST_FK_DB_PATH);
    const first = openTestDb(TEST_FK_DB_PATH);
    await first.db.close();

    downgradeMessagesToPreCascade(TEST_FK_DB_PATH);
    assert.match(
      messagesDdl(TEST_FK_DB_PATH),
      TO_AGENT_FK_NO_ACTION,
      "precondition: legacy messages table must lack the to_agent cascade",
    );

    const second = openTestDb(TEST_FK_DB_PATH);

    assert.match(
      messagesDdl(TEST_FK_DB_PATH),
      TO_AGENT_FK_CASCADE,
      "the migration must rebuild the messages table with the to_agent cascade",
    );

    const sender = await registerAgent(second.db, "pre-sender");
    const recipient = await registerAgent(second.db, "pre-recipient");
    await second.db.sendMessage(sender.agentName, sender.agentKey, recipient.agentName, "legacy inbound");

    const wipe = await second.db.adminDeleteAgent("pre-recipient");
    assert.strictEqual(wipe.ok, true, "deleting the recipient must succeed");
    const after = await second.db.listAllMessages();
    await second.db.close();

    assert.strictEqual(after.ok, true);
    if (!after.ok) { return; }
    assert.strictEqual(
      after.value.length,
      0,
      "inbound message to the deleted recipient MUST cascade out after schema repair — no orphans",
    );
  });
});
