/// Applies the Prisma schema to a SQLite database via `prisma db push`.
/// `db push` diffs schema.prisma against the live DB and patches drift —
/// missing tables/columns/indexes get added without needing migration history.
/// That's why we use Prisma: schema repair from a single source of truth.
/// No raw SQL execution from this module (CLAUDE.md: PRISMA ONLY).

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Candidate directories (relative to this file) that contain prisma/schema.prisma. */
const PKG_DIR_CANDIDATES: readonly string[] = ["..", "../.."];

/** Path segment for the Prisma schema relative to the package directory. */
const SCHEMA_REL: string = "prisma/schema.prisma";

/** Find the package directory that contains prisma/schema.prisma. Works from src/ (tsx dev) and build/src/ (node). */
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

/** Sync the SQLite database at `dbPath` to match `prisma/schema.prisma`.
 *  Delegates to `prisma db push --accept-data-loss`, which patches schema
 *  drift (missing tables, missing columns, etc.) without needing migration
 *  history. `--accept-data-loss` is required because dropping/retyping a
 *  column is a destructive op; this codebase treats stale schemas as
 *  disposable (CLAUDE.md: no legacy DB support).
 *  The DB URL is passed via `--url` because schema.prisma intentionally has
 *  no `url = env(...)` line — Prisma 7 demands the URL come from either a
 *  prisma.config.ts file or the CLI flag, and we ship neither in the
 *  published package.
 *  Throws on any failure. Callers (db-sqlite.tryCreateDb) recover by
 *  deleting the DB file and retrying. */
export const applyMigrations: (dbPath: string) => void = (dbPath: string): void => {
  const pkgDir: string = findPackageDir();
  const schemaPath: string = `${pkgDir}/${SCHEMA_REL}`;
  execFileSync(
    "npx",
    [
      "prisma",
      "db",
      "push",
      "--accept-data-loss",
      `--schema=${schemaPath}`,
      `--url=file:${resolve(dbPath)}`,
    ],
    {
      cwd: pkgDir,
      stdio: "pipe",
    },
  );
};
