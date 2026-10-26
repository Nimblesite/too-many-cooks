/// [SERVER-LOCKFILE] Branch coverage for bin/server_lock.ts through its public
/// API with a real filesystem: corrupt lock files, wrong-typed fields, locks
/// held by live processes (EPERM counts as alive), unwritable lock paths, and
/// release semantics for own vs foreign pids.
///
/// [SERVER-NO-KILL] nothing here kills anything — PID probes use signal 0 and
/// PID 1 (launchd/init) is only *probed*, never signalled.

import { afterEach, describe, it } from "node:test";
import assert from "node:assert";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  acquireServerLock,
  releaseServerLock,
  resolveLockPath,
} from "../bin/server_lock.js";

const TMP_PREFIX = "/tmp/tmc-lockfile-";
const TEST_PORT = 1234;
const STARTED_AT = 1111;
const INIT_PID = 1;
const OWN_PID = process.pid;

const workspaces: string[] = [];

/** Create a fresh workspace and register it for teardown. */
const newWorkspace = (): string => {
  const dir = mkdtempSync(TMP_PREFIX);
  workspaces.push(dir);
  return dir;
};

afterEach(() => {
  while (workspaces.length > 0) {
    const dir = workspaces.pop();
    if (dir !== undefined) { rmSync(dir, { recursive: true, force: true }); }
  }
});

/** Write raw lock-file content at `path`, creating parent dirs. */
const writeLockFile = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, { flag: "w" });
};

const lockJson = (pid: number, port: number, startedAt: number): string =>
  JSON.stringify({ pid, port, startedAt });

describe("resolveLockPath", () => {
  it("places the lock next to data.db in .too_many_cooks", () => {
    const workspace = newWorkspace();
    const lockPath = resolveLockPath(workspace);
    assert.strictEqual(lockPath, join(workspace, ".too_many_cooks", "server.lock"));
  });
});

describe("acquireServerLock", () => {
  it("acquires when no lock file exists", () => {
    const lockPath = resolveLockPath(newWorkspace());
    const result = acquireServerLock(lockPath, TEST_PORT, STARTED_AT);
    if (!result.ok) { assert.fail(result.error); }
    assert.strictEqual(result.value.kind, "acquired");
    assert.strictEqual(result.value.path, lockPath);
  });

  it("reports busy when a live foreign process (PID 1) holds the lock", () => {
    const lockPath = resolveLockPath(newWorkspace());
    writeLockFile(lockPath, lockJson(INIT_PID, 99, 1));
    const result = acquireServerLock(lockPath, TEST_PORT, STARTED_AT);
    if (!result.ok) { assert.fail(result.error); }
    if (result.value.kind !== "busy") { assert.fail("expected busy"); }
    assert.deepStrictEqual(result.value.existing, { pid: INIT_PID, port: 99, startedAt: 1 });
    assert.strictEqual(existsSync(lockPath), true);
  });

  it("reports busy when our own live pid holds the lock", () => {
    const lockPath = resolveLockPath(newWorkspace());
    writeLockFile(lockPath, lockJson(OWN_PID, TEST_PORT, STARTED_AT));
    const result = acquireServerLock(lockPath, TEST_PORT, STARTED_AT);
    if (!result.ok) { assert.fail(result.error); }
    assert.strictEqual(result.value.kind, "busy");
  });

  it("overwrites a corrupt (non-JSON) lock file", () => {
    const lockPath = resolveLockPath(newWorkspace());
    writeLockFile(lockPath, "not json at all");
    const result = acquireServerLock(lockPath, TEST_PORT, STARTED_AT);
    if (!result.ok) { assert.fail(result.error); }
    assert.strictEqual(result.value.kind, "acquired");
  });

  it("overwrites locks with wrong-typed or missing fields", () => {
    const badLocks: readonly string[] = [
      JSON.stringify({ pid: "1", port: 2, startedAt: 3 }),
      JSON.stringify({ pid: 1, port: "2", startedAt: 3 }),
      JSON.stringify({ pid: 1, port: 2, startedAt: "3" }),
      JSON.stringify({ pid: 1 }),
      JSON.stringify({}),
      JSON.stringify([1, 2, 3]),
      "null",
    ];
    for (const bad of badLocks) {
      const lockPath = resolveLockPath(newWorkspace());
      writeLockFile(lockPath, bad);
      const result = acquireServerLock(lockPath, TEST_PORT, STARTED_AT);
      if (!result.ok) { assert.fail(result.error); }
      assert.strictEqual(result.value.kind, "acquired");
    }
  });

  it("overwrites a lock left by a dead pid", () => {
    const lockPath = resolveLockPath(newWorkspace());
    const deadPid = 999999;
    writeLockFile(lockPath, lockJson(deadPid, TEST_PORT, STARTED_AT));
    const result = acquireServerLock(lockPath, TEST_PORT, STARTED_AT);
    if (!result.ok) { assert.fail(result.error); }
    assert.strictEqual(result.value.kind, "acquired");
  });

  it("fails with an error when the lock path is not writable", () => {
    const workspace = newWorkspace();
    const blocker = join(workspace, "blocker");
    closeSync(openSync(blocker, "w"));
    const lockPath = join(blocker, "server.lock");
    const result = acquireServerLock(lockPath, TEST_PORT, STARTED_AT);
    assert.strictEqual(result.ok, false);
    if (result.ok) { assert.fail("unreachable"); }
    assert.ok(result.error.startsWith("Failed to write lock file"));
    assert.ok(result.error.includes(lockPath));
  });
});

describe("releaseServerLock", () => {
  it("removes the lock when it records our own pid", () => {
    const lockPath = resolveLockPath(newWorkspace());
    const acquired = acquireServerLock(lockPath, TEST_PORT, STARTED_AT);
    if (!acquired.ok || acquired.value.kind !== "acquired") { assert.fail("acquire failed"); }
    releaseServerLock(lockPath);
    assert.strictEqual(existsSync(lockPath), false);
  });

  it("keeps the lock when it records a foreign pid", () => {
    const lockPath = resolveLockPath(newWorkspace());
    writeLockFile(lockPath, lockJson(INIT_PID, TEST_PORT, STARTED_AT));
    releaseServerLock(lockPath);
    assert.strictEqual(existsSync(lockPath), true);
  });

  it("is a no-op when no lock file exists", () => {
    const lockPath = resolveLockPath(newWorkspace());
    releaseServerLock(lockPath);
    assert.strictEqual(existsSync(lockPath), false);
  });
});
