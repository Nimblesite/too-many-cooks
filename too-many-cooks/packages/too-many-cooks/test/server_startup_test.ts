/// Server startup integration tests - spawn real server processes,
/// verify startup behavior, custom port, no-cross-kill step-aside on
/// port conflict ([SERVER-NO-KILL]/[SERVER-PORT-CONFLICT]), and
/// initial /admin/status response shape.

import { describe, it, after } from "node:test";
import assert from "node:assert";
import type { ChildProcess } from "node:child_process";

import {
  STILL_RUNNING,
  fetchAdminStatus,
  spawnServer,
  waitForExit,
  waitForServer,
  stopAndRemove,
  stopAndRemoveAll,
} from "./support/server_process.js";
import { getArrayField } from "./support/json.js";

// ============================================================
// Constants
// ============================================================

const PORT_STATUS_RESPONDS = 4050;
const PORT_CUSTOM = 4051;
const PORT_CONFLICT = 4052;
const PORT_INITIAL_STATE = 4053;
const TMP_PREFIX = "/tmp/tmc-startup-";
const STATUS_OK = 200;

/** How long to wait for the losing server to step aside and exit. */
const STEP_ASIDE_TIMEOUT_MS = 10000;

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

/** Spawns the server on `port` and waits until /admin/status answers. */
const spawnOnPort = async (port: number): Promise<{
  readonly proc: ChildProcess;
  readonly workspace: string;
}> => {
  const spawned = spawnServer({ port, tmpPrefix: TMP_PREFIX });
  await waitForServer(`http://localhost:${String(port)}`);
  return { proc: spawned.proc, workspace: spawned.workspace };
};

const fetchStatus = async (port: number): Promise<{
  readonly status: number;
  readonly body: StatusResponse;
}> => {
  const { status, body } = await fetchAdminStatus(port);
  return {
    status,
    body: {
      agents: getArrayField(body, AGENTS_FIELD),
      locks: getArrayField(body, LOCKS_FIELD),
      plans: getArrayField(body, PLANS_FIELD),
      messages: getArrayField(body, MESSAGES_FIELD),
    },
  };
};

// ============================================================
// Tests
// ============================================================

describe("server starts and responds to /admin/status", () => {
  let proc: ChildProcess;
  let workspace: string;

  after(async () => { await stopAndRemove({ proc, workspace }); });

  it("returns 200 from /admin/status after startup", async () => {
    ({ proc, workspace } = await spawnOnPort(PORT_STATUS_RESPONDS));

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

  after(async () => { await stopAndRemove({ proc, workspace }); });

  it("listens on port specified by TMC_PORT env var", async () => {
    ({ proc, workspace } = await spawnOnPort(PORT_CUSTOM));

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

  after(async () => {
    await stopAndRemoveAll([
      { proc: secondProc, workspace: secondWorkspace },
      { proc: firstProc, workspace: firstWorkspace },
    ]);
  });

  it("loser of the port race exits non-zero while the owner stays alive", async () => {
    // Start the first server (project A) — it owns the port.
    ({ proc: firstProc, workspace: firstWorkspace } = await spawnOnPort(PORT_CONFLICT));

    const beforeStatus = await fetchStatus(PORT_CONFLICT);
    assert.strictEqual(
      beforeStatus.status,
      STATUS_OK,
      "First server MUST be alive before the second starts",
    );

    // Start the second server (project B, different folder) on the SAME port.
    // It is NOT polled: it must give up on its own rather than ever become ready.
    const second = spawnServer({ port: PORT_CONFLICT, tmpPrefix: TMP_PREFIX });
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

  after(async () => { await stopAndRemove({ proc, workspace }); });

  it("fresh server has empty agents, locks, plans, and messages", async () => {
    ({ proc, workspace } = await spawnOnPort(PORT_INITIAL_STATE));

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
