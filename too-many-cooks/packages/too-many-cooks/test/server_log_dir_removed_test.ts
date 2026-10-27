/// [LOGGING] Regression: a log write must never crash the server. When the
/// workspace's .too_many_cooks/logs directory vanished while the server ran
/// (cleaned workspace, deleted temp dir), the next log line — e.g. the SIGTERM
/// "Server shutting down" line — threw ENOENT from the file transport, became
/// an uncaught exception, and the server died with a FATAL instead of shutting
/// down cleanly.

import { after, describe, it } from "node:test";
import assert from "node:assert";
import { rmSync } from "node:fs";
import { join } from "node:path";

import {
  STILL_RUNNING,
  buildBaseUrl,
  spawnServer,
  waitForExit,
  waitForServer,
  type SpawnedServer,
  stopAndRemoveAll,
} from "./support/server_process.js";

const PORT = 4093;
const TMP_PREFIX = "/tmp/tmc-logdir-gone-";
const LOGS_REL = join(".too_many_cooks", "logs");
const EXIT_OK = 0;
const EXIT_TIMEOUT_MS = 20000;
const WAIT_ATTEMPTS = 100;
const WAIT_INTERVAL_MS = 100;
const SHUTDOWN_MARKER = "Server shutting down";
const CRASH_MARKER = "Uncaught exception";

describe("server survives its log directory being removed", () => {
  const spawned: SpawnedServer[] = [];

  after(async () => {
    await stopAndRemoveAll(spawned, "SIGKILL");
  });

  it("shuts down with exit 0 (no FATAL) on SIGTERM after logs/ is deleted", async () => {
    const server = spawnServer({ port: PORT, tmpPrefix: TMP_PREFIX, captureStderr: true });
    spawned.push(server);
    await waitForServer(buildBaseUrl(PORT), WAIT_ATTEMPTS, WAIT_INTERVAL_MS);

    rmSync(join(server.workspace, LOGS_REL), { recursive: true, force: true });
    server.proc.kill("SIGTERM");

    const code: number | null | typeof STILL_RUNNING = await waitForExit(server.proc, EXIT_TIMEOUT_MS);
    const stderr: string = server.stderr.join("");
    assert.notStrictEqual(code, STILL_RUNNING, "server must exit after SIGTERM");
    assert.ok(!stderr.includes(CRASH_MARKER), `log write must not crash the server; stderr:\n${stderr}`);
    assert.ok(stderr.includes(SHUTDOWN_MARKER), `shutdown must still be logged to the console; stderr:\n${stderr}`);
    assert.strictEqual(code, EXIT_OK, `server must exit cleanly; stderr:\n${stderr}`);
  });
});
