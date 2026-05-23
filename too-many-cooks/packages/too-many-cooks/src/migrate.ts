/// Applies embedded Prisma migrations to a SQLite database using better-sqlite3.
/// Migration SQL is baked into the published package via scripts/gen-migrations.mjs,
/// so no `npx prisma` invocation and no on-disk schema lookup is needed at runtime.

import { createHash, randomUUID } from "node:crypto";

import type Database from "better-sqlite3";

import type { Migration } from "./migrations.gen.js";
import { MIGRATIONS } from "./migrations.gen.js";

/** SQL to create Prisma's migration tracking table. */
const CREATE_MIGRATIONS_TABLE: string = `
CREATE TABLE IF NOT EXISTS _prisma_migrations (
  id TEXT PRIMARY KEY NOT NULL,
  checksum TEXT NOT NULL,
  finished_at DATETIME,
  migration_name TEXT NOT NULL,
  logs TEXT,
  rolled_back_at DATETIME,
  started_at DATETIME NOT NULL DEFAULT current_timestamp,
  applied_steps_count INTEGER NOT NULL DEFAULT 0
)`;

/** Simple deterministic checksum for migration tracking using SHA-256. */
const checksum: (sql: string) => string = (sql: string): string =>
  createHash("sha256").update(sql, "utf8").digest("hex");

/** Check whether a migration has already been applied. */
const isApplied: (db: Database.Database, name: string) => boolean = (db: Database.Database, name: string): boolean =>
  db.prepare("SELECT id FROM _prisma_migrations WHERE migration_name = ? AND finished_at IS NOT NULL")
    .get(name) !== undefined;

/** Record a successfully applied migration. */
const recordMigration: (db: Database.Database, name: string, sql: string) => void = (
  db: Database.Database,
  name: string,
  sql: string,
): void => {
  db.prepare(
    "INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, applied_steps_count) VALUES (?, ?, datetime('now'), ?, 1)",
  ).run(randomUUID(), checksum(sql), name);
};

/** Apply all pending embedded migrations to the database.
 *  Throws on any conflict (e.g. tables already exist from a stale schema).
 *  Callers (db-sqlite.tryCreateDb) recover by deleting the DB file and retrying. */
export const applyMigrations: (db: Database.Database) => void = (db: Database.Database): void => {
  db.exec(CREATE_MIGRATIONS_TABLE);
  const pending: readonly Migration[] = MIGRATIONS.filter(
    ({ name }: Migration): boolean => !isApplied(db, name),
  );
  for (const { name, sql } of pending) {
    db.exec(sql);
    recordMigration(db, name, sql);
  }
};
