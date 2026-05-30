/// Tests that SQLite foreign key constraints are enforced and cascade deletes
/// work for every child table — locks, plans, AND messages (both directions).
/// Originally only locks/plans/from_agent were covered, which let orphaned
/// inbound messages survive after a recipient was deleted (visible in the
/// VSIX as messages with no matching agent in the agents tree).

import { describe, it, afterEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs";

import Database from "better-sqlite3";
import { createDataConfig } from "too-many-cooks-core";
import { createDb } from "../src/db-sqlite.js";

const TEST_FK_DB_PATH = ".test_fk_integrity.db" as const;
const BROADCAST: string = "*";

const deleteIfExists = (path: string): void => {
  try {
    if (fs.existsSync(path)) { fs.unlinkSync(path); }
  } catch { /* ignore */ }
};

const openRawDb = (): Database.Database => {
  const db = new Database(TEST_FK_DB_PATH);
  db.pragma("foreign_keys = ON");
  return db;
};

describe("foreign_key_integrity", () => {
  afterEach(() => { deleteIfExists(TEST_FK_DB_PATH); });

  it("cascade deletes locks when agent is deleted directly", async () => {
    deleteIfExists(TEST_FK_DB_PATH);
    const config = createDataConfig({ dbPath: TEST_FK_DB_PATH });
    const result = createDb(config);
    assert.strictEqual(result.ok, true);
    if (!result.ok) { return; }

    const reg = await result.value.register("fk-test-agent");
    assert.strictEqual(reg.ok, true);
    if (!reg.ok) { return; }

    await result.value.acquireLock("/fk/test.ts", reg.value.agentName, reg.value.agentKey, null, 60000);
    await result.value.close();

    const db = openRawDb();
    db.prepare("DELETE FROM identity WHERE agent_name = ?").run("fk-test-agent");
    const lockRow = db.prepare("SELECT * FROM locks WHERE agent_name = ?").get("fk-test-agent");
    db.close();

    assert.strictEqual(lockRow, undefined, "Lock must be cascade deleted with agent");
  });

  it("cascade deletes plans when agent is deleted directly", async () => {
    deleteIfExists(TEST_FK_DB_PATH);
    const config = createDataConfig({ dbPath: TEST_FK_DB_PATH });
    const result = createDb(config);
    assert.strictEqual(result.ok, true);
    if (!result.ok) { return; }

    const reg = await result.value.register("fk-plan-agent");
    assert.strictEqual(reg.ok, true);
    if (!reg.ok) { return; }

    await result.value.updatePlan(reg.value.agentName, reg.value.agentKey, "Goal", "Task");
    await result.value.close();

    const db = openRawDb();
    db.prepare("DELETE FROM identity WHERE agent_name = ?").run("fk-plan-agent");
    const planRow = db.prepare("SELECT * FROM plans WHERE agent_name = ?").get("fk-plan-agent");
    db.close();

    assert.strictEqual(planRow, undefined, "Plan must be cascade deleted with agent");
  });

  it("rejects lock insertion for nonexistent agent when FKs enforced", async () => {
    deleteIfExists(TEST_FK_DB_PATH);
    const config = createDataConfig({ dbPath: TEST_FK_DB_PATH });
    const result = createDb(config);
    assert.strictEqual(result.ok, true);
    if (!result.ok) { return; }
    await result.value.close();

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
    deleteIfExists(TEST_FK_DB_PATH);
    const config = createDataConfig({ dbPath: TEST_FK_DB_PATH });
    const result = createDb(config);
    assert.strictEqual(result.ok, true);
    if (!result.ok) { return; }

    const sender = await result.value.register("fk-msg-sender");
    const receiver = await result.value.register("fk-msg-receiver");
    assert.strictEqual(sender.ok, true);
    assert.strictEqual(receiver.ok, true);
    if (!sender.ok || !receiver.ok) { return; }

    const sent = await result.value.sendMessage(
      sender.value.agentName, sender.value.agentKey, receiver.value.agentName, "hi receiver",
    );
    assert.strictEqual(sent.ok, true);
    await result.value.close();

    const db = openRawDb();
    const before = db.prepare("SELECT COUNT(*) as c FROM messages WHERE from_agent = ?").get("fk-msg-sender") as { c: number };
    assert.strictEqual(before.c, 1, "Sanity: sender must have one outbound message before delete");

    db.prepare("DELETE FROM identity WHERE agent_name = ?").run("fk-msg-sender");

    const after = db.prepare("SELECT COUNT(*) as c FROM messages WHERE from_agent = ?").get("fk-msg-sender") as { c: number };
    const receiverInbox = db.prepare("SELECT COUNT(*) as c FROM messages WHERE to_agent = ?").get("fk-msg-receiver") as { c: number };
    db.close();

    assert.strictEqual(after.c, 0, "Outbound messages from deleted sender must be cascade-deleted");
    assert.strictEqual(receiverInbox.c, 0, "Receiver inbox referencing dead sender must be cleaned");
  });

  it("cascade deletes inbound messages (to_agent) when recipient is deleted — the bug the user reported", async () => {
    deleteIfExists(TEST_FK_DB_PATH);
    const config = createDataConfig({ dbPath: TEST_FK_DB_PATH });
    const result = createDb(config);
    assert.strictEqual(result.ok, true);
    if (!result.ok) { return; }

    const sender = await result.value.register("fk-survives-sender");
    const recipient = await result.value.register("fk-doomed-recipient");
    assert.strictEqual(sender.ok, true);
    assert.strictEqual(recipient.ok, true);
    if (!sender.ok || !recipient.ok) { return; }

    const sent1 = await result.value.sendMessage(
      sender.value.agentName, sender.value.agentKey, recipient.value.agentName, "msg 1",
    );
    const sent2 = await result.value.sendMessage(
      sender.value.agentName, sender.value.agentKey, recipient.value.agentName, "msg 2",
    );
    assert.strictEqual(sent1.ok, true);
    assert.strictEqual(sent2.ok, true);
    await result.value.close();

    const db = openRawDb();
    const before = db.prepare("SELECT COUNT(*) as c FROM messages WHERE to_agent = ?").get("fk-doomed-recipient") as { c: number };
    assert.strictEqual(before.c, 2, "Sanity: recipient must have two inbound messages before delete");

    db.prepare("DELETE FROM identity WHERE agent_name = ?").run("fk-doomed-recipient");

    const after = db.prepare("SELECT COUNT(*) as c FROM messages WHERE to_agent = ?").get("fk-doomed-recipient") as { c: number };
    const senderStillThere: unknown = db.prepare("SELECT agent_name FROM identity WHERE agent_name = ?").get("fk-survives-sender");
    db.close();

    assert.strictEqual(after.c, 0, "Inbound messages to deleted recipient MUST be cascade-deleted — no orphans");
    assert.notStrictEqual(senderStillThere, undefined, "Sender must survive deletion of recipient");
  });

  it("rejects message insertion for nonexistent to_agent when FKs enforced", async () => {
    deleteIfExists(TEST_FK_DB_PATH);
    const config = createDataConfig({ dbPath: TEST_FK_DB_PATH });
    const result = createDb(config);
    assert.strictEqual(result.ok, true);
    if (!result.ok) { return; }

    const sender = await result.value.register("fk-orphan-sender");
    assert.strictEqual(sender.ok, true);
    if (!sender.ok) { return; }
    await result.value.close();

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
    deleteIfExists(TEST_FK_DB_PATH);
    const config = createDataConfig({ dbPath: TEST_FK_DB_PATH });
    const result = createDb(config);
    assert.strictEqual(result.ok, true);
    if (!result.ok) { return; }

    const sender = await result.value.register("fk-broadcast-sender");
    assert.strictEqual(sender.ok, true);
    if (!sender.ok) { return; }

    const broadcast = await result.value.sendMessage(
      sender.value.agentName, sender.value.agentKey, BROADCAST, "hello everyone",
    );
    assert.strictEqual(broadcast.ok, true, "Broadcast send must succeed thanks to '*' sentinel row");
    await result.value.close();

    const db = openRawDb();
    const sentinel = db.prepare("SELECT agent_name AS agentName, active FROM identity WHERE agent_name = ?").get(BROADCAST) as { agentName: string; active: number } | undefined;
    const broadcastRow = db.prepare("SELECT to_agent AS toAgent, content FROM messages WHERE to_agent = ?").get(BROADCAST) as { toAgent: string; content: string } | undefined;
    db.close();

    assert.notStrictEqual(sentinel, undefined, "Broadcast sentinel identity row must exist");
    assert.strictEqual(sentinel?.active, 0, "Sentinel must be inactive so it never appears in agent lists");
    assert.notStrictEqual(broadcastRow, undefined, "Broadcast message must be stored against to_agent='*'");
    assert.strictEqual(broadcastRow?.content, "hello everyone");
  });

  it("register rejects '*' because it would collide with the broadcast sentinel", async () => {
    deleteIfExists(TEST_FK_DB_PATH);
    const config = createDataConfig({ dbPath: TEST_FK_DB_PATH });
    const result = createDb(config);
    assert.strictEqual(result.ok, true);
    if (!result.ok) { return; }

    const rejected = await result.value.register(BROADCAST);
    await result.value.close();

    assert.strictEqual(rejected.ok, false, "Registering '*' must be rejected");
    if (rejected.ok) { return; }
    assert.match(rejected.error.message, /reserved/iu, "Error message must explain the reservation");
  });

  it("adminDeleteAgent refuses to delete the broadcast sentinel", async () => {
    deleteIfExists(TEST_FK_DB_PATH);
    const config = createDataConfig({ dbPath: TEST_FK_DB_PATH });
    const result = createDb(config);
    assert.strictEqual(result.ok, true);
    if (!result.ok) { return; }

    const refused = await result.value.adminDeleteAgent(BROADCAST);
    assert.strictEqual(refused.ok, false, "adminDeleteAgent must refuse to delete the sentinel");

    const sender = await result.value.register("fk-still-broadcasting");
    assert.strictEqual(sender.ok, true);
    if (!sender.ok) { return; }
    const broadcast = await result.value.sendMessage(
      sender.value.agentName, sender.value.agentKey, BROADCAST, "still works",
    );
    await result.value.close();

    assert.strictEqual(broadcast.ok, true, "Broadcast must still work after refused delete attempt");
  });

  it("cascade is end-to-end: adminDeleteAgent wipes locks, plans, outbound AND inbound messages", async () => {
    deleteIfExists(TEST_FK_DB_PATH);
    const config = createDataConfig({ dbPath: TEST_FK_DB_PATH });
    const result = createDb(config);
    assert.strictEqual(result.ok, true);
    if (!result.ok) { return; }

    const alice = await result.value.register("fk-alice");
    const bob = await result.value.register("fk-bob");
    assert.strictEqual(alice.ok, true);
    assert.strictEqual(bob.ok, true);
    if (!alice.ok || !bob.ok) { return; }

    await result.value.acquireLock("/a.ts", alice.value.agentName, alice.value.agentKey, "edit", 60000);
    await result.value.acquireLock("/b.ts", alice.value.agentName, alice.value.agentKey, "edit", 60000);
    await result.value.updatePlan(alice.value.agentName, alice.value.agentKey, "Goal", "Task");
    await result.value.sendMessage(alice.value.agentName, alice.value.agentKey, bob.value.agentName, "out 1");
    await result.value.sendMessage(alice.value.agentName, alice.value.agentKey, bob.value.agentName, "out 2");
    await result.value.sendMessage(bob.value.agentName, bob.value.agentKey, alice.value.agentName, "in 1");
    await result.value.sendMessage(alice.value.agentName, alice.value.agentKey, BROADCAST, "shout");

    const wipe = await result.value.adminDeleteAgent("fk-alice");
    assert.strictEqual(wipe.ok, true, "adminDeleteAgent must succeed");

    const locksAfter = await result.value.listLocks();
    const plansAfter = await result.value.listPlans();
    const messagesAfter = await result.value.listAllMessages();
    const agentsAfter = await result.value.listAgents();
    await result.value.close();

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
});
