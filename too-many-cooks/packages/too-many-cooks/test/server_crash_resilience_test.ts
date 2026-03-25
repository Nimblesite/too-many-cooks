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
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, readdirSync } from "node:fs";

import { SERVER_BINARY, SERVER_NODE_ARGS } from "../src/config.js";

// ============================================================
// Constants
// ============================================================

const PORT_SIGTERM_TEST = 4054;
const MAX_POLL_ATTEMPTS = 30;
const POLL_INTERVAL_MS = 200;
const ADMIN_STATUS_PATH = "/admin/status";
const TMP_PREFIX = "/tmp/tmc-crash-test-";
const STATUS_OK = 200;
const EXIT_SETTLE_MS = 1000;

// ============================================================
// Helpers
// ============================================================

const buildBaseUrl = (port: number): string =>
  `http://localhost:${String(port)}`;

const spawnOnPort = (port: number): {
  readonly proc: ChildProcess;
  readonly workspace: string;
  readonly stderr: string[];
} => {
  const workspace = mkdtempSync(TMP_PREFIX);
  const stderr: string[] = [];
  const proc = spawn("node", [...SERVER_NODE_ARGS, SERVER_BINARY], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      TMC_PORT: String(port),
      TMC_WORKSPACE: workspace,
    },
  });
  proc.stderr?.on("data", (chunk: Buffer): void => {
    stderr.push(chunk.toString());
  });
  return { proc, workspace, stderr };
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
  const url = `${buildBaseUrl(port)}${ADMIN_STATUS_PATH}`;
  const response = await fetch(url);
  return response.status;
};

// ============================================================
// Tests
// ============================================================

describe("server handles SIGTERM gracefully (not silent death)", () => {
  let proc: ChildProcess;
  let workspace: string;
  let stderr: string[];

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
    const logsDir = `${workspace}/logs`;
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
