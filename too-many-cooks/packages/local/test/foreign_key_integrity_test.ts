/// Tests that SQLite foreign key constraints are enforced and cascade deletes work.

import { describe, it, afterEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs";

import Database from "better-sqlite3";
import { createDataConfig } from "@too-many-cooks/core";
import { createDb } from "../src/db-sqlite.js";

const TEST_FK_DB_PATH = ".test_fk_integrity.db" as const;

const deleteIfExists = (path: string): void => {
  try {
    if (fs.existsSync(path)) fs.unlinkSync(path);
  } catch { /* ignore */ }
};

describe("foreign_key_integrity", () => {
  afterEach(() => deleteIfExists(TEST_FK_DB_PATH));

  it("cascade deletes locks when agent is deleted directly", async () => {
    deleteIfExists(TEST_FK_DB_PATH);
    const config = createDataConfig({ dbPath: TEST_FK_DB_PATH });
    const result = createDb(config);
    assert.strictEqual(result.ok, true);
    if (!result.ok) return;

    const reg = await result.value.register("fk-test-agent");
    assert.strictEqual(reg.ok, true);
    if (!reg.ok) return;

    await result.value.acquireLock("/fk/test.ts", reg.value.agentName, reg.value.agentKey, null, 60000);
    await result.value.close();

    const db = new Database(TEST_FK_DB_PATH);
    db.pragma("foreign_keys = ON");
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
    if (!result.ok) return;

    const reg = await result.value.register("fk-plan-agent");
    assert.strictEqual(reg.ok, true);
    if (!reg.ok) return;

    await result.value.updatePlan(reg.value.agentName, reg.value.agentKey, "Goal", "Task");
    await result.value.close();

    const db = new Database(TEST_FK_DB_PATH);
    db.pragma("foreign_keys = ON");
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
    if (!result.ok) return;
    await result.value.close();

    const db = new Database(TEST_FK_DB_PATH);
    db.pragma("foreign_keys = ON");
    assert.throws(
      () => {
        db.prepare(
          "INSERT INTO locks (file_path, agent_name, acquired_at, expires_at) VALUES (?, ?, ?, ?)",
        ).run("/bad/file.ts", "ghost-agent", Date.now(), Date.now() + 60000);
      },
      /FOREIGN KEY constraint failed/,
      "Inserting a lock for a nonexistent agent must fail",
    );
    db.close();
  });
});
