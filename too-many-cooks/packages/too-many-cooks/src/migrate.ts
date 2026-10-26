/// [DB-MIGRATE] Applies schema/tmc-schema.yaml to a SQLite database with the
/// bundled DataProviderMigrate CLI. The CLI inspects the live DB, diffs it
/// against the YAML and applies only the difference, so it creates a fresh DB
/// and repairs drift (missing tables/columns/indexes) from one source of truth.
/// The binary is spawned by absolute path — no npx, no PATH lookup — so it
/// works on Windows and inside `npx too-many-cooks` installs.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { error, type Result, success } from "too-many-cooks-core";

/** Candidate package dirs relative to this file: src/ (tsx), build/src/ (node),
 *  and the executable's own dir inside the single-executable bundle (sea.ts). */
const PKG_DIR_CANDIDATES: readonly string[] = ["..", "../..", "."];

/** Schema path relative to the package directory. */
const SCHEMA_REL: string = "schema/tmc-schema.yaml";

/** Directory holding per-platform CLI builds (filled by scripts/fetch-dataprovider.mjs). */
const BIN_DIR_REL: string = "dataprovider";

/** CLI executable base name. */
const BIN_NAME: string = "DataProviderMigrate";

/** Executable suffix on Windows. */
const WIN_EXE_SUFFIX: string = ".exe";

/** Node's platform id for Windows. */
const WIN_PLATFORM: NodeJS.Platform = "win32";

/** DataProvider provider id for SQLite. */
const PROVIDER_SQLITE: string = "sqlite";

/** Find the package directory that contains the schema YAML. */
const findPackageDir: () => string | undefined = (): string | undefined => {
  const here: string = fileURLToPath(new URL(".", import.meta.url));
  return PKG_DIR_CANDIDATES
    .map((rel: string): string => resolve(here, rel))
    .find((dir: string): boolean => existsSync(`${dir}/${SCHEMA_REL}`));
};

/** Absolute path of the CLI built for the running platform. */
const binaryPath: (pkgDir: string) => string = (pkgDir: string): string =>
  resolve(
    pkgDir,
    BIN_DIR_REL,
    `${process.platform}-${process.arch}`,
    process.platform === WIN_PLATFORM ? `${BIN_NAME}${WIN_EXE_SUFFIX}` : BIN_NAME,
  );

/** Run the CLI against `dbPath`. `--allow-destructive` lets it drop drifted
 *  objects: stale schemas are disposable (AGENTS.md: no legacy DB support). */
const runMigrate: (bin: string, schema: string, dbPath: string) => Result<void, string> = (
  bin: string,
  schema: string,
  dbPath: string,
): Result<void, string> => {
  try {
    execFileSync(
      bin,
      ["migrate", "--schema", schema, "--output", resolve(dbPath), "--provider", PROVIDER_SQLITE, "--allow-destructive"],
      { stdio: "pipe" },
    );
    return success(undefined);
  } catch (e: unknown) {
    return error(`${BIN_NAME} failed: ${String(e)}`);
  }
};

/** Migrate using the schema and CLI shipped in `pkgDir`. */
const migrateFromPackage: (pkgDir: string, dbPath: string) => Result<void, string> = (
  pkgDir: string,
  dbPath: string,
): Result<void, string> => {
  const bin: string = binaryPath(pkgDir);
  return existsSync(bin)
    ? runMigrate(bin, `${pkgDir}/${SCHEMA_REL}`, dbPath)
    : error(`${BIN_NAME} not bundled for ${process.platform}-${process.arch} (expected ${bin})`);
};

/** Create or repair the SQLite database at `dbPath` so it matches the YAML schema. */
export const applyMigrations: (dbPath: string) => Result<void, string> = (
  dbPath: string,
): Result<void, string> => {
  const pkgDir: string | undefined = findPackageDir();
  return pkgDir === undefined
    ? error(`Cannot locate ${SCHEMA_REL} — package layout is broken`)
    : migrateFromPackage(pkgDir, dbPath);
};
