/// Server startup integration tests - spawn real server processes,
/// verify startup behavior, custom port, no-cross-kill step-aside on
/// port conflict ([SERVER-NO-KILL]/[SERVER-PORT-CONFLICT]), and
/// initial /admin/status response shape.

import { describe, it, after } from "node:test";
import assert from "node:assert";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";

import { SERVER_BINARY, SERVER_NODE_ARGS } from "../src/config.js";

// ============================================================
// Constants
// ============================================================

const PORT_STATUS_RESPONDS = 4050;
const PORT_CUSTOM = 4051;
const PORT_CONFLICT = 4052;
const PORT_INITIAL_STATE = 4053;
const MAX_POLL_ATTEMPTS = 30;
const POLL_INTERVAL_MS = 200;
const ADMIN_STATUS_PATH = "/admin/status";
const TMP_PREFIX = "/tmp/tmc-startup-";
const STATUS_OK = 200;

/** How long to wait for the losing server to step aside and exit. */
const STEP_ASIDE_TIMEOUT_MS = 10000;

/** Sentinel returned by waitForExit when the process never exits. */
const STILL_RUNNING = "still-running";
const EMPTY_ARRAY_LENGTH = 0;
const AGENTS_FIELD = "agents";
const LOCKS_FIELD = "locks";
const PLANS_FIELD = "plans";
const MESSAGES_FIELD = "messages";

// ============================================================
// Types
// ============================================================

type StatusResponse = {
  readonly agents: readonly unknown[];
  readonly locks: readonly unknown[];
  readonly plans: readonly unknown[];
  readonly messages: readonly unknown[];
};

// ============================================================
// Helpers
// ============================================================

const buildBaseUrl = (port: number): string =>
  `http://localhost:${String(port)}`;

const spawnOnPort = (port: number): {
  readonly proc: ChildProcess;
  readonly workspace: string;
} => {
  const workspace = mkdtempSync(TMP_PREFIX);
  const proc = spawn("node", [...SERVER_NODE_ARGS, SERVER_BINARY], {
    stdio: ["pipe", "pipe", "inherit"],
    env: {
      ...process.env,
      TMC_PORT: String(port),
      TMC_WORKSPACE: workspace,
    },
  });
  return { proc, workspace };
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

const fetchStatus = async (port: number): Promise<{
  readonly status: number;
  readonly body: StatusResponse;
}> => {
  const url = `${buildBaseUrl(port)}${ADMIN_STATUS_PATH}`;
  const response = await fetch(url);
  const body = (await response.json()) as StatusResponse;
  return { status: response.status, body };
};

const cleanup = (proc: ChildProcess, workspace: string): void => {
  proc.kill();
  rmSync(workspace, { recursive: true, force: true });
};

/** Wait for a process to exit, returning its exit code, or STILL_RUNNING on timeout. */
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
// Tests
// ============================================================

describe("server starts and responds to /admin/status", () => {
  let proc: ChildProcess;
  let workspace: string;

  after(() => { cleanup(proc, workspace); });

  it("returns 200 from /admin/status after startup", async () => {
    const spawned = spawnOnPort(PORT_STATUS_RESPONDS);
    proc = spawned.proc;
    workspace = spawned.workspace;

    await pollUntilReady(PORT_STATUS_RESPONDS);

    const { status, body } = await fetchStatus(PORT_STATUS_RESPONDS);
    assert.strictEqual(status, STATUS_OK, "GET /admin/status MUST return 200");
    assert.ok(
      body !== null && typeof body === "object",
      "/admin/status MUST return a JSON object",
    );
  });
});

describe("server starts on custom port via TMC_PORT", () => {
  let proc: ChildProcess;
  let workspace: string;

  after(() => { cleanup(proc, workspace); });

  it("listens on port specified by TMC_PORT env var", async () => {
    const spawned = spawnOnPort(PORT_CUSTOM);
    proc = spawned.proc;
    workspace = spawned.workspace;

    await pollUntilReady(PORT_CUSTOM);

    const { status } = await fetchStatus(PORT_CUSTOM);
    assert.strictEqual(
      status,
      STATUS_OK,
      `Server MUST listen on custom port ${String(PORT_CUSTOM)}`,
    );
  });
});

// [SERVER-NO-KILL] / [SERVER-PORT-CONFLICT]: a second server (a DIFFERENT
// project) that finds the port occupied MUST step aside cleanly — it must
// NEVER kill the process that owns the port. Issue #33.
describe("server does NOT kill an existing server on the same port — it steps aside", () => {
  let firstProc: ChildProcess;
  let secondProc: ChildProcess;
  let firstWorkspace: string;
  let secondWorkspace: string;

  after(() => {
    secondProc.kill();
    firstProc.kill();
    rmSync(firstWorkspace, { recursive: true, force: true });
    rmSync(secondWorkspace, { recursive: true, force: true });
  });

  it("loser of the port race exits non-zero while the owner stays alive", async () => {
    // Start the first server (project A) — it owns the port.
    const first = spawnOnPort(PORT_CONFLICT);
    firstProc = first.proc;
    firstWorkspace = first.workspace;
    await pollUntilReady(PORT_CONFLICT);

    const beforeStatus = await fetchStatus(PORT_CONFLICT);
    assert.strictEqual(
      beforeStatus.status,
      STATUS_OK,
      "First server MUST be alive before the second starts",
    );

    // Start the second server (project B, different folder) on the SAME port.
    const second = spawnOnPort(PORT_CONFLICT);
    secondProc = second.proc;
    secondWorkspace = second.workspace;

    // The second server MUST give up rather than kill the first.
    const exitResult = await waitForExit(secondProc, STEP_ASIDE_TIMEOUT_MS);
    assert.notStrictEqual(
      exitResult,
      STILL_RUNNING,
      "Second server MUST step aside and exit on EADDRINUSE, not keep running by killing the owner",
    );
    assert.notStrictEqual(
      exitResult,
      0,
      "Second server MUST exit with a non-zero code when the port is already in use",
    );

    // The first server (project A) MUST be completely untouched.
    const afterStatus = await fetchStatus(PORT_CONFLICT);
    assert.strictEqual(
      afterStatus.status,
      STATUS_OK,
      "First server MUST still be alive — the second MUST NOT have killed it",
    );
  });
});

describe("/admin/status returns correct initial state", () => {
  let proc: ChildProcess;
  let workspace: string;

  after(() => { cleanup(proc, workspace); });

  it("fresh server has empty agents, locks, plans, and messages", async () => {
    const spawned = spawnOnPort(PORT_INITIAL_STATE);
    proc = spawned.proc;
    workspace = spawned.workspace;

    await pollUntilReady(PORT_INITIAL_STATE);

    const { status, body } = await fetchStatus(PORT_INITIAL_STATE);
    assert.strictEqual(status, STATUS_OK);

    // Verify all four fields exist and are arrays
    assert.strictEqual(
      Array.isArray(body[AGENTS_FIELD]),
      true,
      `${AGENTS_FIELD} MUST be an array`,
    );
    assert.strictEqual(
      Array.isArray(body[LOCKS_FIELD]),
      true,
      `${LOCKS_FIELD} MUST be an array`,
    );
    assert.strictEqual(
      Array.isArray(body[PLANS_FIELD]),
      true,
      `${PLANS_FIELD} MUST be an array`,
    );
    assert.strictEqual(
      Array.isArray(body[MESSAGES_FIELD]),
      true,
      `${MESSAGES_FIELD} MUST be an array`,
    );

    // Verify all arrays are empty on fresh startup
    assert.strictEqual(
      body[AGENTS_FIELD].length,
      EMPTY_ARRAY_LENGTH,
      `${AGENTS_FIELD} MUST be empty on fresh server`,
    );
    assert.strictEqual(
      body[LOCKS_FIELD].length,
      EMPTY_ARRAY_LENGTH,
      `${LOCKS_FIELD} MUST be empty on fresh server`,
    );
    assert.strictEqual(
      body[PLANS_FIELD].length,
      EMPTY_ARRAY_LENGTH,
      `${PLANS_FIELD} MUST be empty on fresh server`,
    );
    assert.strictEqual(
      body[MESSAGES_FIELD].length,
      EMPTY_ARRAY_LENGTH,
      `${MESSAGES_FIELD} MUST be empty on fresh server`,
    );
  });
});
