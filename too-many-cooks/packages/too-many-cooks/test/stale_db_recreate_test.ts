/// E2E test: createDb with a stale DB rebuilds it from scratch.
///
/// When the embedded migrations cannot apply over an existing schema,
/// db-sqlite.tryCreateDb deletes the DB file and re-runs migrations on
/// a fresh DB. Existing data is lost — by design (CLAUDE.md: no legacy DB support).

import { describe, it, afterEach } from "node:test";
import assert from "node:assert";
import { existsSync, unlinkSync } from "node:fs";
import Database from "better-sqlite3";

import { createDataConfig } from "too-many-cooks-core";
import { createDb } from "../src/db-sqlite.js";

const TEST_DB_PATH = ".test_stale_db_recreate.db";

const deleteIfExists = (path: string): void => {
  try {
    if (existsSync(path)) { unlinkSync(path); }
  } catch {
    // ignore
  }
};

/** Create a stale SQLite DB WITHOUT the `active` column on identity. */
const createStaleDb = (dbPath: string): void => {
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);
    INSERT INTO schema_version (version) VALUES (1);

    CREATE TABLE identity (
      agent_name TEXT PRIMARY KEY,
      agent_key TEXT NOT NULL UNIQUE,
      registered_at INTEGER NOT NULL,
      last_active INTEGER NOT NULL
    );
  `);
  db.close();
};

describe("stale DB produces a clear error from createDb", () => {
  afterEach(() => {
    deleteIfExists(TEST_DB_PATH);
  });

  it("createDb rebuilds a stale DB from scratch", async () => {
    createStaleDb(TEST_DB_PATH);

    const config = createDataConfig({ dbPath: TEST_DB_PATH });
    const result = createDb(config);

    assert.strictEqual(
      result.ok,
      true,
      `createDb must succeed by nuking the stale DB, got: ${result.ok ? "" : result.error}`,
    );

    if (!result.ok) { return; }
    const db = result.value;

    // Verify the upgraded DB works
    const regResult = await db.register("test-agent");
    assert.strictEqual(regResult.ok, true, "register must succeed");

    const activateResult = await db.activate("test-agent");
    assert.strictEqual(activateResult.ok, true, "activate must succeed");

    const listResult = await db.listAgents();
    assert.strictEqual(listResult.ok, true, "listAgents must succeed");
    if (listResult.ok) {
      assert.strictEqual(listResult.value.length, 1, "must have 1 active agent");
      assert.strictEqual(listResult.value[0]?.agentName, "test-agent");
    }

    await db.close();
  });
});
