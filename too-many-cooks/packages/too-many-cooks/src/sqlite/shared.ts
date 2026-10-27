/// Shared helpers for the SQLite backend modules: constants, key/time helpers,
/// row narrowing and Result-wrapping query combinators. These collapse the
/// repeated try/catch, changes-count and row-mapping patterns that used to be
/// duplicated across every operation in db-sqlite.ts.

import type Database from "better-sqlite3";
import { randomBytes } from "node:crypto";

import {
  type DbError,
  ERR_DATABASE,
  ERR_UNAUTHORIZED,
  ERR_VALIDATION,
  type Logger,
  type Result,
  createLoggerWithContext,
  createLoggingContext,
  error,
  success,
} from "too-many-cooks-core";

import { isRecord } from "../json-guards.js";

/** Key length in bytes for generating hex keys. */
const KEY_BYTE_LENGTH: number = 32;

/** Length of message ID substring. */
export const MESSAGE_ID_LENGTH: number = 16;

/** Minimum agent name length. */
const MIN_AGENT_NAME_LENGTH: number = 1;

/** Maximum agent name length. */
export const MAX_AGENT_NAME_LENGTH: number = 50;

/** Active flag value. */
export const ACTIVE_TRUE: number = 1;

/** Inactive flag value. */
export const ACTIVE_FALSE: number = 0;

/** Prefix for the seeded broadcast sentinel's synthetic key. */
const SENTINEL_KEY_PREFIX: string = "__broadcast_sentinel_";

/** Broadcast recipient marker. Also the reserved agent_name of the sentinel
 *  identity row that lets the messages.to_agent foreign key target broadcasts
 *  without orphaning them. The sentinel is created with active=0 so
 *  listAgents (which filters by active=1) never surfaces it in the UI. */
export const BROADCAST_RECIPIENT: string = "*";

/** SQLite bind parameter values used by this backend. */
export type SqliteParams = ReadonlyArray<null | number | string>;

/** Idempotently (re)create an inactive identity row so FKs resolve. */
const SQL_ENSURE_INACTIVE_IDENTITY: string =
  "INSERT OR IGNORE INTO identity (agent_name, agent_key, active, registered_at, last_active) VALUES (?, ?, 0, ?, ?)";

/** Touch last_active on successful credential check. */
const SQL_AUTH_UPDATE: string = "UPDATE identity SET last_active = ? WHERE agent_name = ? AND agent_key = ?";

/** Generate a hex key from random bytes. */
export const generateKey = (): string => randomBytes(KEY_BYTE_LENGTH).toString("hex");

/** Current time in milliseconds. */
export const now = (): number => Date.now();

/** Create a no-op logger. */
export const noOpLogger = (): Logger => createLoggerWithContext(createLoggingContext());

/** Generate a fresh message ID. */
export const newMessageId = (): string => generateKey().substring(0, MESSAGE_ID_LENGTH);

/** SQLite-specific retryable errors. */
export const isSqliteRetryable = (err: string): boolean =>
  err.includes("disk I/O error") || err.includes("database is locked") || err.includes("SQLITE_BUSY");

/** Run `op`, converting thrown SQLite errors into ERR_DATABASE results. */
export const attempt = <T>(op: () => Result<T, DbError>): Result<T, DbError> => {
  try {
    return op();
  } catch (e: unknown) {
    return error({ code: ERR_DATABASE, message: String(e) });
  }
};

/** Narrow an unknown SQLite row to Record<string, unknown> or undefined. */
export const toRow = (value: unknown): Record<string, unknown> | undefined =>
  isRecord(value) ? value : undefined;

/** Narrow unknown SQLite rows array to ReadonlyArray<Record<string, unknown>>. */
export const toRows = (value: unknown[]): ReadonlyArray<Record<string, unknown>> => value.filter(isRecord);

/// Reads `column` from `row` and hands the string to `onValue`; a non-string
/// column value is a database-shape error, not a crash ([DEDUP-DESLOP]).
export const withStringColumn = <T>(
  row: Record<string, unknown>,
  column: string,
  missingMessage: string,
  onValue: (value: string) => Result<T, DbError>
): Result<T, DbError> => {
  const value: unknown = row[column];
  return typeof value === "string"
    ? onValue(value)
    : error({ code: ERR_DATABASE, message: missingMessage });
};

/** Run a write; zero changes maps to `miss`, otherwise success(undefined). */
export const runOrMiss = (stmt: Database.Statement, params: SqliteParams, miss: DbError): Result<void, DbError> => {
  const result: Database.RunResult = stmt.run(...params);
  return result.changes === 0 ? error(miss) : success(undefined);
};

/** Run `sql`, map every row with `mapper`. */
export const selectMapped = <T>(
  db: Database.Database,
  sql: string,
  mapper: (row: Record<string, unknown>) => T
): readonly T[] => toRows(db.prepare(sql).all()).map(mapper);

/** Map a possibly-missing row to T | null. */
export const maybeRow = <T>(
  row: Record<string, unknown> | undefined,
  mapper: (row: Record<string, unknown>) => T
): T | null => (row === undefined ? null : mapper(row));

/** Validate a message body against the configured maximum length. */
export const validateContentLength = (content: string, maxLen: number): Result<void, DbError> =>
  content.length > maxLen
    ? error({ code: ERR_VALIDATION, message: `Content exceeds ${String(maxLen)} chars` })
    : success(undefined);

/** Validate plan fields against the configured maximum length. */
export const validatePlanLengths = (goal: string, currentTask: string, maxLen: number): Result<void, DbError> =>
  goal.length > maxLen || currentTask.length > maxLen
    ? error({ code: ERR_VALIDATION, message: `Fields exceed ${String(maxLen)} chars` })
    : success(undefined);

/** Validate an agent name's length bounds. */
export const isNameLengthValid = (name: string): boolean =>
  name.length >= MIN_AGENT_NAME_LENGTH && name.length <= MAX_AGENT_NAME_LENGTH;

/** Authenticate agent and update last_active timestamp. */
export const authAndUpdate = (
  db: Database.Database,
  agentName: string,
  agentKey: string
): Result<void, DbError> =>
  attempt((): Result<void, DbError> => {
    const result: Database.RunResult = db.prepare(SQL_AUTH_UPDATE).run(now(), agentName, agentKey);
    return result.changes === 0
      ? error({ code: ERR_UNAUTHORIZED, message: "Invalid credentials" })
      : success(undefined);
  });

/** Authenticate, then run `op`; auth errors propagate untouched. */
export const authenticated = <T>(
  db: Database.Database,
  agentName: string,
  agentKey: string,
  op: () => Result<T, DbError>
): Result<T, DbError> => {
  const authResult: Result<void, DbError> = authAndUpdate(db, agentName, agentKey);
  return authResult.ok ? op() : authResult;
};

/** Authenticate, then run a write; zero changes maps to `miss`. */
export const authedWrite = (
  db: Database.Database,
  agentName: string,
  agentKey: string,
  sql: string,
  params: SqliteParams,
  miss: DbError
): Result<void, DbError> =>
  authenticated(db, agentName, agentKey, (): Result<void, DbError> =>
    attempt((): Result<void, DbError> => runOrMiss(db.prepare(sql), params, miss))
  );

/** Adapt a synchronous `(db, log, ...args) => Result` operation into a
 *  Promise-returning method with the same trailing arguments. Used by the
 *  `create*Ops` builders to expose the async TooManyCooksDb surface without
 *  repeating the `async () => await Promise.resolve(...)` boilerplate. */
export const asyncDbOp = <Args extends unknown[], T>(
  op: (db: Database.Database, log: Logger, ...args: Args) => Result<T, DbError>,
  db: Database.Database,
  log: Logger
): ((...args: Args) => Promise<Result<T, DbError>>) => {
  return async (...args: Args): Promise<Result<T, DbError>> => await Promise.resolve(op(db, log, ...args));
};

/** Run a single-row SELECT; map the row with `mapper`, null when absent. */
export const selectOneOrNull = <T>(
  db: Database.Database,
  sql: string,
  params: SqliteParams,
  mapper: (row: Record<string, unknown>) => T
): Result<T | null, DbError> =>
  attempt((): Result<T | null, DbError> => success(maybeRow(toRow(db.prepare(sql).get(...params)), mapper)));

/** Run a multi-row SELECT, mapping every row through `mapper`. */
export const selectMappedRows = <T>(
  db: Database.Database,
  sql: string,
  mapper: (row: Record<string, unknown>) => T
): Result<readonly T[], DbError> =>
  attempt((): Result<readonly T[], DbError> => success(selectMapped(db, sql, mapper)));

/** List every row of a table, logging a trace first, then map each row. */
export const listAll = <T>(
  db: Database.Database,
  log: Logger,
  sql: string,
  mapper: (row: Record<string, unknown>) => T,
  label: string
): Result<readonly T[], DbError> => {
  log.trace(`Listing all ${label}`);
  return selectMappedRows(db, sql, mapper);
};

/** Create an inactive identity row (idempotent) under an explicit timestamp. */
export const ensureInactiveIdentity = (
  db: Database.Database,
  name: string,
  agentKey: string,
  timestamp: number
): void => {
  db.prepare(SQL_ENSURE_INACTIVE_IDENTITY).run(name, agentKey, timestamp, timestamp);
};

/** Insert the reserved '*' identity row required by the messages.to_agent FK
 *  for broadcasts. Idempotent — re-runs on every DB open are safe. The row
 *  is kept active=0 so it never appears in agent listings. */
export const seedBroadcastSentinel = (db: Database.Database): void => {
  ensureInactiveIdentity(db, BROADCAST_RECIPIENT, `${SENTINEL_KEY_PREFIX}${generateKey()}`, now());
};
