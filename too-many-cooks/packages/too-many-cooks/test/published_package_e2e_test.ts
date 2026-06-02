/// E2E test: boots the REAL published artifact, not the source tree.
///
/// Why this exists: every other test in this suite runs against the source
/// (tsx + node_modules layout), so they cannot detect bugs in the npm
/// tarball — missing files from package.json `files`, devDependencies that
/// production needs at runtime, prisma config files that fail to load when
/// `prisma` is a devDependency. The shipped artifact has a different shape
/// than the source tree, so it MUST be tested as a black box.
///
/// What it does:
///   1. `npm pack` the package as it would be published.
///   2. `npm install` the tarball into a throwaway prefix dir.
///   3. Spawn `node node_modules/too-many-cooks/build/bin/server.js`
///      (no tsx, no source paths — exactly what a real user runs).
///   4. Assert the server starts, the DB exists, the schema is correct,
///      and prisma `db push`-based schema repair works after corruption.
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

// ============================================================================
// Constants
// ============================================================================

/** Directory of the package under test (the one we pack and install). */
const PACKAGE_DIR: string = resolve(import.meta.dirname, "..");

/** Prefix for the throwaway install dir under the OS temp directory. */
const INSTALL_PREFIX: string = "tmc-pubpkg-";

/** Prefix for the throwaway workspace dir (where data.db lives). */
const WORKSPACE_PREFIX: string = "tmc-pubpkg-ws-";

/** Name of the published package — must match package.json `name`. */
const PACKAGE_NAME: string = "too-many-cooks";

/** Path inside the install where the server bin lives. */
const BIN_REL_PATH: string = "node_modules/too-many-cooks/build/bin/server.js";

/** Path inside the install where the prisma schema lives. */
const SCHEMA_REL_PATH: string = "node_modules/too-many-cooks/prisma/schema.prisma";

/** Path inside the install where the prisma CLI lives. */
const PRISMA_RUNTIME_REL_PATH: string = "node_modules/prisma/package.json";

/** Workspace-relative path to the SQLite database file. */
const DB_REL_PATH: string = ".too_many_cooks/data.db";

/** Port the spawned server listens on. Fixed; the suite boots one server at a
 *  time and kills it before the next, so the port is free each boot. The server
 *  never takes over a busy port ([SERVER-NO-KILL]) — it would step aside. */
const PORT: number = 4067;

/** Polling tuning for the readiness probe. */
const POLL_INTERVAL_MS: number = 200;
const MAX_POLL_ATTEMPTS: number = 150; // 30s total — npm install + native build is slow

/** Tables that must exist after a successful schema push. */
const REQUIRED_TABLES: readonly string[] = [
  "identity",
  "locks",
  "messages",
  "message_reads",
  "plans",
];

/** Column we drop to prove `db push` repairs drift. */
const DRIFT_TABLE: string = "locks";
const DRIFT_COLUMN: string = "reason";

/** HTTP status code expected from /admin/status. */
const HTTP_OK: number = 200;

/** Forbidden files in the published tarball — regressions for bugs we hit
 *  in 0.8.0 (prisma.config.ts shipped but `prisma/config` unresolvable). */
const FORBIDDEN_TARBALL_PATHS: readonly string[] = ["prisma.config.ts"];

// ============================================================================
// Fixture state — populated by before()
// ============================================================================

type Fixture = {
  readonly tarballPath: string;
  readonly installDir: string;
};

let fixture: Fixture | undefined;

// ============================================================================
// Helpers
// ============================================================================

const packTarball = (): string => {
  // `npm pack --json` writes the metadata to stdout; the tarball is in cwd.
  const out: string = execFileSync(
    "npm",
    ["pack", "--silent", "--pack-destination", PACKAGE_DIR],
    { cwd: PACKAGE_DIR, encoding: "utf8" },
  ).trim();
  // npm pack prints the filename relative to --pack-destination on the last
  // non-empty line. Resolve to an absolute path.
  const file: string | undefined = out.split("\n").map((s: string): string => s.trim()).filter((s: string): boolean => s.length > 0).pop();
  if (file === undefined) {
    throw new Error("npm pack produced no output");
  }
  return resolve(PACKAGE_DIR, file);
};

const installTarball = (tarball: string): string => {
  const dir: string = mkdtempSync(join(tmpdir(), INSTALL_PREFIX));
  // Isolated npm cache so the resolver MUST go to the registry. With the
  // shared system cache, `--prefer-offline` (or even default behaviour after
  // a stale cache) can resurrect old transitive versions whose native
  // prebuilds don't match the current Node ABI — that's the failure mode
  // that bit `npx too-many-cooks` in the wild. A fresh cache reproduces a
  // first-time user's resolve.
  const cacheDir: string = mkdtempSync(join(tmpdir(), "tmc-pubpkg-cache-"));
  execFileSync("npm", ["init", "-y"], { cwd: dir, stdio: "pipe" });
  execFileSync(
    "npm",
    [
      "install",
      "--no-audit",
      "--no-fund",
      "--prefer-online",
      `--cache=${cacheDir}`,
      tarball,
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

const tableNames = (dbPath: string): readonly string[] => {
  const db: Database.Database = new Database(dbPath, { readonly: true });
  try {
    const rows: ReadonlyArray<{ readonly name: string }> = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as ReadonlyArray<{ readonly name: string }>;
    return rows.map((r: { readonly name: string }): string => r.name);
  } finally {
    db.close();
  }
};

const columnNames = (dbPath: string, table: string): readonly string[] => {
  const db: Database.Database = new Database(dbPath, { readonly: true });
  try {
    const rows: ReadonlyArray<{ readonly name: string }> = db
      .pragma(`table_info(${table})`) as ReadonlyArray<{ readonly name: string }>;
    return rows.map((r: { readonly name: string }): string => r.name);
  } finally {
    db.close();
  }
};

const dropColumn = (dbPath: string, table: string, column: string): void => {
  const db: Database.Database = new Database(dbPath);
  try {
    db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
  } finally {
    db.close();
  }
};

const tarballEntries = (tarball: string): readonly string[] => {
  const out: string = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" });
  return out.split("\n").map((s: string): string => s.trim()).filter((s: string): boolean => s.length > 0);
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
    const tarballPath: string = packTarball();
    const installDir: string = installTarball(tarballPath);
    fixture = { tarballPath, installDir };
  });

  after((): void => {
    if (fixture === undefined) { return; }
    rmSync(fixture.installDir, { recursive: true, force: true });
    rmSync(fixture.tarballPath, { force: true });
    fixture = undefined;
  });

  // --------------------------------------------------------------------------
  // Static asserts on the tarball itself
  // --------------------------------------------------------------------------

  it("tarball does NOT contain prisma.config.ts (regression: 0.8.0 shipped it and broke `npx prisma`)", (): void => {
    const fx: Fixture = requireFixture();
    const entries: readonly string[] = tarballEntries(fx.tarballPath);
    for (const forbidden of FORBIDDEN_TARBALL_PATHS) {
      const hits: readonly string[] = entries.filter((e: string): boolean => e.endsWith(`/${forbidden}`));
      assert.deepStrictEqual(
        hits,
        [],
        `Tarball MUST NOT contain ${forbidden} (regression for 0.8.0 prisma/config resolution bug). Got: ${hits.join(", ")}`,
      );
    }
  });

  it("tarball contains the prisma schema", (): void => {
    const fx: Fixture = requireFixture();
    const entries: readonly string[] = tarballEntries(fx.tarballPath);
    const hits: readonly string[] = entries.filter((e: string): boolean => e.endsWith("prisma/schema.prisma"));
    assert.notStrictEqual(hits.length, 0, "Tarball MUST contain prisma/schema.prisma");
  });

  it("tarball contains the bin entry point", (): void => {
    const fx: Fixture = requireFixture();
    const entries: readonly string[] = tarballEntries(fx.tarballPath);
    const hits: readonly string[] = entries.filter((e: string): boolean => e.endsWith("build/bin/server.js"));
    assert.notStrictEqual(hits.length, 0, "Tarball MUST contain build/bin/server.js");
  });

  // --------------------------------------------------------------------------
  // Installed-tree asserts (proves npm install resolves runtime deps)
  // --------------------------------------------------------------------------

  it("install resolves `prisma` as a runtime dependency (regression: 0.8.0 had it as devDep)", (): void => {
    const fx: Fixture = requireFixture();
    const p: string = join(fx.installDir, PRISMA_RUNTIME_REL_PATH);
    assert.ok(
      existsSync(p),
      `prisma must be installed at runtime — production runs \`npx prisma db push\`. Missing: ${p}`,
    );
  });

  it("installed package has the prisma schema at the path migrate.ts expects", (): void => {
    const fx: Fixture = requireFixture();
    const p: string = join(fx.installDir, SCHEMA_REL_PATH);
    assert.ok(existsSync(p), `Schema must exist at install-relative ${SCHEMA_REL_PATH}`);
  });

  // --------------------------------------------------------------------------
  // Boot the bin and prove migrations ran
  // --------------------------------------------------------------------------

  it("spawning the installed bin creates the DB with the full schema", async (): Promise<void> => {
    const fx: Fixture = requireFixture();
    const workspace: string = mkdtempSync(join(tmpdir(), WORKSPACE_PREFIX));
    mkdirSync(join(workspace, ".too_many_cooks"), { recursive: true });
    const proc: ChildProcess = spawnInstalledBin(fx.installDir, workspace);
    try {
      await pollUntilReady(PORT, proc);
      const dbPath: string = join(workspace, DB_REL_PATH);
      assert.ok(existsSync(dbPath), `DB file must exist after boot: ${dbPath}`);

      const present: readonly string[] = tableNames(dbPath);
      for (const required of REQUIRED_TABLES) {
        assert.ok(
          present.includes(required),
          `Table '${required}' must exist after migration. Got: ${present.join(", ")}`,
        );
      }

      const status: Response = await fetch(`http://127.0.0.1:${String(PORT)}/admin/status`);
      assert.strictEqual(status.status, HTTP_OK, "/admin/status must return 200 after boot");
    } finally {
      await killAndWait(proc);
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // The schema-repair contract — `prisma db push` patches drift
  // --------------------------------------------------------------------------

  it("re-spawning the bin after dropping a column restores the column via `prisma db push`", async (): Promise<void> => {
    const fx: Fixture = requireFixture();
    const workspace: string = mkdtempSync(join(tmpdir(), WORKSPACE_PREFIX));
    mkdirSync(join(workspace, ".too_many_cooks"), { recursive: true });
    const dbPath: string = join(workspace, DB_REL_PATH);

    // First boot — schema gets created.
    const first: ChildProcess = spawnInstalledBin(fx.installDir, workspace);
    try {
      await pollUntilReady(PORT, first);
    } finally {
      await killAndWait(first);
    }
    const beforeDrift: readonly string[] = columnNames(dbPath, DRIFT_TABLE);
    assert.ok(beforeDrift.includes(DRIFT_COLUMN), `precondition: ${DRIFT_TABLE}.${DRIFT_COLUMN} present after first boot. Got: ${beforeDrift.join(",")}`);

    // Corrupt the schema by dropping a column out-of-band.
    dropColumn(dbPath, DRIFT_TABLE, DRIFT_COLUMN);
    const dropped: readonly string[] = columnNames(dbPath, DRIFT_TABLE);
    assert.ok(!dropped.includes(DRIFT_COLUMN), `setup: ${DRIFT_TABLE}.${DRIFT_COLUMN} gone after DROP COLUMN. Got: ${dropped.join(",")}`);

    // Second boot — `prisma db push` must repair the drift.
    const second: ChildProcess = spawnInstalledBin(fx.installDir, workspace);
    try {
      await pollUntilReady(PORT, second);
    } finally {
      await killAndWait(second);
    }
    const afterRepair: readonly string[] = columnNames(dbPath, DRIFT_TABLE);
    assert.ok(
      afterRepair.includes(DRIFT_COLUMN),
      `${DRIFT_TABLE}.${DRIFT_COLUMN} must be restored by prisma db push on the published bin. Got: ${afterRepair.join(",")}`,
    );

    rmSync(workspace, { recursive: true, force: true });
  });

  // --------------------------------------------------------------------------
  // Stale-DB rebuild — when push fails, the bin must nuke + retry
  // --------------------------------------------------------------------------

  it("booting against a wildly stale DB still ends up with a correct schema", async (): Promise<void> => {
    const fx: Fixture = requireFixture();
    const workspace: string = mkdtempSync(join(tmpdir(), WORKSPACE_PREFIX));
    const dataDir: string = join(workspace, ".too_many_cooks");
    mkdirSync(dataDir, { recursive: true });
    const dbPath: string = join(workspace, DB_REL_PATH);

    // Seed a stale DB whose schema can't be patched into the new one.
    const seed: Database.Database = new Database(dbPath);
    try {
      seed.exec(`CREATE TABLE identity (agent_name TEXT PRIMARY KEY, garbage INTEGER NOT NULL);`);
    } finally {
      seed.close();
    }
    assert.deepStrictEqual(columnNames(dbPath, "identity"), ["agent_name", "garbage"]);

    const proc: ChildProcess = spawnInstalledBin(fx.installDir, workspace);
    try {
      await pollUntilReady(PORT, proc);
    } finally {
      await killAndWait(proc);
    }
    const tables: readonly string[] = tableNames(dbPath);
    for (const required of REQUIRED_TABLES) {
      assert.ok(
        tables.includes(required),
        `After stale-DB recovery, '${required}' must exist. Got: ${tables.join(", ")}`,
      );
    }
    const identityCols: readonly string[] = columnNames(dbPath, "identity");
    assert.ok(
      identityCols.includes("agent_key"),
      `identity.agent_key must exist after rebuild. Got: ${identityCols.join(",")}`,
    );

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
