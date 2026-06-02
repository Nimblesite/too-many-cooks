/// [SERVER-SINGLE-INSTANCE] / [SERVER-LOCKFILE] — there is exactly ONE Too Many
/// Cooks server per workspace folder. A second server started in a folder that
/// already has a running server MUST refuse to start (even on a different port,
/// because both would share the same `.too_many_cooks/data.db`).
///
/// Issue #33: nothing stopped two servers in the same folder from running, which
/// corrupts the shared coordination database.

import { describe, it, after } from "node:test";
import assert from "node:assert";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

import { SERVER_BINARY, SERVER_NODE_ARGS } from "../src/config.js";

// ============================================================
// Constants
// ============================================================

const PORT_FIRST = 4071;
const PORT_SECOND = 4072;
const MAX_POLL_ATTEMPTS = 50;
const POLL_INTERVAL_MS = 200;
const ADMIN_STATUS_PATH = "/admin/status";
const TMP_PREFIX = "/tmp/tmc-singleinstance-";
const STATUS_OK = 200;
const REFUSE_TIMEOUT_MS = 10000;
const STILL_RUNNING = "still-running";
const LOCK_REL_PATH = ".too_many_cooks/server.lock";
const ALREADY_RUNNING_MARKER = "already running in this folder";

// ============================================================
// Helpers
// ============================================================

const buildBaseUrl = (port: number): string => `http://localhost:${String(port)}`;

/// Spawn the server bound to an EXPLICIT workspace so two instances can share one.
const spawnInWorkspace = (port: number, workspace: string): {
  readonly proc: ChildProcess;
  readonly stderr: string[];
} => {
  const stderr: string[] = [];
  const proc = spawn("node", [...SERVER_NODE_ARGS, SERVER_BINARY], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, TMC_PORT: String(port), TMC_WORKSPACE: workspace },
  });
  proc.stderr?.on("data", (chunk: Buffer): void => { stderr.push(chunk.toString()); });
  return { proc, stderr };
};

const pollUntilReady = async (port: number): Promise<void> => {
  const url = `${buildBaseUrl(port)}${ADMIN_STATUS_PATH}`;
  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) { return; }
    } catch {
      // Not ready yet
    }
    if (i === MAX_POLL_ATTEMPTS - 1) {
      throw new Error(`Server on port ${String(port)} failed to start`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
};

const fetchStatus = async (port: number): Promise<number> => {
  const response = await fetch(`${buildBaseUrl(port)}${ADMIN_STATUS_PATH}`);
  return response.status;
};

const waitForExit = async (
  proc: ChildProcess,
  timeoutMs: number,
): Promise<number | null | typeof STILL_RUNNING> =>
  new Promise((resolve) => {
    if (proc.exitCode !== null) { resolve(proc.exitCode); return; }
    const timer = setTimeout((): void => { resolve(STILL_RUNNING); }, timeoutMs);
    proc.once("exit", (code: number | null): void => {
      clearTimeout(timer);
      resolve(code);
    });
  });

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
