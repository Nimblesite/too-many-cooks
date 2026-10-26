/// Shared spawned-server lifecycle helpers for integration tests
/// ([DEDUP-DESLOP]): spawn on a port, poll /admin/status until ready,
/// kill, wait for exit, and clean up the temp workspace.

import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";

import { SERVER_BINARY, SERVER_NODE_ARGS } from "../../src/config.js";
import { parseJsonRecord } from "./json.js";

export const DEFAULT_POLL_ATTEMPTS = 30;
export const DEFAULT_POLL_INTERVAL_MS = 200;
export const ADMIN_STATUS_PATH = "/admin/status";
export const ADMIN_RESET_PATH = "/admin/reset";

/** Sentinel returned by waitForExit when the process never exits. */
export const STILL_RUNNING = "still-running";

export const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const buildBaseUrl = (port: number): string =>
  `http://localhost:${String(port)}`;

export type SpawnedServer = {
  readonly proc: ChildProcess;
  readonly workspace: string;
  readonly stderr: readonly string[];
};

export type SpawnServerOptions = {
  readonly port: number;
  /** Temp-dir prefix; omit when passing an explicit workspace. */
  readonly tmpPrefix?: string;
  /** Explicit workspace dir (overrides tmpPrefix). */
  readonly workspace?: string;
  /** Pipe stderr and collect it (default: inherit). */
  readonly captureStderr?: boolean;
  /** Base env (defaults to the parent environment). */
  readonly env?: NodeJS.ProcessEnv;
};

const spawnProc = (
  opts: SpawnServerOptions,
  workspace: string,
): ChildProcess => {
  const baseEnv = opts.env ?? process.env;
  return spawn("node", [...SERVER_NODE_ARGS, SERVER_BINARY], {
    stdio: ["pipe", "pipe", opts.captureStderr === true ? "pipe" : "inherit"],
    env: {
      ...baseEnv,
      TMC_PORT: String(opts.port),
      TMC_WORKSPACE: workspace,
    },
  });
};

/** Spawns the server binary on a port with its own temp workspace. */
export const spawnServer = (opts: SpawnServerOptions): SpawnedServer => {
  const workspace =
    opts.workspace ?? mkdtempSync(opts.tmpPrefix ?? "/tmp/tmc-test-");
  const stderr: string[] = [];
  const proc = spawnProc(opts, workspace);
  if (opts.captureStderr === true) {
    proc.stderr?.on("data", (chunk: Buffer): void => {
      stderr.push(chunk.toString());
    });
  }
  return { proc, workspace, stderr };
};

/** Polls GET /admin/status until it responds ok, or throws. */
export const waitForServer = async (
  baseUrl: string,
  attempts: number = DEFAULT_POLL_ATTEMPTS,
  intervalMs: number = DEFAULT_POLL_INTERVAL_MS,
): Promise<void> => {
  const url = `${baseUrl}${ADMIN_STATUS_PATH}`;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) {
        return;
      }
    } catch {
      // Not ready yet
    }
    if (i === attempts - 1) {
      throw new Error("Server failed to start");
    }
    await sleep(intervalMs);
  }
};

export const killServer = (proc: ChildProcess): void => {
  proc.kill();
};

/** Wait for a process to exit; resolves its code, or STILL_RUNNING. */
export const waitForExit = async (
  proc: ChildProcess,
  timeoutMs: number,
): Promise<number | null | typeof STILL_RUNNING> =>
  new Promise((resolve) => {
    if (proc.exitCode !== null) {
      resolve(proc.exitCode);
      return;
    }
    const timer = setTimeout((): void => {
      resolve(STILL_RUNNING);
    }, timeoutMs);
    proc.once("exit", (code: number | null): void => {
      clearTimeout(timer);
      resolve(code);
    });
  });

export type AdminStatus = {
  readonly status: number;
  readonly body: Record<string, unknown>;
};

/** GETs /admin/status and returns status code plus parsed body. */
export const fetchAdminStatus = async (
  port: number,
): Promise<AdminStatus> => {
  const url = `${buildBaseUrl(port)}${ADMIN_STATUS_PATH}`;
  const response = await fetch(url);
  const body = parseJsonRecord(await response.text());
  return { status: response.status, body };
};

/** POSTs /admin/reset; throws when the reset fails. */
export const resetServerViaAdmin = async (baseUrl: string): Promise<void> => {
  const r = await fetch(`${baseUrl}${ADMIN_RESET_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!r.ok) {
    throw new Error("Failed to reset server");
  }
};
