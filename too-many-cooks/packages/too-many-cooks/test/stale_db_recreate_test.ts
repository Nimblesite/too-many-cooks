/// E2E test: createDb with a stale DB tells the user to delete it.
///
/// If prisma cannot upgrade the DB, createDb must return an error
/// that tells the user to delete the DB file and restart.

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

  it("createDb succeeds with stale DB because prisma upgrades it", async () => {
    createStaleDb(TEST_DB_PATH);

    const config = createDataConfig({ dbPath: TEST_DB_PATH });
    const result = createDb(config);

    // Prisma db push should upgrade the schema in dev
    assert.strictEqual(
      result.ok,
      true,
      `createDb must succeed when prisma can upgrade, got: ${result.ok ? "" : result.error}`,
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
