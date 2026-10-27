/// [DB-MIGRATE] Regression test: `npx too-many-cooks@latest` on Windows died at
/// startup with "spawnSync npx ENOENT" because the old migration spawned the
/// `npx` shim by bare name (a `.cmd` shim Node cannot spawn without a shell).
///
/// Contract under test: applying the schema must NOT depend on any
/// PATH-resolvable shim. The bundled DataProviderMigrate binary is spawned by
/// absolute path, so emptying PATH for the call must not affect it, while any
/// surviving bare-name spawn would ENOENT.

import { describe, it, afterEach } from "node:test";
import assert from "node:assert";
import { existsSync } from "node:fs";

import type { Result } from "too-many-cooks-core";
import { applyMigrations } from "../src/migrate.js";
import { deleteIfExists } from "./support/fs_helpers.js";
import { assertTablesPresent } from "./support/sqlite_rows.js";

const TEST_DB_PATH: string = ".test_migrate_no_path_shim.db";

/** Env key for the executable search path (case-insensitive on win32). */
const PATH_KEY: string = "PATH";


/** Run applyMigrations with PATH emptied, restoring it afterwards. */
const migrateWithoutPath = (dbPath: string): Result<void, string> => {
  const savedPath: string | undefined = process.env[PATH_KEY];
  process.env[PATH_KEY] = "";
  try {
    return applyMigrations(dbPath);
  } finally {
    process.env[PATH_KEY] = savedPath ?? "";
  }
};

describe("schema migration must not depend on PATH-resolvable shims", () => {
  afterEach(() => {
    deleteIfExists(TEST_DB_PATH);
  });

  it("applyMigrations succeeds when PATH is empty (regression: spawnSync npx ENOENT on Windows)", () => {
    const result: Result<void, string> = migrateWithoutPath(TEST_DB_PATH);

    assert.strictEqual(result.ok, true, `applyMigrations must succeed without PATH, got: ${result.ok ? "" : result.error}`);
    assert.ok(existsSync(TEST_DB_PATH), `DB file must exist after applyMigrations: ${TEST_DB_PATH}`);
    assertTablesPresent(TEST_DB_PATH, "After migration,");
  });
});
