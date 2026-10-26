/// SQLite database implementation for Too Many Cooks.
///
/// Thin entry point: create/open/migrate lifecycle. The domain operations live
/// in ./sqlite/ (agents, locks, messages, plans, admin) and are composed by
/// createDbOps below.

import Database from "better-sqlite3";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";

import { applyMigrations } from "./migrate.js";

import {
  type Logger,
  type Result,
  type RetryPolicy,
  type TooManyCooksDataConfig,
  type TooManyCooksDb,
  defaultRetryPolicy,
  error,
  success,
  withRetry,
} from "too-many-cooks-core";

import { createAdminOps } from "./sqlite/admin.js";
import { createAgentOps } from "./sqlite/agents.js";
import { createLockOps } from "./sqlite/locks.js";
import { createMessageOps } from "./sqlite/messages.js";
import { createPlanOps } from "./sqlite/plans.js";
import { isSqliteRetryable, noOpLogger, seedBroadcastSentinel } from "./sqlite/shared.js";

/** Enable foreign-key enforcement on every connection. */
const PRAGMA_FOREIGN_KEYS: string = "foreign_keys = ON";

/** Create database instance with retry policy. */
export const createDb: (
  config: TooManyCooksDataConfig,
  logger?: Logger,
  retryPolicy?: RetryPolicy
) => Result<TooManyCooksDb, string> = (
  config: TooManyCooksDataConfig,
  logger?: Logger,
  retryPolicy: RetryPolicy = defaultRetryPolicy
): Result<TooManyCooksDb, string> => {
  const log: Logger = logger?.child({ component: "db" }) ?? noOpLogger();
  log.info(`Opening database at ${config.dbPath}`);

  return withRetry(
    retryPolicy,
    isSqliteRetryable,
    () => tryCreateDb(config, log),
    (attempt: number, err: string, delayMs: number): void => {
      log.warn(`Attempt ${String(attempt)} failed (retryable): ${err}. Retrying in ${String(delayMs)}ms...`);
    }
  );
};

/** [DB-MIGRATE] Apply the DataProvider schema and open the DB. */
const openAndInit: (config: TooManyCooksDataConfig, log: Logger) => Result<TooManyCooksDb, string> = (
  config: TooManyCooksDataConfig,
  log: Logger
): Result<TooManyCooksDb, string> => {
  const migrated: Result<void, string> = applyMigrations(config.dbPath);
  if (!migrated.ok) {
    return error(`Migration failed: ${migrated.error}`);
  }
  let db: Database.Database;
  try {
    db = new Database(config.dbPath);
    db.pragma(PRAGMA_FOREIGN_KEYS);
    seedBroadcastSentinel(db);
  } catch (e: unknown) {
    return error(`Failed to open database: ${String(e)}`);
  }
  log.debug("Schema applied via DataProviderMigrate");
  return success(createDbOps(db, config, log));
};

/** Try to create and initialize the database. If migration fails on an existing DB, blow it away and retry once. */
const tryCreateDb: (config: TooManyCooksDataConfig, log: Logger) => Result<TooManyCooksDb, string> = (
  config: TooManyCooksDataConfig,
  log: Logger
): Result<TooManyCooksDb, string> => {
  const dbDir: string = dirname(config.dbPath);
  if (!existsSync(dbDir)) {
    log.info(`Creating database directory: ${dbDir}`);
    try {
      mkdirSync(dbDir, { recursive: true });
    } catch (e: unknown) {
      return error(`Failed to create database directory: ${String(e)}`);
    }
  }

  const first: Result<TooManyCooksDb, string> = openAndInit(config, log);
  if (first.ok) {
    return first;
  }

  log.warn(`Schema init failed: ${first.error}. Deleting DB file and starting fresh.`);
  try {
    if (existsSync(config.dbPath)) {
      unlinkSync(config.dbPath);
    }
  } catch (e: unknown) {
    return error(`Failed to delete corrupt DB at ${config.dbPath}: ${String(e)}`);
  }
  return openAndInit(config, log);
};

/** Wire up all database operations. */
const createDbOps: (db: Database.Database, config: TooManyCooksDataConfig, log: Logger) => TooManyCooksDb = (
  db: Database.Database,
  config: TooManyCooksDataConfig,
  log: Logger
): TooManyCooksDb => ({
  ...createAgentOps(db, log),
  ...createLockOps(db, log),
  ...createMessageOps(db, log, config),
  ...createPlanOps(db, log, config),
  ...createAdminOps(db, log, config),
});
