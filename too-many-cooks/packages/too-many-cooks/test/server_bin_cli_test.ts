/// [SERVER-CLI] bin/server.ts entry-point contract, driven by spawning the
/// REAL binary: the deploy-toolkit `--version`/`-V`/`--json` output (exact
/// bytes), the fatal-exit path when the backend cannot be created, the
/// [SERVER-PORT-CONFLICT] step-aside on EADDRINUSE, and clean SIGINT shutdown.
/// [SERVER-NO-KILL] nothing kills processes it does not own.
///
/// Spawning/lifecycle boilerplate comes from test/support/server_process.ts.

import { after, describe, it } from "node:test";
import assert from "node:assert";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";

import { SERVER_BINARY, SERVER_NODE_ARGS } from "../src/config.js";
import {
  STILL_RUNNING,
  buildBaseUrl,
  spawnServer,
  waitForExit,
  waitForServer,
  type SpawnedServer,
  stopAndRemoveAll,
} from "./support/server_process.js";

const PORT_SHUTDOWN = 4091;
const PORT_CONFLICT = 4092;
const PORT_BAD_ENV = 4098;
const TMP_PREFIX = "/tmp/tmc-cli-cov-";
const VERSION_LINE = "too-many-cooks 0.0.0-dev";
const VERSION_JSON_LINE =
  '{"manifestVersion":1,"name":"too-many-cooks","version":"0.0.0-dev","kind":"mcp","language":"typescript","product":"too-many-cooks"}';
const MISSING_ENV_ERROR = "Missing required env var: TMC_WORKSPACE_ID";
const PORT_IN_USE_MARKER = "Port already in use";
const SHUTDOWN_MARKER = "Server shutting down";
const EXIT_OK = 0;
const EXIT_ERROR = 1;
const EXIT_TIMEOUT_MS = 20000;

const spawned: SpawnedServer[] = [];

/** Spawn the bin with CLI args (only --version needs args; servers use spawnServer). */
const spawnVersionBin = (args: readonly string[]): { proc: ChildProcess; stdout: string[] } => {
  const stdout: string[] = [];
  const proc = spawn("node", [...SERVER_NODE_ARGS, SERVER_BINARY, ...args], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
  });
  proc.stdout?.on("data", (chunk: Buffer): void => { stdout.push(chunk.toString()); });
  return { proc, stdout };
};

/** Spawn a server, remember it for teardown, and return it. */
const spawnTracked = (opts: { port: number; captureStderr: boolean; env?: NodeJS.ProcessEnv }): SpawnedServer => {
  const server = spawnServer({ tmpPrefix: TMP_PREFIX, ...opts });
  spawned.push(server);
  return server;
};

/** Assert the process exited with `expected` inside the timeout. */
const expectExit = async (proc: ChildProcess, expected: number): Promise<void> => {
  const code: number | null | typeof STILL_RUNNING = await waitForExit(proc, EXIT_TIMEOUT_MS);
  if (code === STILL_RUNNING || code === null) { assert.fail("process did not exit in time"); }
  assert.strictEqual(code, expected);
};

after(async () => {
  await stopAndRemoveAll(spawned);
});

describe("server --version contract", () => {
  it("prints name and version then exits 0", async () => {
    const run = spawnVersionBin(["--version"]);
    await expectExit(run.proc, EXIT_OK);
    assert.strictEqual(run.stdout.join(""), `${VERSION_LINE}\n`);
  });

  it("-V is an alias for --version", async () => {
    const run = spawnVersionBin(["-V"]);
    await expectExit(run.proc, EXIT_OK);
    assert.strictEqual(run.stdout.join(""), `${VERSION_LINE}\n`);
  });

  it("--version --json prints the exact deploy-toolkit manifest", async () => {
    const run = spawnVersionBin(["--version", "--json"]);
    await expectExit(run.proc, EXIT_OK);
    assert.strictEqual(run.stdout.join(""), `${VERSION_JSON_LINE}\n`);
  });
});

describe("server fatal startup paths", () => {
  it("exits 1 with Fatal when the cloud backend env is incomplete", async () => {
    const server = spawnTracked({
      port: PORT_BAD_ENV,
      captureStderr: true,
      env: { ...process.env, TMC_API_KEY: "key-without-workspace" },
    });
    await expectExit(server.proc, EXIT_ERROR);
    const stderr = server.stderr.join("");
    assert.ok(stderr.includes(MISSING_ENV_ERROR), stderr);
    assert.ok(stderr.includes("Fatal"), stderr);
  });

  it("steps aside with exit 1 when the port is already in use", async () => {
    const blocker: Server = createServer();
    await new Promise<void>((resolve: () => void): void => {
      blocker.listen(PORT_CONFLICT, (): void => { resolve(); });
    });
    try {
      const server = spawnTracked({ port: PORT_CONFLICT, captureStderr: true });
      await expectExit(server.proc, EXIT_ERROR);
      assert.ok(server.stderr.join("").includes(PORT_IN_USE_MARKER));
    } finally {
      await new Promise<void>((resolve: () => void): void => { blocker.close((): void => { resolve(); }); });
    }
  });

  it("shuts down cleanly with exit 0 on SIGINT", async () => {
    const server = spawnTracked({ port: PORT_SHUTDOWN, captureStderr: true });
    await waitForServer(buildBaseUrl(PORT_SHUTDOWN), 100, 100);
    server.proc.kill("SIGINT");
    await expectExit(server.proc, EXIT_OK);
    assert.ok(server.stderr.join("").includes(SHUTDOWN_MARKER));
  });
});
