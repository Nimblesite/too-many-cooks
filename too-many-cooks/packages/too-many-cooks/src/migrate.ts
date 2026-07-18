/// [DB-MIGRATE] Applies Prisma migration files to a SQLite database IN-PROCESS
/// via the better-sqlite3 driver — no child process, no `prisma` executable, no
/// npx. This is a real migration runner: it reads prisma/migrations/<name>/
/// migration.sql, tracks applied migrations in `_prisma_migrations` (the same
/// table `prisma migrate deploy` uses), and applies only the pending ones in
/// order. It preserves existing data (each Prisma migration carries its own
/// data-copy SQL for table rebuilds).
///
/// [DB-MIGRATE-DRIFT] After applying, the live schema is compared against an
/// in-memory oracle built by replaying the same migrations on `:memory:`. If
/// the live DB was mangled out-of-band (a column dropped, a table rebuilt), the
/// snapshots differ and applyMigrations throws so the caller rebuilds from
/// scratch (CLAUDE.md: no legacy DB support — nuke and recreate).

import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, type Dirent } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Candidate directories (relative to this file) that contain the prisma dir. */
const PKG_DIR_CANDIDATES: readonly string[] = ["..", "../.."];

/** Path segment for the Prisma schema relative to the package directory. */
const SCHEMA_REL: string = "prisma/schema.prisma";

/** Path segment for the Prisma migrations directory. */
const MIGRATIONS_REL: string = "prisma/migrations";

/** File name of each migration's SQL within its folder. */
const MIGRATION_FILE: string = "migration.sql";

/** Prisma's migration-tracking table (shared with `prisma migrate deploy`). */
const PRISMA_MIGRATIONS_TABLE: string = "_prisma_migrations";

/** DDL for the tracking table — identical shape to Prisma's own. */
const PRISMA_MIGRATIONS_DDL: string = `
  CREATE TABLE IF NOT EXISTS "${PRISMA_MIGRATIONS_TABLE}" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "checksum" TEXT NOT NULL,
    "finished_at" DATETIME,
    "migration_name" TEXT NOT NULL,
    "logs" TEXT,
    "rolled_back_at" DATETIME,
    "started_at" DATETIME NOT NULL DEFAULT current_timestamp,
    "applied_steps_count" INTEGER UNSIGNED NOT NULL DEFAULT 0
  );`;

/** One migration folder: its ordering name and SQL body. */
type Migration = {
  readonly name: string;
  readonly sql: string;
  readonly checksum: string;
};

/** Find the package directory that contains prisma/. Works from src/ (tsx dev) and build/src/ (node). */
const findPackageDir: () => string = (): string => {
  const here: string = fileURLToPath(new URL(".", import.meta.url));
  const found: string | undefined = PKG_DIR_CANDIDATES
    .map((rel: string): string => resolve(here, rel))
    .find((dir: string): boolean => existsSync(`${dir}/${SCHEMA_REL}`));
  if (found === undefined) {
    throw new Error(`Cannot locate ${SCHEMA_REL} — package layout is broken`);
  }
  return found;
};

/** Load every migration folder, sorted oldest-first (Prisma names are timestamp-prefixed). */
const loadMigrations: (pkgDir: string) => readonly Migration[] = (
  pkgDir: string,
): readonly Migration[] => {
  const dir: string = resolve(pkgDir, MIGRATIONS_REL);
  const names: readonly string[] = readdirSync(dir, { withFileTypes: true })
    .filter((entry: Dirent): boolean => entry.isDirectory())
    .map((entry: Dirent): string => entry.name)
    .sort();
  return names.map((name: string): Migration => {
    const sql: string = readFileSync(resolve(dir, name, MIGRATION_FILE), "utf8");
    return { name, sql, checksum: createHash("sha256").update(sql).digest("hex") };
  });
};

/** Normalised snapshot of a DB's user schema (tables + indexes), excluding the
 *  tracking table. Two DBs built from the same migrations produce equal strings;
 *  any out-of-band drift makes them differ. */
const schemaSnapshot: (db: Database.Database) => string = (
  db: Database.Database,
): string => {
  const rows: unknown[] = db
    .prepare(
      "SELECT name, sql FROM sqlite_master WHERE type IN ('table','index') " +
        "AND name NOT LIKE 'sqlite_%' AND name != ? ORDER BY name",
    )
    .all(PRISMA_MIGRATIONS_TABLE);
  return rows
    .flatMap((row: unknown): readonly string[] => {
      if (typeof row !== "object" || row === null || !("name" in row) || !("sql" in row)) { return []; }
      const { name, sql }: { name: unknown; sql: unknown } = row;
      return typeof sql === "string"
        ? [`${String(name)}::${sql.replace(/\s+/gu, " ").trim()}`]
        : [];
    })
    .join("\n");
};

/** Apply one migration's SQL and record it, atomically. Prisma's SQLite
 *  rebuilds rely on `PRAGMA defer_foreign_keys=ON` (transaction-scoped), so the
 *  whole migration runs inside a single transaction. */
const applyOne: (db: Database.Database, migration: Migration) => void = (
  db: Database.Database,
  migration: Migration,
): void => {
  const now: string = new Date().toISOString();
  db.transaction((): void => {
    db.exec(migration.sql);
    db.prepare(
      `INSERT INTO "${PRISMA_MIGRATIONS_TABLE}" ` +
        `("id","checksum","migration_name","started_at","finished_at","applied_steps_count") ` +
        "VALUES (?, ?, ?, ?, ?, 1)",
    ).run(randomUUID(), migration.checksum, migration.name, now, now);
  })();
};

/** Names of migrations already recorded as finished. */
const appliedNames: (db: Database.Database) => Set<string> = (
  db: Database.Database,
): Set<string> => {
  const rows: unknown[] = db
    .prepare(`SELECT migration_name FROM "${PRISMA_MIGRATIONS_TABLE}" WHERE finished_at IS NOT NULL`)
    .all();
  return new Set(
    rows.flatMap((row: unknown): readonly string[] =>
      typeof row === "object" && row !== null && "migration_name" in row && typeof row.migration_name === "string"
        ? [row.migration_name]
        : [],
    ),
  );
};

/** Record every migration as applied without running it — used to baseline a DB
 *  whose schema already matches the target (e.g. one created before tracking existed). */
const baselineAll: (db: Database.Database, migrations: readonly Migration[]) => void = (
  db: Database.Database,
  migrations: readonly Migration[],
): void => {
  const now: string = new Date().toISOString();
  const stmt: Database.Statement = db.prepare(
    `INSERT INTO "${PRISMA_MIGRATIONS_TABLE}" ` +
      `("id","checksum","migration_name","started_at","finished_at","applied_steps_count") ` +
      "VALUES (?, ?, ?, ?, ?, 1)",
  );
  db.transaction((): void => {
    for (const m of migrations) { stmt.run(randomUUID(), m.checksum, m.name, now, now); }
  })();
};

/** Build the target schema by replaying every migration on an in-memory DB. */
const expectedSnapshot: (migrations: readonly Migration[]) => string = (
  migrations: readonly Migration[],
): string => {
  const mem: Database.Database = new Database(":memory:");
  try {
    for (const m of migrations) { mem.exec(m.sql); }
    return schemaSnapshot(mem);
  } finally {
    mem.close();
  }
};

/** Bring the SQLite database at `dbPath` up to the latest migration in-process.
 *  Throws on any failure (including detected out-of-band drift); callers
 *  (db-sqlite.tryCreateDb) recover by deleting the DB file and retrying, which
 *  re-runs every migration on a fresh database. */
export const applyMigrations: (dbPath: string) => void = (dbPath: string): void => {
  const migrations: readonly Migration[] = loadMigrations(findPackageDir());
  if (migrations.length === 0) {
    throw new Error(`No migrations found under ${MIGRATIONS_REL}`);
  }
  const expected: string = expectedSnapshot(migrations);
  const db: Database.Database = new Database(dbPath);
  try {
    db.exec(PRISMA_MIGRATIONS_DDL);
    const applied: Set<string> = appliedNames(db);
    if (applied.size === 0 && schemaSnapshot(db) === expected) {
      baselineAll(db, migrations);
      return;
    }
    for (const migration of migrations) {
      if (!applied.has(migration.name)) { applyOne(db, migration); }
    }
    if (schemaSnapshot(db) !== expected) {
      throw new Error("Schema drift detected after migrations — rebuild required");
    }
  } finally {
    db.close();
  }
};
