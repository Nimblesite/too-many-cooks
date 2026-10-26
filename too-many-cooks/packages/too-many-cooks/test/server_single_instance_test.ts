/// [SERVER-SINGLE-INSTANCE] / [SERVER-LOCKFILE] — there is exactly ONE Too Many
/// Cooks server per workspace folder. A second server started in a folder that
/// already has a running server MUST refuse to start (even on a different port,
/// because both would share the same `.too_many_cooks/data.db`).
///
/// Issue #33: nothing stopped two servers in the same folder from running, which
/// corrupts the shared coordination database.

import { describe, it, after } from "node:test";
import assert from "node:assert";
import type { ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  ADMIN_STATUS_PATH,
  STILL_RUNNING,
  buildBaseUrl,
  spawnServer,
  waitForExit,
  waitForServer,
} from "./support/server_process.js";

// ============================================================
// Constants
// ============================================================

const PORT_FIRST = 4071;
const PORT_SECOND = 4072;
const POLL_ATTEMPTS = 50;
const TMP_PREFIX = "/tmp/tmc-singleinstance-";
const STATUS_OK = 200;
const REFUSE_TIMEOUT_MS = 10000;
const LOCK_REL_PATH = ".too_many_cooks/server.lock";
const ALREADY_RUNNING_MARKER = "already running in this folder";

// ============================================================
// Helpers
// ============================================================

/// Spawn the server bound to an EXPLICIT workspace so two instances can share one.
const spawnInWorkspace = (port: number, workspace: string): {
  readonly proc: ChildProcess;
  readonly stderr: readonly string[];
} => spawnServer({ port, workspace, captureStderr: true });

const pollUntilReady = async (port: number): Promise<void> => {
  await waitForServer(buildBaseUrl(port), POLL_ATTEMPTS);
};

const fetchStatus = async (port: number): Promise<number> => {
  const response = await fetch(`${buildBaseUrl(port)}${ADMIN_STATUS_PATH}`);
  return response.status;
};

// ============================================================
// Test
// ============================================================

describe("only one server may run per workspace folder", () => {
  let firstProc: ChildProcess | undefined;
  let secondProc: ChildProcess | undefined;
  let workspace: string | undefined;

  after(() => {
    secondProc?.kill("SIGKILL");
    firstProc?.kill("SIGKILL");
    if (workspace !== undefined) { rmSync(workspace, { recursive: true, force: true }); }
  });

  it("a second server in the same folder refuses to start, leaving the first alive", async () => {
    const ws = mkdtempSync(TMP_PREFIX);
    workspace = ws;

    // First server claims the folder.
    const first = spawnInWorkspace(PORT_FIRST, ws);
    firstProc = first.proc;
    await pollUntilReady(PORT_FIRST);
    assert.strictEqual(
      await fetchStatus(PORT_FIRST),
      STATUS_OK,
      "First server MUST be alive",
    );

    // The lock file proves all state lives in the folder ([SERVER-LOCKFILE]).
    assert.ok(
      existsSync(join(ws, LOCK_REL_PATH)),
      `First server MUST write a lock file at ${LOCK_REL_PATH}`,
    );

    // Second server, SAME folder, DIFFERENT port (so there is no port clash —
    // the folder lock is the only thing that can stop it).
    const second = spawnInWorkspace(PORT_SECOND, ws);
    secondProc = second.proc;

    const exitResult = await waitForExit(second.proc, REFUSE_TIMEOUT_MS);
    assert.notStrictEqual(
      exitResult,
      STILL_RUNNING,
      "Second server in the same folder MUST refuse to start and exit, not keep running",
    );
    assert.notStrictEqual(
      exitResult,
      0,
      "Second server MUST exit with a non-zero code when the folder is already in use",
    );

    const secondStderr = second.stderr.join("").toLowerCase();
    assert.ok(
      secondStderr.includes(ALREADY_RUNNING_MARKER),
      `Second server MUST explain it refused because TMC is "${ALREADY_RUNNING_MARKER}". Got:\n${second.stderr.join("")}`,
    );

    // First server MUST be entirely unaffected.
    assert.strictEqual(
      await fetchStatus(PORT_FIRST),
      STATUS_OK,
      "First server MUST still be alive after the second refused to start",
    );
  });
});
