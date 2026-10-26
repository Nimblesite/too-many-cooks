/// Server crash resilience test — the server MUST NOT die silently.
///
/// BUG: The server has no process.on('uncaughtException'),
/// process.on('unhandledRejection'), or SIGTERM/SIGINT handlers.
/// When the process receives SIGTERM or encounters an unhandled error,
/// it dies silently with zero log output. The user sees the server
/// vanish and must restart manually with no clue what happened.
///
/// EXPECTED: On SIGTERM, the server logs a shutdown message to the
/// log file before exiting. This proves the signal handler exists.

import { describe, it, after } from "node:test";
import assert from "node:assert";
import type { ChildProcess } from "node:child_process";
import { rmSync, readFileSync, readdirSync } from "node:fs";

import {
  ADMIN_STATUS_PATH,
  buildBaseUrl,
  spawnServer,
  waitForServer,
} from "./support/server_process.js";

// ============================================================
// Constants
// ============================================================

const PORT_SIGTERM_TEST = 4054;
const TMP_PREFIX = "/tmp/tmc-crash-test-";
const STATUS_OK = 200;
const EXIT_SETTLE_MS = 1000;

// ============================================================
// Helpers
// ============================================================

const spawnOnPort = (port: number): {
  readonly proc: ChildProcess;
  readonly workspace: string;
  readonly stderr: readonly string[];
} => spawnServer({ port, tmpPrefix: TMP_PREFIX, captureStderr: true });

const fetchStatus = async (port: number): Promise<number> => {
  const response = await fetch(`${buildBaseUrl(port)}${ADMIN_STATUS_PATH}`);
  return response.status;
};

const pollUntilReady = async (port: number): Promise<void> => {
  await waitForServer(buildBaseUrl(port));
};

// ============================================================
// Tests
// ============================================================

describe("server handles SIGTERM gracefully (not silent death)", () => {
  let proc: ChildProcess;
  let workspace: string;
  let stderr: readonly string[] = [];

  after(() => {
    proc.kill("SIGKILL");
    rmSync(workspace, { recursive: true, force: true });
  });

  it("logs shutdown message to log file on SIGTERM", async () => {
    const spawned = spawnOnPort(PORT_SIGTERM_TEST);
    proc = spawned.proc;
    workspace = spawned.workspace;
    stderr = spawned.stderr;

    await pollUntilReady(PORT_SIGTERM_TEST);

    // Verify server is alive
    const statusBefore = await fetchStatus(PORT_SIGTERM_TEST);
    assert.strictEqual(statusBefore, STATUS_OK, "Server MUST be alive before SIGTERM");

    // Send SIGTERM — this is what happens when the process is killed normally
    proc.kill("SIGTERM");

    // Wait for process to handle signal and exit
    await new Promise<void>((resolve) => setTimeout(resolve, EXIT_SETTLE_MS));

    // Read the log file
    const logsDir = `${workspace}/.too_many_cooks/logs`;
    const logFiles = readdirSync(logsDir).filter(
      (f: string): boolean => f.startsWith("mcp-server-"),
    );
    assert.ok(logFiles.length > 0, "Server MUST write log files");
    const firstLog = logFiles[0];
    assert.ok(firstLog !== undefined, "Expected at least one log file");
    const logContent = readFileSync(`${logsDir}/${firstLog}`, "utf8");

    // THE KEY ASSERTION: The log MUST contain a shutdown message.
    // Currently FAILS: SIGTERM kills the process silently, no shutdown logged.
    assert.ok(
      logContent.includes("shutting down") || logContent.includes("Shutting down") ||
      logContent.includes("SIGTERM") || logContent.includes("Server stopped"),
      `Log MUST contain shutdown/SIGTERM message on graceful exit. ` +
      `Got log:\n${logContent}`,
    );

    // Verify stderr also got the message (for console visibility)
    const stderrText = stderr.join("");
    assert.ok(
      stderrText.includes("shutting down") || stderrText.includes("Shutting down") ||
      stderrText.includes("SIGTERM") || stderrText.includes("Server stopped"),
      `Stderr MUST contain shutdown message. Got:\n${stderrText.substring(0, 500)}`,
    );
  });
});
