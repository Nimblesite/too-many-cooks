/// Applies Prisma-generated SQLite migrations using better-sqlite3.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";

import type Database from "better-sqlite3";

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

/** Directory of the compiled file — works from src/ (tsx) and build/src/ (node). */
const CURRENT_DIR: string = fileURLToPath(new URL(".", import.meta.url));

/** Locate the prisma/migrations directory relative to this file, or undefined if absent. */
const migrationsDir: () => string | undefined = (): string | undefined => {
  const candidates: string[] = [
    resolve(CURRENT_DIR, "..", "prisma", "migrations"),      // src/ (tsx dev)
    resolve(CURRENT_DIR, "..", "..", "prisma", "migrations"), // build/src/ (node)
  ];
  return candidates.find(existsSync);
};

/** Locate the packages/too-many-cooks directory (contains prisma/schema.prisma). */
const localPackageDir: () => string = (): string => {
  const candidates: string[] = [
    resolve(CURRENT_DIR, ".."),       // src/ (tsx dev)
    resolve(CURRENT_DIR, "..", ".."), // build/src/ (node)
  ];
  const found: string | undefined = candidates.find(
    (dir: string): boolean => existsSync(join(dir, "prisma", "schema.prisma")),
  );
  if (found === undefined) { throw new Error("Cannot find packages/too-many-cooks dir (prisma/schema.prisma not found)"); }
  return found;
};

/** True when migration files are present (production/committed migrations). */
export const hasMigrationsDir: () => boolean = (): boolean => migrationsDir() !== undefined;

/** Push the Prisma schema directly to the database — for dev/CI where migration files are not committed. */
export const pushSchemaViaPrisma: (dbPath: string) => void = (dbPath: string): void => {
  const pkgDir: string = localPackageDir();
  execFileSync("npx", ["prisma", "db", "push", "--accept-data-loss", `--url=file:${resolve(dbPath)}`], {
    cwd: pkgDir,
    env: { ...process.env },
    stdio: "pipe",
  });
};

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

/** True if the identity table already exists but no current migrations are recorded.
 *  Handles both pre-Prisma databases and databases where migrations were renamed. */
const hasPrePrismaSchema: (db: Database.Database, migrations: readonly string[]) => boolean = (
  db: Database.Database,
  migrations: readonly string[],
): boolean => {
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='identity'").get() === undefined) {
    return false;
  }
  if (db.prepare("SELECT 1 FROM _prisma_migrations LIMIT 1").get() === undefined) {
    return true;
  }
  // If none of the current migration names are recorded, the schema was created
  // by an older or renamed migration — treat as pre-Prisma and baseline.
  return migrations.every(
    (name: string): boolean =>
      db.prepare("SELECT 1 FROM _prisma_migrations WHERE migration_name = ?").get(name) === undefined,
  );
};

/** Baseline an existing pre-Prisma database by recording all migrations as applied. */
const baselineMigrations: (db: Database.Database, dir: string, names: readonly string[]) => void = (
  db: Database.Database,
  dir: string,
  names: readonly string[],
): void => {
  for (const name of names) {
    const sql: string = readFileSync(join(dir, name, "migration.sql"), "utf-8");
    recordMigration(db, name, sql);
  }
};

/** Apply all pending Prisma migrations to the database. No-op when no migrations dir exists (schema already pushed via prisma db push). */
export const applyMigrations: (db: Database.Database) => void = (db: Database.Database): void => {
  const dir: string | undefined = migrationsDir();
  if (dir === undefined) { return; }
  db.exec(CREATE_MIGRATIONS_TABLE);
  const migrations: string[] = readdirSync(dir)
    .filter((entry: string): boolean => existsSync(join(dir, entry, "migration.sql")))
    .sort();
  if (hasPrePrismaSchema(db, migrations)) { baselineMigrations(db, dir, migrations); return; }
  for (const name of migrations.filter((migName: string): boolean => !isApplied(db, migName))) {
    const sql: string = readFileSync(join(dir, name, "migration.sql"), "utf-8");
    db.exec(sql);
    recordMigration(db, name, sql);
  }
};
