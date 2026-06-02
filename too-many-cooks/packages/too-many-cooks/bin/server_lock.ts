/// Per-folder single-instance lock for the Too Many Cooks server.
///
/// Spec: docs/spec.md [SERVER-SINGLE-INSTANCE], [SERVER-LOCKFILE], [SERVER-NO-KILL].
///
/// This lives in the LOCAL server package (not shared core) on purpose: the lock
/// is process-local (it uses `process.pid`/`process.kill`) and only the local
/// SQLite server needs it — the cloud backend is remote and stateless. Shipping
/// it here also means the published bin never depends on a newer core release.
///
/// The lock is a JSON file in the workspace's `.too_many_cooks/` directory — the
/// same directory the database lives in (derived via core's `resolveDbPath`). It
/// answers "is Too Many Cooks already running in THIS folder?" without depending
/// on the port, because two instances in one folder would share one database.

import fs from "node:fs";
import path from "node:path";
import { type Result, error, resolveDbPath, success } from "too-many-cooks-core";

/** Lock file name inside the `.too_many_cooks` state directory. [SERVER-LOCKFILE] */
const LOCK_FILE_NAME: string = "server.lock";

/** Shape of the persisted lock file. [SERVER-LOCKFILE] */
export type ServerLock = {
  readonly pid: number;
  readonly port: number;
  readonly startedAt: number;
};

/** Outcome of trying to claim the folder. */
export type LockOutcome =
  | { readonly kind: "acquired"; readonly path: string }
  | { readonly kind: "busy"; readonly path: string; readonly existing: ServerLock };

/**
 * Resolve the lock file path for a workspace folder. Reuses core's database-path
 * logic so the lock always sits next to `data.db` in `.too_many_cooks/`.
 * [SERVER-STATE-ISOLATION]
 */
export const resolveLockPath: (workspaceFolder: string) => string = (workspaceFolder: string): string =>
  {return path.join(path.dirname(resolveDbPath(workspaceFolder)), LOCK_FILE_NAME)};

/** Read the `code` field off an unknown thrown value without a type assertion. */
export const errorCode: (e: unknown) => string | undefined = (e: unknown): string | undefined =>
  typeof e === "object" && e !== null && "code" in e && typeof e.code === "string"
    ? e.code
    : undefined;

/**
 * Is a process with this PID currently alive? `process.kill(pid, 0)` sends NO
 * signal — it only probes existence ([SERVER-NO-KILL]: we never terminate anything).
 * `EPERM` means the process exists but is owned by someone else → still alive.
 */
const isPidAlive: (pid: number) => boolean = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: unknown) {
    return errorCode(e) === "EPERM";
  }
};

/** Narrow an unknown parsed value to a ServerLock, or undefined if it is not one. */
const toServerLock: (value: unknown) => ServerLock | undefined = (value: unknown): ServerLock | undefined => {
  if (typeof value !== "object" || value === null) {return undefined;}
  const pid: unknown = "pid" in value ? value.pid : undefined;
  const port: unknown = "port" in value ? value.port : undefined;
  const startedAt: unknown = "startedAt" in value ? value.startedAt : undefined;
  if (typeof pid !== "number" || typeof port !== "number" || typeof startedAt !== "number") {return undefined;}
  return { pid, port, startedAt };
};

/** Read an existing lock file, or undefined if missing/corrupt. */
const readLock: (lockPath: string) => ServerLock | undefined = (lockPath: string): ServerLock | undefined => {
  if (!fs.existsSync(lockPath)) {return undefined;}
  try {
    return toServerLock(JSON.parse(fs.readFileSync(lockPath, "utf8")));
  } catch {
    return undefined;
  }
};

/** Write our own lock, creating the state directory if needed. */
const writeLock: (lockPath: string, lock: ServerLock) => Result<LockOutcome, string> = (
  lockPath: string,
  lock: ServerLock,
): Result<LockOutcome, string> => {
  try {
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, JSON.stringify(lock));
    return success({ kind: "acquired", path: lockPath });
  } catch (e: unknown) {
    return error(`Failed to write lock file ${lockPath}: ${String(e)}`);
  }
};

/**
 * Try to claim this workspace folder for the current process. Returns `busy` if a
 * LIVE Too Many Cooks process already holds the lock; otherwise overwrites any
 * stale lock (left by a crash / `kill -9`) and returns `acquired`.
 * [SERVER-SINGLE-INSTANCE]
 */
export const acquireServerLock: (
  lockPath: string,
  port: number,
  startedAt: number,
) => Result<LockOutcome, string> = (
  lockPath: string,
  port: number,
  startedAt: number,
): Result<LockOutcome, string> => {
  const existing: ServerLock | undefined = readLock(lockPath);
  if (existing !== undefined && isPidAlive(existing.pid)) {
    return success({ kind: "busy", path: lockPath, existing });
  }
  return writeLock(lockPath, { pid: process.pid, port, startedAt });
};

/** Remove the lock on shutdown — but only if it still records OUR pid. [SERVER-LOCKFILE] */
export const releaseServerLock: (lockPath: string) => void = (lockPath: string): void => {
  const existing: ServerLock | undefined = readLock(lockPath);
  if (existing?.pid === process.pid) {
    try {
      fs.rmSync(lockPath, { force: true });
    } catch {
      // Best-effort cleanup: a missing lock on the way out is not an error.
    }
  }
};
