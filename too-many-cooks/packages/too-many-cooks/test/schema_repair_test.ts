/// E2E test: re-running migrations repairs schema drift without any history.
///
/// [DB-MIGRATE] DataProviderMigrate diffs schema/tmc-schema.yaml against the
/// live DB and patches drift (missing columns, missing tables, missing
/// indexes) — no migration tracking required. This test proves that
/// behavior: spin up a fresh DB, drop a column directly via ALTER TABLE,
/// then re-run createDb and assert the column is back.

import { describe, it, afterEach } from "node:test";
import assert from "node:assert";
import { createDataConfig } from "too-many-cooks-core";
import { createDb } from "../src/db-sqlite.js";
import { deleteIfExists } from "./support/fs_helpers.js";
import { assertColumnAbsent, assertColumnPresent, dropColumn } from "./support/sqlite_rows.js";

const TEST_DB_PATH: string = ".test_schema_repair.db";
const TABLE_LOCKS: string = "locks";
const COLUMN_REASON: string = "reason";

/** One createDb cycle: fails the test when it does not open, then closes it. */
const openAndClose = async (path: string): Promise<void> => {
  const opened = createDb(createDataConfig({ dbPath: path }));
  assert.strictEqual(
    opened.ok,
    true,
    `createDb must succeed, got: ${opened.ok ? "" : opened.error}`,
  );
  if (!opened.ok) { return; }
  await opened.value.close();
};

describe("schema repair without migration history", () => {
  afterEach(() => {
    deleteIfExists(TEST_DB_PATH);
  });

  it("re-running createDb restores a column that was dropped via ALTER TABLE", async () => {
    // Step 1: create a fresh DB. DataProviderMigrate lays down the full schema.
    await openAndClose(TEST_DB_PATH);
    assertColumnPresent(TEST_DB_PATH, TABLE_LOCKS, COLUMN_REASON, "precondition");

    // Step 2: corrupt the schema. Drop locks.reason directly with raw SQL —
    // simulating a user/tool that mangled the DB outside the migration tool's knowledge.
    // There is NO migration history that records this column was ever removed.
    dropColumn(TEST_DB_PATH, TABLE_LOCKS, COLUMN_REASON);
    assertColumnAbsent(TEST_DB_PATH, TABLE_LOCKS, COLUMN_REASON, "setup after DROP COLUMN");

    // Step 3: re-open the DB through createDb. applyMigrations runs
    // DataProviderMigrate, which diffs the YAML vs the live DB and patches the drift.
    await openAndClose(TEST_DB_PATH);

    // Step 4: the dropped column is back, NO migration history required.
    assertColumnPresent(TEST_DB_PATH, TABLE_LOCKS, COLUMN_REASON, "DataProviderMigrate repair");
  });
});
