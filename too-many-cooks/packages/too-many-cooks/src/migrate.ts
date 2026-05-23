/// Applies Prisma migrations to a SQLite database via `prisma migrate deploy`.
/// Migrations live in prisma/migrations/ and ship with the published package
/// (see package.json "files"). No raw SQL execution from this module — Prisma's
/// migration engine owns schema application end-to-end (CLAUDE.md: PRISMA ONLY).

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

/** Apply all pending Prisma migrations to the SQLite database at `dbPath`.
 *  Delegates to `prisma migrate deploy`, which uses Prisma's migration engine
 *  to apply migrations from prisma/migrations/ transactionally.
 *  Throws on any failure. Callers (db-sqlite.tryCreateDb) recover by deleting
 *  the DB file and retrying. */
export const applyMigrations: (dbPath: string) => void = (dbPath: string): void => {
  const pkgDir: string = findPackageDir();
  const schemaPath: string = `${pkgDir}/${SCHEMA_REL}`;
  execFileSync(
    "npx",
    ["prisma", "migrate", "deploy", `--schema=${schemaPath}`],
    {
      cwd: pkgDir,
      env: { ...process.env, DATABASE_URL: resolve(dbPath) },
      stdio: "pipe",
    },
  );
};
