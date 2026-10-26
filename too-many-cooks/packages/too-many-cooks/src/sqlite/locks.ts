/// SQLite file lock operations.

import type Database from "better-sqlite3";

import {
  type DbError,
  ERR_DATABASE,
  ERR_LOCK_HELD,
  ERR_NOT_FOUND,
  type FileLock,
  type LockResult,
  type Logger,
  type Result,
  error,
  fileLockFromJson,
  success,
} from "too-many-cooks-core";

import type { LockMethodGroup } from "../db-method-groups.js";
import {
  type SqliteParams,
  attempt,
  authedWrite,
  authenticated,
  now,
  selectMappedRows,
  selectOneOrNull,
} from "./shared.js";

/** Fetch the lock row for one file path. */
const SQL_QUERY_LOCK: string = "SELECT * FROM locks WHERE file_path = ?";

/** List every lock row. */
const SQL_LIST_LOCKS: string = "SELECT * FROM locks";

/** Insert a lock row. */
const SQL_INSERT_LOCK: string =
  "INSERT INTO locks (file_path, agent_name, acquired_at, expires_at, reason) VALUES (?, ?, ?, ?, ?)";

/** Delete a lock regardless of holder. */
const SQL_DELETE_LOCK: string = "DELETE FROM locks WHERE file_path = ?";

/** Delete a lock held by one agent. */
const SQL_DELETE_LOCK_FOR_AGENT: string = "DELETE FROM locks WHERE file_path = ? AND agent_name = ?";

/** Extend a lock's expiry (bumps its version). */
const SQL_RENEW_LOCK: string =
  "UPDATE locks SET expires_at = ?, version = version + 1 WHERE file_path = ? AND agent_name = ?";

/** Initial version of a freshly inserted lock row. */
const INITIAL_LOCK_VERSION: number = 1;

/** Query lock for a file path. */
const queryLock: (db: Database.Database, log: Logger, filePath: string) => Result<FileLock | null, DbError> = (
  db: Database.Database,
  log: Logger,
  filePath: string
): Result<FileLock | null, DbError> => {
  log.trace(`Querying lock for ${filePath}`);
  return selectOneOrNull(db, SQL_QUERY_LOCK, [filePath], fileLockFromJson);
};

/** Delete a lock by file path. */
const deleteExpiredLock: (db: Database.Database, filePath: string) => Result<void, DbError> = (
  db: Database.Database,
  filePath: string
): Result<void, DbError> => {
  return attempt((): Result<void, DbError> => {
    db.prepare(SQL_DELETE_LOCK).run(filePath);
    return success(undefined);
  });
};

/** Insert a new lock row. */
const insertLock: (
  db: Database.Database,
  filePath: string,
  agentName: string,
  timestamp: number,
  expiresAt: number,
  reason: string | null | undefined
) => Result<LockResult, DbError> = (
  db: Database.Database,
  filePath: string,
  agentName: string,
  timestamp: number,
  expiresAt: number,
  reason: string | null | undefined
): Result<LockResult, DbError> => {
  try {
    db.prepare(SQL_INSERT_LOCK).run(filePath, agentName, timestamp, expiresAt, reason ?? null);
    return success({
      acquired: true,
      lock: {
        filePath,
        agentName,
        acquiredAt: timestamp,
        expiresAt,
        reason: reason ?? null,
        version: INITIAL_LOCK_VERSION,
      },
      error: undefined,
    });
  } catch (e: unknown) {
    const msg: string = String(e);
    return msg.includes("UNIQUE")
      ? success({ acquired: false, lock: undefined, error: "Lock race condition" })
      : error({ code: ERR_DATABASE, message: msg });
  }
};

/** Acquire a file lock. */
const acquireLock: (
  db: Database.Database,
  log: Logger,
  filePath: string,
  agentName: string,
  agentKey: string,
  reason: string | null | undefined,
  timeoutMs: number
) => Result<LockResult, DbError> = (
  db: Database.Database,
  log: Logger,
  filePath: string,
  agentName: string,
  agentKey: string,
  reason: string | null | undefined,
  timeoutMs: number
): Result<LockResult, DbError> => {
  log.debug(`Acquiring lock on ${filePath} for ${agentName}`);
  return authenticated(db, agentName, agentKey, (): Result<LockResult, DbError> =>
    takeLock(db, log, filePath, agentName, reason, timeoutMs)
  );
};

/** Check the current holder, evict expired locks, then insert. */
const takeLock: (
  db: Database.Database,
  log: Logger,
  filePath: string,
  agentName: string,
  reason: string | null | undefined,
  timeoutMs: number
) => Result<LockResult, DbError> = (
  db: Database.Database,
  log: Logger,
  filePath: string,
  agentName: string,
  reason: string | null | undefined,
  timeoutMs: number
): Result<LockResult, DbError> => {
  const timestamp: number = now();
  const existing: Result<FileLock | null, DbError> = queryLock(db, log, filePath);
  if (!existing.ok) {
    return existing;
  }
  const current: FileLock | null = existing.value;
  if (current !== null && current.expiresAt > timestamp) {
    return success({
      acquired: false,
      lock: undefined,
      error: `Held by ${current.agentName} until ${String(current.expiresAt)}`,
    });
  }
  if (current !== null) {
    const delResult: Result<void, DbError> = deleteExpiredLock(db, filePath);
    if (!delResult.ok) {
      return delResult;
    }
  }
  return insertLock(db, filePath, agentName, timestamp, timestamp + timeoutMs, reason);
};

/** Release a file lock. */
const releaseLock: (
  db: Database.Database,
  log: Logger,
  filePath: string,
  agentName: string,
  agentKey: string
) => Result<void, DbError> = (
  db: Database.Database,
  log: Logger,
  filePath: string,
  agentName: string,
  agentKey: string
): Result<void, DbError> => {
  log.debug(`Releasing lock on ${filePath} for ${agentName}`);
  const params: SqliteParams = [filePath, agentName];
  return authedWrite(db, agentName, agentKey, SQL_DELETE_LOCK_FOR_AGENT, params, {
    code: ERR_NOT_FOUND,
    message: "Lock not held by you",
  });
};

/** Force release an expired lock. */
const forceReleaseLock: (
  db: Database.Database,
  log: Logger,
  filePath: string,
  agentName: string,
  agentKey: string
) => Result<void, DbError> = (
  db: Database.Database,
  log: Logger,
  filePath: string,
  agentName: string,
  agentKey: string
): Result<void, DbError> => {
  log.debug(`Force releasing lock on ${filePath} for ${agentName}`);
  return authenticated(db, agentName, agentKey, (): Result<void, DbError> => evictIfExpired(db, log, filePath));
};

/** Delete the lock only once it has actually expired. */
const evictIfExpired: (db: Database.Database, log: Logger, filePath: string) => Result<void, DbError> = (
  db: Database.Database,
  log: Logger,
  filePath: string
): Result<void, DbError> => {
  const existing: Result<FileLock | null, DbError> = queryLock(db, log, filePath);
  if (!existing.ok) {
    return existing;
  }
  if (existing.value === null) {
    return error({ code: ERR_NOT_FOUND, message: "No lock exists" });
  }
  if (existing.value.expiresAt > now()) {
    return error({
      code: ERR_LOCK_HELD,
      message: `Lock not expired, held by ${existing.value.agentName}`,
    });
  }
  return deleteExpiredLock(db, filePath);
};

/** List all locks. */
const listLocks: (db: Database.Database, log: Logger) => Result<readonly FileLock[], DbError> = (
  db: Database.Database,
  log: Logger
): Result<readonly FileLock[], DbError> => {
  log.trace("Listing all locks");
  return selectMappedRows(db, SQL_LIST_LOCKS, fileLockFromJson);
};

/** Renew a file lock. */
const renewLock: (
  db: Database.Database,
  log: Logger,
  filePath: string,
  agentName: string,
  agentKey: string,
  timeoutMs: number
) => Result<void, DbError> = (
  db: Database.Database,
  log: Logger,
  filePath: string,
  agentName: string,
  agentKey: string,
  timeoutMs: number
): Result<void, DbError> => {
  log.debug(`Renewing lock on ${filePath} for ${agentName}`);
  const params: SqliteParams = [now() + timeoutMs, filePath, agentName];
  return authedWrite(db, agentName, agentKey, SQL_RENEW_LOCK, params, {
    code: ERR_NOT_FOUND,
    message: "Lock not held by you",
  });
};

/** Build lock operations. */
export const createLockOps: (db: Database.Database, log: Logger) => LockMethodGroup = (
  db: Database.Database,
  log: Logger
): LockMethodGroup => ({
  acquireLock: async (
    filePath: string,
    name: string,
    key: string,
    reason: string | null | undefined,
    timeout: number
  ): Promise<Result<LockResult, DbError>> =>
    await Promise.resolve(acquireLock(db, log, filePath, name, key, reason, timeout)),
  forceReleaseLock: async (filePath: string, name: string, key: string): Promise<Result<void, DbError>> =>
    await Promise.resolve(forceReleaseLock(db, log, filePath, name, key)),
  listLocks: async (): Promise<Result<readonly FileLock[], DbError>> => await Promise.resolve(listLocks(db, log)),
  queryLock: async (filePath: string): Promise<Result<FileLock | null, DbError>> =>
    await Promise.resolve(queryLock(db, log, filePath)),
  releaseLock: async (filePath: string, name: string, key: string): Promise<Result<void, DbError>> =>
    await Promise.resolve(releaseLock(db, log, filePath, name, key)),
  renewLock: async (filePath: string, name: string, key: string, timeout: number): Promise<Result<void, DbError>> =>
    await Promise.resolve(renewLock(db, log, filePath, name, key, timeout)),
});
