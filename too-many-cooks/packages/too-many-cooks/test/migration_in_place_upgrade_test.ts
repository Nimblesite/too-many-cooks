/// [DB-MIGRATE] Regression/behaviour test: applyMigrations must be a REAL
/// migration — given a database already at an earlier migration WITH data,
/// re-running it applies only the pending migration(s) and PRESERVES the data.
/// A nuke-and-recreate strategy would wipe the row and fail this test; a
/// subprocess `prisma db push` never records the applied migrations in
/// `_prisma_migrations`, so the tracking assertions fail against it too.
///
/// This is the black-box proof of the user requirement: "check the current
/// state of the schema and upgrade to the current schema" — in place.

import { describe, it, afterEach } from "node:test";
import assert from "node:assert";
import { existsSync, readFileSync, readdirSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import Database from "better-sqlite3";

import { applyMigrations } from "../src/migrate.js";

const TEST_DB_PATH: string = ".test_migration_in_place.db";
const MIGRATIONS_DIR: string = resolve(import.meta.dirname, "../prisma/migrations");
const MESSAGE_ID: string = "preserved-msg-1";
const MESSAGE_CONTENT: string = "this row must survive the upgrade";
const KEEPER: string = "keeper-agent";

/** Prisma's own migration-tracking table (mirrors `prisma migrate deploy`). */
const PRISMA_MIGRATIONS_DDL: string = `
  CREATE TABLE "_prisma_migrations" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "checksum" TEXT NOT NULL,
    "finished_at" DATETIME,
    "migration_name" TEXT NOT NULL,
    "logs" TEXT,
    "rolled_back_at" DATETIME,
    "started_at" DATETIME NOT NULL DEFAULT current_timestamp,
    "applied_steps_count" INTEGER UNSIGNED NOT NULL DEFAULT 0
  );`;

const deleteIfExists = (path: string): void => {
  try { if (existsSync(path)) { unlinkSync(path); } } catch { /* ignore */ }
};

/** Sorted migration folder names (oldest first). */
const migrationNames = (): readonly string[] =>
  readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e): boolean => e.isDirectory())
    .map((e): string => e.name)
    .sort();

const migrationSql = (name: string): string =>
  readFileSync(resolve(MIGRATIONS_DIR, name, "migration.sql"), "utf8");

/** Build a DB that is at the FIRST migration only, then insert a data row. */
const seedAtFirstMigration = (dbPath: string, firstName: string): void => {
  const db: Database.Database = new Database(dbPath);
  try {
    db.exec(migrationSql(firstName));
    db.exec(PRISMA_MIGRATIONS_DDL);
    db.prepare(
      `INSERT INTO "_prisma_migrations" ("id","checksum","migration_name","finished_at","applied_steps_count")
       VALUES (?, ?, ?, current_timestamp, 1)`,
    ).run("seed-id", "seed-checksum", firstName);
    db.prepare(
      `INSERT INTO identity (agent_name, agent_key, active, registered_at, last_active) VALUES (?, ?, 1, ?, ?)`,
    ).run(KEEPER, "seed-key", 1, 1);
    db.prepare(
      `INSERT INTO messages (id, from_agent, to_agent, content, created_at) VALUES (?, ?, ?, ?, ?)`,
    ).run(MESSAGE_ID, KEEPER, KEEPER, MESSAGE_CONTENT, 1);
  } finally {
    db.close();
  }
};

const messageContent = (dbPath: string, id: string): string | undefined => {
  const db: Database.Database = new Database(dbPath, { readonly: true });
  try {
    const row: unknown = db.prepare("SELECT content FROM messages WHERE id = ?").get(id);
    return typeof row === "object" && row !== null && "content" in row && typeof row.content === "string"
      ? row.content
      : undefined;
  } finally { db.close(); }
};

const messagesDdl = (dbPath: string): string => {
  const db: Database.Database = new Database(dbPath, { readonly: true });
  try {
    const row: unknown = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'messages'").get();
    return typeof row === "object" && row !== null && "sql" in row && typeof row.sql === "string" ? row.sql : "";
  } finally { db.close(); }
};

const appliedMigrations = (dbPath: string): readonly string[] => {
  const db: Database.Database = new Database(dbPath, { readonly: true });
  try {
    const rows: unknown[] = db
      .prepare("SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name")
      .all();
    return rows.flatMap((r): readonly string[] =>
      typeof r === "object" && r !== null && "migration_name" in r && typeof r.migration_name === "string"
        ? [r.migration_name]
        : [],
    );
  } finally { db.close(); }
};

describe("in-place migration preserves data and records history", () => {
  afterEach(() => { deleteIfExists(TEST_DB_PATH); });

  it("upgrades a DB from the first migration to the latest without losing rows", () => {
    const names: readonly string[] = migrationNames();
    assert.ok(names.length >= 2, `precondition: expected >= 2 migrations, got: ${names.join(", ")}`);
    const [first]: readonly string[] = names;
    if (first === undefined) { return; }

    seedAtFirstMigration(TEST_DB_PATH, first);
    assert.doesNotMatch(
      messagesDdl(TEST_DB_PATH),
      /messages_to_agent_fkey/u,
      "precondition: first migration must not yet have the to_agent FK",
    );

    // Upgrade in place.
    applyMigrations(TEST_DB_PATH);

    // 1. Data survived (proves in-place migration, NOT nuke-and-recreate).
    assert.strictEqual(
      messageContent(TEST_DB_PATH, MESSAGE_ID),
      MESSAGE_CONTENT,
      "the pre-existing message row must survive the in-place upgrade",
    );
    // 2. The pending migration was actually applied (to_agent cascade present).
    assert.match(
      messagesDdl(TEST_DB_PATH),
      /messages_to_agent_fkey[\s\S]*ON DELETE CASCADE/u,
      "the to_agent cascade migration must have been applied",
    );
    // 3. History records every migration as applied.
    assert.deepStrictEqual(
      appliedMigrations(TEST_DB_PATH),
      [...names].sort(),
      "every migration must be recorded in _prisma_migrations",
    );
  });
});
