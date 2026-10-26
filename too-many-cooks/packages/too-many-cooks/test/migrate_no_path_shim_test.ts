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
import { existsSync, unlinkSync } from "node:fs";
import Database from "better-sqlite3";

import type { Result } from "too-many-cooks-core";
import { applyMigrations } from "../src/migrate.js";

const TEST_DB_PATH: string = ".test_migrate_no_path_shim.db";

/** Env key for the executable search path (case-insensitive on win32). */
const PATH_KEY: string = "PATH";

/** Tables that must exist after a successful migration. */
const REQUIRED_TABLES: readonly string[] = [
  "identity",
  "locks",
  "messages",
  "message_reads",
  "plans",
];

const deleteIfExists = (path: string): void => {
  try {
    if (existsSync(path)) { unlinkSync(path); }
  } catch {
    // ignore
  }
};

const tableNames = (dbPath: string): readonly string[] => {
  const db: Database.Database = new Database(dbPath, { readonly: true });
  try {
    const rows: unknown[] = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all();
    return rows.flatMap((row: unknown): readonly string[] =>
      typeof row === "object" && row !== null && "name" in row && typeof row.name === "string"
        ? [row.name]
        : [],
    );
  } finally {
    db.close();
  }
};

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
    const present: readonly string[] = tableNames(TEST_DB_PATH);
    for (const required of REQUIRED_TABLES) {
      assert.ok(
        present.includes(required),
        `Table '${required}' must exist after migration. Got: ${present.join(", ")}`,
      );
    }
  });
});
