/// Server startup integration tests - spawn real server processes,
/// verify startup behavior, custom port, port takeover, and
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
const PORT_TAKEOVER = 4052;
const PORT_INITIAL_STATE = 4053;
const MAX_POLL_ATTEMPTS = 30;
const POLL_INTERVAL_MS = 200;
const ADMIN_STATUS_PATH = "/admin/status";
const TMP_PREFIX = "/tmp/tmc-startup-";
const STATUS_OK = 200;
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

describe("server kills existing process on same port", () => {
  let firstProc: ChildProcess;
  let secondProc: ChildProcess;
  let firstWorkspace: string;
  let secondWorkspace: string;

  after(() => {
    // Second server should be the live one; kill both to be safe
    secondProc.kill();
    firstProc.kill();
    rmSync(firstWorkspace, { recursive: true, force: true });
    rmSync(secondWorkspace, { recursive: true, force: true });
  });

  it("second server takes over port from first", async () => {
    // Start first server
    const first = spawnOnPort(PORT_TAKEOVER);
    firstProc = first.proc;
    firstWorkspace = first.workspace;
    await pollUntilReady(PORT_TAKEOVER);

    // Verify first is alive
    const beforeStatus = await fetchStatus(PORT_TAKEOVER);
    assert.strictEqual(
      beforeStatus.status,
      STATUS_OK,
      "First server MUST be alive before takeover",
    );

    // Start second server on same port — it should kill the first
    const second = spawnOnPort(PORT_TAKEOVER);
    secondProc = second.proc;
    secondWorkspace = second.workspace;
    await pollUntilReady(PORT_TAKEOVER);

    // Verify second server is responding
    const afterStatus = await fetchStatus(PORT_TAKEOVER);
    assert.strictEqual(
      afterStatus.status,
      STATUS_OK,
      "Second server MUST respond after taking over port",
    );

    // Verify the second server has a fresh state (empty arrays)
    assert.strictEqual(
      afterStatus.body.agents.length,
      EMPTY_ARRAY_LENGTH,
      "Second server MUST have empty agents (fresh DB)",
    );
    assert.strictEqual(
      afterStatus.body.locks.length,
      EMPTY_ARRAY_LENGTH,
      "Second server MUST have empty locks (fresh DB)",
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
