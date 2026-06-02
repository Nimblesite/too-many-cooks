/// [SERVER-NO-KILL] — Too Many Cooks must NEVER kill the process that owns a
/// port it wants. Issue #33: a second window ran `lsof -ti :4040` + `kill -9`
/// and terminated a DIFFERENT project's process.
///
/// This test puts a foreign (non-TMC) process on the target port, then starts
/// the TMC server on that same port. The TMC server MUST leave the foreign
/// process completely alone and step aside itself.

import { describe, it, after } from "node:test";
import assert from "node:assert";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";

import { SERVER_BINARY, SERVER_NODE_ARGS } from "../src/config.js";

// ============================================================
// Constants
// ============================================================

const PORT_FOREIGN = 4070;
const TMP_PREFIX = "/tmp/tmc-nocrosskill-";
const STEP_ASIDE_TIMEOUT_MS = 10000;
const READY_TIMEOUT_MS = 10000;
const STILL_RUNNING = "still-running";
const SENTINEL_READY_MARKER = "LISTENING";

/// A bare TCP listener that binds the port the same way the server does
/// (no explicit host → Node's default address), prints a readiness marker,
/// then stays alive. It is NOT a Too Many Cooks server.
const SENTINEL_SCRIPT =
  "const s=require('net').createServer(c=>{c.destroy();});" +
  "s.on('error',()=>process.exit(2));" +
  "s.listen(Number(process.argv[1]),()=>{process.stdout.write('LISTENING\\n');});" +
  "setInterval(()=>{},1000000);";

// ============================================================
// Helpers
// ============================================================

const spawnSentinel = (port: number): ChildProcess =>
  spawn("node", ["-e", SENTINEL_SCRIPT, String(port)], {
    stdio: ["ignore", "pipe", "ignore"],
  });

const waitForMarker = async (
  proc: ChildProcess,
  marker: string,
  timeoutMs: number,
): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout((): void => {
      reject(new Error(`Sentinel did not emit "${marker}" within ${String(timeoutMs)}ms`));
    }, timeoutMs);
    proc.stdout?.on("data", (chunk: Buffer): void => {
      if (chunk.toString().includes(marker)) {
        clearTimeout(timer);
        resolve();
      }
    });
  });

const spawnServerOnPort = (port: number): {
  readonly proc: ChildProcess;
  readonly workspace: string;
  readonly stderr: string[];
} => {
  const workspace = mkdtempSync(TMP_PREFIX);
  const stderr: string[] = [];
  const proc = spawn("node", [...SERVER_NODE_ARGS, SERVER_BINARY], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, TMC_PORT: String(port), TMC_WORKSPACE: workspace },
  });
  proc.stderr?.on("data", (chunk: Buffer): void => { stderr.push(chunk.toString()); });
  return { proc, workspace, stderr };
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

describe("server never kills a foreign process holding its port", () => {
  let sentinel: ChildProcess;
  let server: ChildProcess;
  let workspace: string;
  let sentinelExited = false;

  after(() => {
    server.kill("SIGKILL");
    sentinel.kill("SIGKILL");
    rmSync(workspace, { recursive: true, force: true });
  });

  it("foreign port owner survives and the TMC server steps aside", async () => {
    // Park a foreign (non-TMC) process on the port.
    sentinel = spawnSentinel(PORT_FOREIGN);
    sentinel.once("exit", (): void => { sentinelExited = true; });
    await waitForMarker(sentinel, SENTINEL_READY_MARKER, READY_TIMEOUT_MS);

    // Start the TMC server on the SAME port.
    const spawned = spawnServerOnPort(PORT_FOREIGN);
    server = spawned.proc;
    workspace = spawned.workspace;

    // The TMC server MUST give up — never kill the foreign owner.
    const exitResult = await waitForExit(server, STEP_ASIDE_TIMEOUT_MS);

    // THE KEY ASSERTION: the foreign process MUST still be alive.
    assert.strictEqual(
      sentinelExited,
      false,
      `Foreign process on port ${String(PORT_FOREIGN)} MUST NOT be killed by the TMC server. ` +
      `Server stderr:\n${spawned.stderr.join("")}`,
    );

    // And the TMC server itself MUST step aside rather than run.
    assert.notStrictEqual(
      exitResult,
      STILL_RUNNING,
      "TMC server MUST exit when the port is held by another process, not keep running",
    );
    assert.notStrictEqual(
      exitResult,
      0,
      "TMC server MUST exit with a non-zero code when it cannot bind the port",
    );
  });
});
