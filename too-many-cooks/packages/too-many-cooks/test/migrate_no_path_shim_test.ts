/// Regression test: `npx too-many-cooks@latest` on Windows died at startup
/// with "Prisma migrate deploy failed: Error: spawnSync npx ENOENT".
///
/// Root cause: migrate.ts spawned the `npx` shim by bare name to run a Prisma
/// command. On Windows the shim is a `.cmd`/`.ps1` script that Node's spawn()
/// can only launch via a shell, so startup failed for every Windows install.
///
/// Contract under test: applying the schema must NOT spawn any process or
/// depend on a PATH-resolvable shim at all — the migration runner is fully
/// in-process (better-sqlite3 + the shipped migration.sql files). We prove it
/// by emptying PATH for the duration of the call: an in-process runner is
/// completely unaffected, while any surviving subprocess spawn would ENOENT.

import { describe, it, afterEach } from "node:test";
import assert from "node:assert";
import { existsSync, unlinkSync } from "node:fs";
import Database from "better-sqlite3";

import { applyMigrations } from "../src/migrate.js";

const TEST_DB_PATH: string = ".test_migrate_no_path_shim.db";

/** Env key for the executable search path. On win32 process.env keys are
 *  case-insensitive, so writing PATH also covers `Path`. */
const PATH_KEY: string = "PATH";

/** Tables that must exist after a successful schema push. */
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

describe("schema push must not depend on PATH-resolvable shims", () => {
  afterEach(() => {
    deleteIfExists(TEST_DB_PATH);
  });

  it("applyMigrations succeeds when no npx shim is reachable via PATH (regression: spawnSync npx ENOENT on Windows)", () => {
    const savedPath: string | undefined = process.env[PATH_KEY];
    process.env[PATH_KEY] = "";
    try {
      // Throws "spawnSync npx ENOENT" on the buggy implementation because the
      // `npx` shim cannot be found (Windows: never spawnable without a shell;
      // posix: unreachable once PATH is empty).
      applyMigrations(TEST_DB_PATH);
    } finally {
      if (savedPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env[PATH_KEY] = savedPath;
      }
    }

    assert.ok(
      existsSync(TEST_DB_PATH),
      `DB file must exist after applyMigrations: ${TEST_DB_PATH}`,
    );
    const present: readonly string[] = tableNames(TEST_DB_PATH);
    for (const required of REQUIRED_TABLES) {
      assert.ok(
        present.includes(required),
        `Table '${required}' must exist after schema push. Got: ${present.join(", ")}`,
      );
    }
  });
});
