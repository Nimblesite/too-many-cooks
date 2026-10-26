/// E2E test: re-running migrations repairs schema drift without any history.
///
/// [DB-MIGRATE] DataProviderMigrate diffs schema/tmc-schema.yaml against the
/// live DB and patches drift (missing columns, missing tables, missing
/// indexes) — no migration tracking required. This test proves that
/// behavior: spin up a fresh DB, drop a column directly via ALTER TABLE,
/// then re-run createDb and assert the column is back.

import { describe, it, afterEach } from "node:test";
import assert from "node:assert";
import Database from "better-sqlite3";

import { createDataConfig } from "too-many-cooks-core";
import { createDb } from "../src/db-sqlite.js";
import { deleteIfExists } from "./support/fs_helpers.js";
import { pragmaColumnNames } from "./support/sqlite_rows.js";

const TEST_DB_PATH: string = ".test_schema_repair.db";
const TABLE_LOCKS: string = "locks";
const COLUMN_REASON: string = "reason";

const tableColumnNames = (dbPath: string, table: string): readonly string[] => {
  const db: Database.Database = new Database(dbPath);
  try {
    return pragmaColumnNames(db.pragma(`table_info(${table})`));
  } finally {
    db.close();
  }
};

const dropColumn = (dbPath: string, table: string, column: string): void => {
  const db: Database.Database = new Database(dbPath);
  try {
    db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
  } finally {
    db.close();
  }
};

describe("schema repair without migration history", () => {
  afterEach(() => {
    deleteIfExists(TEST_DB_PATH);
  });

  it("re-running createDb restores a column that was dropped via ALTER TABLE", async () => {
    // Step 1: create a fresh DB. DataProviderMigrate lays down the full schema.
    const config = createDataConfig({ dbPath: TEST_DB_PATH });
    const firstOpen = createDb(config);
    assert.strictEqual(
      firstOpen.ok,
      true,
      `initial createDb must succeed, got: ${firstOpen.ok ? "" : firstOpen.error}`,
    );
    if (!firstOpen.ok) { return; }
    await firstOpen.value.close();

    const beforeDrop: readonly string[] = tableColumnNames(TEST_DB_PATH, TABLE_LOCKS);
    assert.ok(
      beforeDrop.includes(COLUMN_REASON),
      `precondition: ${TABLE_LOCKS}.${COLUMN_REASON} must exist on a fresh DB, got cols: ${beforeDrop.join(",")}`,
    );

    // Step 2: corrupt the schema. Drop locks.reason directly with raw SQL —
    // simulating a user/tool that mangled the DB outside the migration tool's knowledge.
    // There is NO migration history that records this column was ever removed.
    dropColumn(TEST_DB_PATH, TABLE_LOCKS, COLUMN_REASON);
    const afterDrop: readonly string[] = tableColumnNames(TEST_DB_PATH, TABLE_LOCKS);
    assert.ok(
      !afterDrop.includes(COLUMN_REASON),
      `setup: ${TABLE_LOCKS}.${COLUMN_REASON} must be gone after DROP COLUMN, got cols: ${afterDrop.join(",")}`,
    );

    // Step 3: re-open the DB through createDb. applyMigrations runs
    // DataProviderMigrate, which diffs the YAML vs the live DB and patches the drift.
    const secondOpen = createDb(config);
    assert.strictEqual(
      secondOpen.ok,
      true,
      `re-opening createDb must succeed after schema drift, got: ${secondOpen.ok ? "" : secondOpen.error}`,
    );
    if (!secondOpen.ok) { return; }
    await secondOpen.value.close();

    // Step 4: the dropped column is back, NO migration history required.
    const afterRepair: readonly string[] = tableColumnNames(TEST_DB_PATH, TABLE_LOCKS);
    assert.ok(
      afterRepair.includes(COLUMN_REASON),
      `${TABLE_LOCKS}.${COLUMN_REASON} must be restored by DataProviderMigrate, got cols: ${afterRepair.join(",")}`,
    );
  });
});
