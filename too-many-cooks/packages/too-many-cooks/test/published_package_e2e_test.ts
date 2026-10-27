/// E2E test: boots the REAL published artifact, not the source tree.
///
/// Why this exists: every other test in this suite runs against the source
/// (tsx + node_modules layout), so they cannot detect bugs in the npm
/// tarball — missing files from package.json `files`, devDependencies that
/// production needs at runtime, migration binaries that never made it into
/// the tarball. The shipped artifact has a different shape
/// than the source tree, so it MUST be tested as a black box.
///
/// What it does:
///   1. `npm pack` the package as it would be published.
///   2. `npm install` the tarball into a throwaway prefix dir.
///   3. Spawn `node node_modules/too-many-cooks/build/bin/server.js`
///      (no tsx, no source paths — exactly what a real user runs).
///   4. Assert the server starts, the DB exists, the schema is correct,
///      and [DB-MIGRATE] DataProviderMigrate schema repair works after corruption.
///
/// If this passes locally, `npm install -g too-many-cooks@<version>` works.
/// If it fails, do not publish.

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { nonEmptyLines } from "./support/text.js";
import {
  assertColumnAbsent,
  assertColumnPresent,
  assertTablesPresent,
  columnNamesOf,
  dropColumn,
} from "./support/sqlite_rows.js";

// ============================================================================
// Constants
// ============================================================================

/** Directory of the package under test (the one we pack and install). */
const PACKAGE_DIR: string = resolve(import.meta.dirname, "..");

/** too-many-cooks-core: released alongside the server at the same stamped
 *  version, so it is packed and installed from THIS tree, never the registry. */
const CORE_DIR: string = resolve(PACKAGE_DIR, "..", "core");

/** Prefix for the throwaway install dir under the OS temp directory. */
const INSTALL_PREFIX: string = "tmc-pubpkg-";

/** Prefix for the throwaway workspace dir (where data.db lives). */
const WORKSPACE_PREFIX: string = "tmc-pubpkg-ws-";

/** Prefix for the isolated npm cache dir (see `installTarballs`). */
const CACHE_PREFIX: string = "tmc-pubpkg-cache-";

/** Name of the published package — must match package.json `name`. */
const PACKAGE_NAME: string = "too-many-cooks";

/** Path inside the install where the server bin lives. */
const BIN_REL_PATH: string = "node_modules/too-many-cooks/build/bin/server.js";

/** Path inside the install where the DataProvider YAML schema lives. */
const SCHEMA_REL_PATH: string = "node_modules/too-many-cooks/schema/tmc-schema.yaml";

/** Path of the DataProvider YAML schema inside the packed tarball. */
const SCHEMA_TARBALL_SUFFIX: string = "schema/tmc-schema.yaml";

/** Where prisma would land if it were still a runtime dependency. It must NOT
 *  be: runtime `npx prisma` broke Windows installs (spawnSync npx ENOENT). */
const PRISMA_RUNTIME_REL_PATH: string = "node_modules/prisma/package.json";

/** Bundled DataProviderMigrate executables, one per supported platform. */
const MIGRATE_BIN_TARBALL_PATHS: readonly string[] = [
  "dataprovider/darwin-arm64/DataProviderMigrate",
  "dataprovider/darwin-x64/DataProviderMigrate",
  "dataprovider/linux-x64/DataProviderMigrate",
  "dataprovider/win32-x64/DataProviderMigrate.exe",
];

/** Workspace-relative directory that holds the database. */
const DATA_DIR_NAME: string = ".too_many_cooks";

/** Workspace-relative path to the SQLite database file. */
const DB_REL_PATH: string = `${DATA_DIR_NAME}/data.db`;

/** Port the spawned server listens on. Fixed; the suite boots one server at a
 *  time and kills it before the next, so the port is free each boot. The server
 *  never takes over a busy port ([SERVER-NO-KILL]) — it would step aside. */
const PORT: number = 4067;

/** Polling tuning for the readiness probe. */
const POLL_INTERVAL_MS: number = 200;
const MAX_POLL_ATTEMPTS: number = 150; // 30s total — npm install + native build is slow

/** Column we drop to prove DataProviderMigrate repairs drift. */
const DRIFT_TABLE: string = "locks";
const DRIFT_COLUMN: string = "reason";

/** Column the rebuild must restore on the identity table. */
const IDENTITY_TABLE: string = "identity";
const IDENTITY_KEY_COLUMN: string = "agent_key";

/** HTTP status code expected from /admin/status. */
const HTTP_OK: number = 200;

/** Forbidden files in the published tarball: Prisma is gone ([DB-MIGRATE]);
 *  prisma.config.ts also broke 0.8.0 (`prisma/config` unresolvable). */
const FORBIDDEN_TARBALL_PATHS: readonly string[] = ["prisma.config.ts", "schema.prisma"];

// ============================================================================
// Fixture state — populated by before()
// ============================================================================

type Fixture = {
  readonly tarballPath: string;
  readonly coreTarballPath: string;
  readonly installDir: string;
};

let fixture: Fixture | undefined;

// ============================================================================
// Helpers
// ============================================================================

const packTarball = (packageDir: string): string => {
  // `npm pack --json` writes the metadata to stdout; the tarball is in cwd.
  const out: string = execFileSync(
    "npm",
    ["pack", "--silent", "--pack-destination", packageDir],
    { cwd: packageDir, encoding: "utf8" },
  ).trim();
  // npm pack prints the filename relative to --pack-destination on the last
  // non-empty line. Resolve to an absolute path.
  const file: string | undefined = nonEmptyLines(out).pop();
  if (file === undefined) {
    throw new Error("npm pack produced no output");
  }
  return resolve(packageDir, file);
};

const installTarballs = (tarballs: readonly string[]): string => {
  const dir: string = mkdtempSync(join(tmpdir(), INSTALL_PREFIX));
  // Isolated npm cache so the resolver MUST go to the registry. With the
  // shared system cache, `--prefer-offline` (or even default behaviour after
  // a stale cache) can resurrect old transitive versions whose native
  // prebuilds don't match the current Node ABI — that's the failure mode
  // that bit `npx too-many-cooks` in the wild. A fresh cache reproduces a
  // first-time user's resolve.
  const cacheDir: string = mkdtempSync(join(tmpdir(), CACHE_PREFIX));
  execFileSync("npm", ["init", "-y"], { cwd: dir, stdio: "pipe" });
  execFileSync(
    "npm",
    [
      "install",
      "--no-audit",
      "--no-fund",
      "--prefer-online",
      `--cache=${cacheDir}`,
      ...tarballs,
    ],
    { cwd: dir, stdio: "pipe" },
  );
  return dir;
};

const spawnInstalledBin = (installDir: string, workspace: string): ChildProcess => {
  const bin: string = join(installDir, BIN_REL_PATH);
  if (!existsSync(bin)) {
    throw new Error(`bin missing from installed package: ${bin}`);
  }
  return spawn("node", [bin], {
    cwd: installDir,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      TMC_PORT: String(PORT),
      TMC_WORKSPACE: workspace,
    },
  });
};

const pollUntilReady = async (port: number, proc: ChildProcess): Promise<void> => {
  let stderr: string = "";
  proc.stderr?.on("data", (chunk: Buffer): void => {
    stderr += chunk.toString();
  });
  const url: string = `http://127.0.0.1:${String(port)}/admin/status`;
  for (let i: number = 0; i < MAX_POLL_ATTEMPTS; i++) {
    if (proc.exitCode !== null) {
      throw new Error(
        `Spawned bin exited early with code ${String(proc.exitCode)}.\nstderr:\n${stderr}`,
      );
    }
    try {
      const r: Response = await fetch(url);
      if (r.ok) { return; }
    } catch {
      // Not ready yet
    }
    await new Promise<void>((res: () => void): void => {
      setTimeout(res, POLL_INTERVAL_MS);
    });
  }
  throw new Error(
    `Server never became ready on port ${String(port)} after ${String(MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS)}ms.\nstderr:\n${stderr}`,
  );
};

const killAndWait = async (proc: ChildProcess): Promise<void> => {
  if (proc.exitCode !== null) { return; }
  proc.kill("SIGTERM");
  await new Promise<void>((res: () => void): void => {
    proc.on("exit", (): void => { res(); });
    setTimeout(res, 2000);
  });
};

/** Boots the installed bin on `workspace` until ready, then stops it. */
const bootAndWait = async (installDir: string, workspace: string): Promise<void> => {
  const proc: ChildProcess = spawnInstalledBin(installDir, workspace);
  try {
    await pollUntilReady(PORT, proc);
  } finally {
    await killAndWait(proc);
  }
};

/** A throwaway workspace with its data dir created; returns both paths. */
const newWorkspace = (): { readonly workspace: string; readonly dbPath: string } => {
  const workspace: string = mkdtempSync(join(tmpdir(), WORKSPACE_PREFIX));
  mkdirSync(join(workspace, DATA_DIR_NAME), { recursive: true });
  return { workspace, dbPath: join(workspace, DB_REL_PATH) };
};

const tarballEntries = (tarball: string): readonly string[] => {
  const out: string = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" });
  return nonEmptyLines(out);
};

/** Entries of the packed tarball whose path ends with `suffix`. */
const tarballEntriesEndingWith = (suffix: string): readonly string[] => {
  const fx: Fixture = requireFixture();
  return tarballEntries(fx.tarballPath).filter((entry: string): boolean => entry.endsWith(suffix));
};

/** Asserts the packed tarball ships an entry whose path ends with `suffix`. */
const assertTarballContains = (suffix: string, message: string): void => {
  assert.notStrictEqual(tarballEntriesEndingWith(suffix).length, 0, message);
};

const requireFixture = (): Fixture => {
  if (fixture === undefined) {
    throw new Error("fixture not initialised — before() did not run");
  }
  return fixture;
};

// ============================================================================
// Fixture lifecycle
// ============================================================================

describe("published package: tarball + install + boot", () => {
  before((): void => {
    const coreTarballPath: string = packTarball(CORE_DIR);
    const tarballPath: string = packTarball(PACKAGE_DIR);
    const installDir: string = installTarballs([coreTarballPath, tarballPath]);
    fixture = { tarballPath, coreTarballPath, installDir };
  });

  after((): void => {
    if (fixture === undefined) { return; }
    rmSync(fixture.installDir, { recursive: true, force: true });
    rmSync(fixture.tarballPath, { force: true });
    rmSync(fixture.coreTarballPath, { force: true });
    fixture = undefined;
  });

  // --------------------------------------------------------------------------
  // Static asserts on the tarball itself
  // --------------------------------------------------------------------------

  it("tarball does NOT contain Prisma files (regression: 0.8.0 shipped prisma.config.ts and broke `npx prisma`)", (): void => {
    for (const forbidden of FORBIDDEN_TARBALL_PATHS) {
      const hits: readonly string[] = tarballEntriesEndingWith(`/${forbidden}`);
      assert.deepStrictEqual(
        hits,
        [],
        `Tarball MUST NOT contain ${forbidden} (Prisma was replaced by DataProvider). Got: ${hits.join(", ")}`,
      );
    }
  });

  it("tarball contains the DataProvider YAML schema", (): void => {
    assertTarballContains(SCHEMA_TARBALL_SUFFIX, "Tarball MUST contain schema/tmc-schema.yaml");
  });

  it("tarball bundles DataProviderMigrate for every supported platform (the VSIX must boot offline)", (): void => {
    for (const bin of MIGRATE_BIN_TARBALL_PATHS) {
      assertTarballContains(`/${bin}`, `Tarball MUST contain ${bin}`);
    }
  });

  it("tarball contains the bin entry point", (): void => {
    assertTarballContains("build/bin/server.js", "Tarball MUST contain build/bin/server.js");
  });

  // --------------------------------------------------------------------------
  // Installed-tree asserts (proves npm install resolves runtime deps)
  // --------------------------------------------------------------------------

  it("install does NOT pull in `prisma` (migrations run via the bundled DataProviderMigrate)", (): void => {
    const fx: Fixture = requireFixture();
    const p: string = join(fx.installDir, PRISMA_RUNTIME_REL_PATH);
    assert.ok(
      !existsSync(p),
      `prisma must NOT be a runtime dependency — the server migrates with DataProviderMigrate. Found: ${p}`,
    );
  });

  it("installed package has the YAML schema at the path migrate.ts expects", (): void => {
    const fx: Fixture = requireFixture();
    const p: string = join(fx.installDir, SCHEMA_REL_PATH);
    assert.ok(existsSync(p), `Schema must exist at install-relative ${SCHEMA_REL_PATH}`);
  });

  // --------------------------------------------------------------------------
  // Boot the bin and prove migrations ran
  // --------------------------------------------------------------------------

  it("spawning the installed bin creates the DB with the full schema", async (): Promise<void> => {
    const fx: Fixture = requireFixture();
    const { workspace, dbPath } = newWorkspace();
    const proc: ChildProcess = spawnInstalledBin(fx.installDir, workspace);
    try {
      await pollUntilReady(PORT, proc);
      assert.ok(existsSync(dbPath), `DB file must exist after boot: ${dbPath}`);

      assertTablesPresent(dbPath, "After migration,");

      const status: Response = await fetch(`http://127.0.0.1:${String(PORT)}/admin/status`);
      assert.strictEqual(status.status, HTTP_OK, "/admin/status must return 200 after boot");
    } finally {
      await killAndWait(proc);
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // The schema-repair contract — DataProviderMigrate patches drift
  // --------------------------------------------------------------------------

  it("re-spawning the bin after dropping a column restores the column via DataProviderMigrate", async (): Promise<void> => {
    const fx: Fixture = requireFixture();
    const { workspace, dbPath } = newWorkspace();

    // First boot — schema gets created.
    await bootAndWait(fx.installDir, workspace);
    assertColumnPresent(dbPath, DRIFT_TABLE, DRIFT_COLUMN, "precondition after first boot");

    // Corrupt the schema by dropping a column out-of-band.
    dropColumn(dbPath, DRIFT_TABLE, DRIFT_COLUMN);
    assertColumnAbsent(dbPath, DRIFT_TABLE, DRIFT_COLUMN, "setup after DROP COLUMN");

    // Second boot — DataProviderMigrate must repair the drift.
    await bootAndWait(fx.installDir, workspace);
    assertColumnPresent(dbPath, DRIFT_TABLE, DRIFT_COLUMN, "DataProviderMigrate on the published bin");

    rmSync(workspace, { recursive: true, force: true });
  });

  // --------------------------------------------------------------------------
  // Stale-DB rebuild — when migration fails, the bin must nuke + retry
  // --------------------------------------------------------------------------

  it("booting against a wildly stale DB still ends up with a correct schema", async (): Promise<void> => {
    const fx: Fixture = requireFixture();
    const { workspace, dbPath } = newWorkspace();

    // Seed a stale DB whose schema can't be patched into the new one.
    const seed: Database.Database = new Database(dbPath);
    try {
      seed.exec(`CREATE TABLE ${IDENTITY_TABLE} (agent_name TEXT PRIMARY KEY, garbage INTEGER NOT NULL);`);
    } finally {
      seed.close();
    }
    assert.deepStrictEqual(columnNamesOf(dbPath, IDENTITY_TABLE), ["agent_name", "garbage"]);

    await bootAndWait(fx.installDir, workspace);
    assertTablesPresent(dbPath, "After stale-DB recovery,");
    assertColumnPresent(dbPath, IDENTITY_TABLE, IDENTITY_KEY_COLUMN, "After rebuild");

    rmSync(workspace, { recursive: true, force: true });
  });

  // --------------------------------------------------------------------------
  // Hygiene: no stray .tgz files left in the package dir
  // --------------------------------------------------------------------------

  it("packing did not leave stray tarballs in the package dir", (): void => {
    const stray: readonly string[] = readdirSync(PACKAGE_DIR)
      .filter((f: string): boolean => f.startsWith(`${PACKAGE_NAME}-`) && f.endsWith(".tgz"));
    const fx: Fixture = requireFixture();
    const expected: string = fx.tarballPath.split("/").pop() ?? "";
    const others: readonly string[] = stray.filter((f: string): boolean => f !== expected);
    assert.deepStrictEqual(
      others,
      [],
      `Only the test's own tarball is allowed in the package dir; found stray: ${others.join(", ")}`,
    );
  });
});
