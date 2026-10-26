/// Regression test: server must not crash when writing to the log file
/// in a workspace whose .too_many_cooks/logs/ directory does not yet exist.
///
/// Reproduces: ENOENT crash on appendFileSync when TMC_WORKSPACE points
/// to a directory that has never had the logs subdirectory created.

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import type { ChildProcess } from "node:child_process";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { killServer, spawnServer, waitForServer } from "./support/server_process.js";

const PORT = 4041;
const BASE_URL = `http://localhost:${String(PORT)}`;
const ACCEPT = "application/json, text/event-stream";
const POLL_ATTEMPTS = 50;
const PATH_FALLBACK = "/usr/local/bin:/usr/bin:/bin";

const spawnServerWithWorkspace = (workspace: string): ChildProcess =>
  spawnServer({
    port: PORT,
    workspace,
    env: { PATH: process.env.PATH ?? PATH_FALLBACK },
  }).proc;

const killProcess = (proc: ChildProcess): void => {
  killServer(proc);
};

const waitForServerReady = async (): Promise<void> => {
  await waitForServer(BASE_URL, POLL_ATTEMPTS);
};

describe("Log directory creation", () => {
  let serverProcess: ChildProcess;
  let tmpWorkspace: string;

  before(async () => {
    // Create a fresh temp workspace with NO logs/ subdirectory.
    tmpWorkspace = mkdtempSync("/tmp/tmc-log-test-");
    serverProcess = spawnServerWithWorkspace(tmpWorkspace);
    await waitForServerReady();
  });

  after(() => {
    killProcess(serverProcess);
    rmSync(tmpWorkspace, { recursive: true, force: true });
  });

  it("server survives a bad MCP request that triggers error logging", async () => {
    // POST to /mcp with no session-id and a non-initialize body.
    // This returns 400 and triggers _asyncHandler's error-log path
    // (appendFileSync). Before the fix, this crashed the server with
    // ENOENT because the logs/ dir was never created.
    const response = await fetch(`${BASE_URL}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: ACCEPT,
      },
      body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
    });

    assert.strictEqual(
      response.status,
      400,
      "Server should return 400 for bad request",
    );

    // Give the server a moment to process, then confirm it is alive.
    await new Promise((resolve) => setTimeout(resolve, 300));

    const statusResponse = await fetch(`${BASE_URL}/admin/status`);
    assert.strictEqual(
      statusResponse.ok,
      true,
      "Server must still be alive after bad request",
    );
  });

  it(".too_many_cooks/logs/ directory is created alongside the DB on startup", () => {
    const logsDir = join(tmpWorkspace, ".too_many_cooks", "logs");
    assert.strictEqual(
      existsSync(logsDir),
      true,
      ".too_many_cooks/logs/ directory must be created in TMC_WORKSPACE on startup",
    );
  });
});
