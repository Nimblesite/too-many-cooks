/* eslint-disable max-lines -- Database operations module; splitting would fragment cohesive DB logic */
/// SQLite database implementation for Too Many Cooks.

import Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { applyMigrations, hasMigrationsDir, pushSchemaViaPrisma } from "./migrate.js";

import {
  type AgentIdentity,
  type AgentPlan,
  type AgentRegistration,
  type DbError,
  ERR_DATABASE,
  ERR_LOCK_HELD,
  ERR_NOT_FOUND,
  ERR_UNAUTHORIZED,
  ERR_VALIDATION,
  type FileLock,
  type LockResult,
  type Logger,
  type Message,
  type Result,
  type RetryPolicy,
  type TooManyCooksDataConfig,
  type TooManyCooksDb,
  agentIdentityFromJson,
  agentPlanFromJson,
  createLoggerWithContext,
  createLoggingContext,
  defaultRetryPolicy,
  error,
  fileLockFromJson,
  messageFromJson,
  success,
  withRetry,
} from "@too-many-cooks/core";

/** Key length in bytes for generating hex keys. */
const KEY_BYTE_LENGTH: number = 32;

/** Length of message ID substring. */
const MESSAGE_ID_LENGTH: number = 16;

/** Minimum agent name length. */
const MIN_AGENT_NAME_LENGTH: number = 1;

/** Maximum agent name length. */
const MAX_AGENT_NAME_LENGTH: number = 50;

/** Active flag value. */
const ACTIVE_TRUE: number = 1;

/** Inactive flag value. */
const ACTIVE_FALSE: number = 0;

/** SQLite-specific retryable errors. */
const isSqliteRetryable: (err: string) => boolean = (err: string): boolean =>
  err.includes("disk I/O error") ||
  err.includes("database is locked") ||
  err.includes("SQLITE_BUSY");

/** Create a no-op logger. */
const noOpLogger: () => Logger = (): Logger =>
  createLoggerWithContext(createLoggingContext());

/** Generate a hex key from random bytes. */
const generateKey: () => string = (): string =>
  randomBytes(KEY_BYTE_LENGTH).toString("hex");

/** Current time in milliseconds. */
const now: () => number = (): number => Date.now();

/** Type guard: check if a value is a plain object (Record<string, unknown>). */
const isRecord: (value: unknown) => value is Record<string, unknown> = (
  value: unknown,
): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Narrow an unknown SQLite row to Record<string, unknown> or undefined. */
const toRow: (value: unknown) => Record<string, unknown> | undefined = (
  value: unknown,
): Record<string, unknown> | undefined =>
  isRecord(value) ? value : undefined;

/** Narrow unknown SQLite rows array to ReadonlyArray<Record<string, unknown>>. */
const toRows: (value: unknown[]) => ReadonlyArray<Record<string, unknown>> = (
  value: unknown[],
): ReadonlyArray<Record<string, unknown>> =>
  value.filter(isRecord);

/** Create database instance with retry policy. */
export const createDb: (
  config: TooManyCooksDataConfig,
  logger?: Logger,
  retryPolicy?: RetryPolicy,
) => Result<TooManyCooksDb, string> = (
  config: TooManyCooksDataConfig,
  logger?: Logger,
  retryPolicy: RetryPolicy = defaultRetryPolicy,
): Result<TooManyCooksDb, string> => {
  const log: Logger = logger?.child({ component: "db" }) ?? noOpLogger();
  log.info(`Opening database at ${config.dbPath}`);

  return withRetry(
    retryPolicy,
    isSqliteRetryable,
    () => tryCreateDb(config, log),
    (attempt: number, err: string, delayMs: number): void => {
      log.warn(
        `Attempt ${String(attempt)} failed (retryable): ${err}. Retrying in ${String(delayMs)}ms...`,
      );
    },
  );
};

/** Try to create and initialize the database. */
const tryCreateDb: (
  config: TooManyCooksDataConfig,
  log: Logger,
) => Result<TooManyCooksDb, string> = (
  config: TooManyCooksDataConfig,
  log: Logger,
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

  if (!hasMigrationsDir()) {
    try {
      pushSchemaViaPrisma(config.dbPath);
    } catch (e: unknown) {
      return error(`Failed to push schema via prisma: ${String(e)}`);
    }
  }

  try {
    const db: Database.Database = new Database(config.dbPath);
    db.pragma("foreign_keys = ON");
    return initSchema(db, log, config);
  } catch (e: unknown) {
    return error(`Failed to open database: ${String(e)}`);
  }
};

/** Initialize database schema. */
const initSchema: (
  db: Database.Database,
  log: Logger,
  config: TooManyCooksDataConfig,
) => Result<TooManyCooksDb, string> = (
  db: Database.Database,
  log: Logger,
  config: TooManyCooksDataConfig,
): Result<TooManyCooksDb, string> => {
  log.debug("Initializing database schema");
  try {
    applyMigrations(db);
    log.debug("Schema initialized successfully");
    return success(createDbOps(db, config, log));
  } catch (e: unknown) {
    const msg: string = String(e);
    log.error(`Schema initialization failed: ${msg}`);
    return error(msg);
  }
};

/** Authenticate agent and update last_active timestamp. */
const authAndUpdate: (
  db: Database.Database,
  agentName: string,
  agentKey: string,
) => Result<void, DbError> = (
  db: Database.Database,
  agentName: string,
  agentKey: string,
): Result<void, DbError> => {
  try {
    const stmt: Database.Statement = db.prepare(
      "UPDATE identity SET last_active = ? WHERE agent_name = ? AND agent_key = ?",
    );
    const result: Database.RunResult = stmt.run(now(), agentName, agentKey);
    return result.changes === 0
      ? error({ code: ERR_UNAUTHORIZED, message: "Invalid credentials" })
      : success(undefined);
  } catch (e: unknown) {
    return error({ code: ERR_DATABASE, message: String(e) });
  }
};

/** Register a new agent. */
const register: (
  db: Database.Database,
  log: Logger,
  name: string,
) => Result<AgentRegistration, DbError> = (
  db: Database.Database,
  log: Logger,
  name: string,
): Result<AgentRegistration, DbError> => {
  log.debug(`Registering agent: ${name}`);
  if (name.length < MIN_AGENT_NAME_LENGTH || name.length > MAX_AGENT_NAME_LENGTH) {
    log.warn("Registration failed: invalid name length");
    return error({ code: ERR_VALIDATION, message: "Name must be 1-50 chars" });
  }
  const key: string = generateKey();
  const timestamp: number = now();
  try {
    const stmt: Database.Statement = db.prepare(`
      INSERT INTO identity (agent_name, agent_key, active, registered_at, last_active)
      VALUES (?, ?, 1, ?, ?)
      ON CONFLICT(agent_name) DO UPDATE SET
        agent_key = excluded.agent_key,
        active = 1,
        registered_at = excluded.registered_at,
        last_active = excluded.last_active
      WHERE active = 0
    `);
    const result: Database.RunResult = stmt.run(name, key, timestamp, timestamp);
    if (result.changes > 0) {
      log.info(`Agent registered: ${name}`);
      return success({ agentName: name, agentKey: key });
    }
    log.warn("Registration failed: name already registered");
    return error({ code: ERR_VALIDATION, message: "Name already registered" });
  } catch (e: unknown) {
    log.error(`Registration failed: ${String(e)}`);
    return error({ code: ERR_DATABASE, message: String(e) });
  }
};

/** Get agent identity by name. */
const getAgent: (
  db: Database.Database,
  name: string,
) => Result<AgentIdentity, DbError> = (
  db: Database.Database,
  name: string,
): Result<AgentIdentity, DbError> => {
  try {
    const stmt: Database.Statement = db.prepare(
      "SELECT agent_name, registered_at, last_active FROM identity WHERE agent_name = ?",
    );
    const row: Record<string, unknown> | undefined = toRow(stmt.get(name));
    return row === undefined
      ? error({ code: ERR_NOT_FOUND, message: "Agent not found" })
      : success(agentIdentityFromJson(row));
  } catch (e: unknown) {
    return error({ code: ERR_DATABASE, message: String(e) });
  }
};

/** Authenticate agent and return identity. */
const authenticate: (
  db: Database.Database,
  log: Logger,
  name: string,
  key: string,
) => Result<AgentIdentity, DbError> = (
  db: Database.Database,
  log: Logger,
  name: string,
  key: string,
): Result<AgentIdentity, DbError> => {
  log.debug(`Authenticating agent: ${name}`);
  const authResult: Result<void, DbError> = authAndUpdate(db, name, key);
  if (!authResult.ok) {
    log.warn(`Authentication failed for ${name}`);
    return authResult;
  }
  return getAgent(db, name);
};

/** Look up agent name by key. */
const lookupByKey: (
  db: Database.Database,
  log: Logger,
  key: string,
) => Result<string, DbError> = (
  db: Database.Database,
  log: Logger,
  key: string,
): Result<string, DbError> => {
  log.debug("Looking up agent by key");
  try {
    const stmt: Database.Statement = db.prepare(
      "SELECT agent_name FROM identity WHERE agent_key = ?",
    );
    const row: Record<string, unknown> | undefined = toRow(stmt.get(key));
    if (row === undefined) {
      return error({ code: ERR_UNAUTHORIZED, message: "Invalid key" });
    }
    const agentName: unknown = row.agent_name;
    return typeof agentName === "string"
      ? success(agentName)
      : error({ code: ERR_DATABASE, message: "Missing agent_name" });
  } catch (e: unknown) {
    return error({ code: ERR_DATABASE, message: String(e) });
  }
};

/** List all active agents. */
const listAgents: (
  db: Database.Database,
  log: Logger,
) => Result<readonly AgentIdentity[], DbError> = (
  db: Database.Database,
  log: Logger,
): Result<readonly AgentIdentity[], DbError> => {
  log.debug("Listing all agents");
  try {
    const stmt: Database.Statement = db.prepare(
      "SELECT agent_name, registered_at, last_active FROM identity WHERE active = 1",
    );
    const rows: ReadonlyArray<Record<string, unknown>> = toRows(stmt.all());
    return success(rows.map(agentIdentityFromJson));
  } catch (e: unknown) {
    return error({ code: ERR_DATABASE, message: String(e) });
  }
};

/** Query lock for a file path. */
const queryLock: (
  db: Database.Database,
  log: Logger,
  filePath: string,
) => Result<FileLock | null, DbError> = (
  db: Database.Database,
  log: Logger,
  filePath: string,
): Result<FileLock | null, DbError> => {
  log.trace(`Querying lock for ${filePath}`);
  try {
    const stmt: Database.Statement = db.prepare("SELECT * FROM locks WHERE file_path = ?");
    const row: Record<string, unknown> | undefined = toRow(stmt.get(filePath));
    return row === undefined ? success(null) : success(fileLockFromJson(row));
  } catch (e: unknown) {
    return error({ code: ERR_DATABASE, message: String(e) });
  }
};

/** Delete a lock by file path. */
const deleteExpiredLock: (
  db: Database.Database,
  filePath: string,
) => Result<void, DbError> = (
  db: Database.Database,
  filePath: string,
): Result<void, DbError> => {
  try {
    db.prepare("DELETE FROM locks WHERE file_path = ?").run(filePath);
    return success(undefined);
  } catch (e: unknown) {
    return error({ code: ERR_DATABASE, message: String(e) });
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
  timeoutMs: number,
) => Result<LockResult, DbError> = (
  db: Database.Database,
  log: Logger,
  filePath: string,
  agentName: string,
  agentKey: string,
  reason: string | null | undefined,
  timeoutMs: number,
): Result<LockResult, DbError> => {
  log.debug(`Acquiring lock on ${filePath} for ${agentName}`);
  const authResult: Result<void, DbError> = authAndUpdate(db, agentName, agentKey);
  if (!authResult.ok) {return authResult;}

  const timestamp: number = now();
  const expiresAt: number = timestamp + timeoutMs;

  const existing: Result<FileLock | null, DbError> = queryLock(db, log, filePath);
  if (!existing.ok) {return existing;}
  if (existing.value !== null) {
    if (existing.value.expiresAt > timestamp) {
      return success({
        acquired: false,
        lock: undefined,
        error: `Held by ${existing.value.agentName} until ${String(existing.value.expiresAt)}`,
      });
    }
    const delResult: Result<void, DbError> = deleteExpiredLock(db, filePath);
    if (!delResult.ok) {return delResult;}
  }

  return insertLock(db, filePath, agentName, timestamp, expiresAt, reason);
};

/** Insert a new lock row. */
const insertLock: (
  db: Database.Database,
  filePath: string,
  agentName: string,
  timestamp: number,
  expiresAt: number,
  reason: string | null | undefined,
) => Result<LockResult, DbError> = (
  db: Database.Database,
  filePath: string,
  agentName: string,
  timestamp: number,
  expiresAt: number,
  reason: string | null | undefined,
): Result<LockResult, DbError> => {
  try {
    const stmt: Database.Statement = db.prepare(
      "INSERT INTO locks (file_path, agent_name, acquired_at, expires_at, reason) VALUES (?, ?, ?, ?, ?)",
    );
    stmt.run(filePath, agentName, timestamp, expiresAt, reason ?? null);
    return success({
      acquired: true,
      lock: { filePath, agentName, acquiredAt: timestamp, expiresAt, reason: reason ?? null, version: 1 },
      error: undefined,
    });
  } catch (e: unknown) {
    const msg: string = String(e);
    return msg.includes("UNIQUE")
      ? success({ acquired: false, lock: undefined, error: "Lock race condition" })
      : error({ code: ERR_DATABASE, message: msg });
  }
};

/** Release a file lock. */
const releaseLock: (
  db: Database.Database,
  log: Logger,
  filePath: string,
  agentName: string,
  agentKey: string,
) => Result<void, DbError> = (
  db: Database.Database,
  log: Logger,
  filePath: string,
  agentName: string,
  agentKey: string,
): Result<void, DbError> => {
  log.debug(`Releasing lock on ${filePath} for ${agentName}`);
  const authResult: Result<void, DbError> = authAndUpdate(db, agentName, agentKey);
  if (!authResult.ok) {return authResult;}

  try {
    const stmt: Database.Statement = db.prepare(
      "DELETE FROM locks WHERE file_path = ? AND agent_name = ?",
    );
    const result: Database.RunResult = stmt.run(filePath, agentName);
    return result.changes === 0
      ? error({ code: ERR_NOT_FOUND, message: "Lock not held by you" })
      : success(undefined);
  } catch (e: unknown) {
    return error({ code: ERR_DATABASE, message: String(e) });
  }
};

/** Force release an expired lock. */
const forceReleaseLock: (
  db: Database.Database,
  log: Logger,
  filePath: string,
  agentName: string,
  agentKey: string,
) => Result<void, DbError> = (
  db: Database.Database,
  log: Logger,
  filePath: string,
  agentName: string,
  agentKey: string,
): Result<void, DbError> => {
  log.debug(`Force releasing lock on ${filePath} for ${agentName}`);
  const authResult: Result<void, DbError> = authAndUpdate(db, agentName, agentKey);
  if (!authResult.ok) {return authResult;}

  const existing: Result<FileLock | null, DbError> = queryLock(db, log, filePath);
  if (!existing.ok) {return existing;}
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
const listLocks: (
  db: Database.Database,
  log: Logger,
) => Result<readonly FileLock[], DbError> = (
  db: Database.Database,
  log: Logger,
): Result<readonly FileLock[], DbError> => {
  log.trace("Listing all locks");
  try {
    const stmt: Database.Statement = db.prepare("SELECT * FROM locks");
    const rows: ReadonlyArray<Record<string, unknown>> = toRows(stmt.all());
    return success(rows.map(fileLockFromJson));
  } catch (e: unknown) {
    return error({ code: ERR_DATABASE, message: String(e) });
  }
};

/** Renew a file lock. */
const renewLock: (
  db: Database.Database,
  log: Logger,
  filePath: string,
  agentName: string,
  agentKey: string,
  timeoutMs: number,
) => Result<void, DbError> = (
  db: Database.Database,
  log: Logger,
  filePath: string,
  agentName: string,
  agentKey: string,
  timeoutMs: number,
): Result<void, DbError> => {
  log.debug(`Renewing lock on ${filePath} for ${agentName}`);
  const authResult: Result<void, DbError> = authAndUpdate(db, agentName, agentKey);
  if (!authResult.ok) {return authResult;}

  const newExpiry: number = now() + timeoutMs;
  try {
    const stmt: Database.Statement = db.prepare(
      "UPDATE locks SET expires_at = ?, version = version + 1 WHERE file_path = ? AND agent_name = ?",
    );
    const result: Database.RunResult = stmt.run(newExpiry, filePath, agentName);
    return result.changes === 0
      ? error({ code: ERR_NOT_FOUND, message: "Lock not held by you" })
      : success(undefined);
  } catch (e: unknown) {
    return error({ code: ERR_DATABASE, message: String(e) });
  }
};

/** Send a message between agents. */
const sendMessage: (
  db: Database.Database,
  log: Logger,
  fromAgent: string,
  fromKey: string,
  toAgent: string,
  content: string,
  maxLen: number,
) => Result<string, DbError> = (
  db: Database.Database,
  log: Logger,
  fromAgent: string,
  fromKey: string,
  toAgent: string,
  content: string,
  maxLen: number,
): Result<string, DbError> => {
  log.debug(`Sending message from ${fromAgent} to ${toAgent}`);
  const authResult: Result<void, DbError> = authAndUpdate(db, fromAgent, fromKey);
  if (!authResult.ok) {return authResult;}

  if (content.length > maxLen) {
    return error({
      code: ERR_VALIDATION,
      message: `Content exceeds ${String(maxLen)} chars`,
    });
  }

  const msgId: string = generateKey().substring(0, MESSAGE_ID_LENGTH);
  const timestamp: number = now();
  try {
    const stmt: Database.Statement = db.prepare(
      "INSERT INTO messages (id, from_agent, to_agent, content, created_at) VALUES (?, ?, ?, ?, ?)",
    );
    stmt.run(msgId, fromAgent, toAgent, content, timestamp);
    return success(msgId);
  } catch (e: unknown) {
    return error({ code: ERR_DATABASE, message: String(e) });
  }
};

/** Auto-mark fetched messages as read. */
const autoMarkRead: (
  db: Database.Database,
  log: Logger,
  agentName: string,
  messages: readonly Message[],
) => void = (
  db: Database.Database,
  log: Logger,
  agentName: string,
  messages: readonly Message[],
): void => {
  const unreadIds: string[] = messages
    .filter((msg: Message): boolean => msg.readAt === undefined)
    .map((msg: Message): string => msg.id);
  if (unreadIds.length === 0) {return;}

  const timestamp: number = now();
  try {
    const stmt: Database.Statement = db.prepare(
      "UPDATE messages SET read_at = ? WHERE id = ? AND to_agent = ? AND read_at IS NULL",
    );
    for (const msgId of unreadIds) {
      try {
        stmt.run(timestamp, msgId, agentName);
      } catch (innerErr: unknown) {
        log.warn(`Failed to mark message ${msgId} as read: ${String(innerErr)}`);
      }
    }
    log.debug(`Auto-marked ${String(unreadIds.length)} messages as read for ${agentName}`);
  } catch (e: unknown) {
    log.warn(`Failed to auto-mark messages read: ${String(e)}`);
  }
};

/** Get messages for an agent. */
const getMessages: (
  db: Database.Database,
  log: Logger,
  agentName: string,
  agentKey: string,
  unreadOnly: boolean,
) => Result<readonly Message[], DbError> = (
  db: Database.Database,
  log: Logger,
  agentName: string,
  agentKey: string,
  unreadOnly: boolean,
): Result<readonly Message[], DbError> => {
  log.trace(`Getting messages for ${agentName} (unreadOnly: ${String(unreadOnly)})`);
  const authResult: Result<void, DbError> = authAndUpdate(db, agentName, agentKey);
  if (!authResult.ok) {return authResult;}

  const sql: string = unreadOnly
    ? "SELECT * FROM messages WHERE (to_agent = ? OR to_agent = '*') AND read_at IS NULL ORDER BY created_at DESC"
    : "SELECT * FROM messages WHERE (to_agent = ? OR to_agent = '*') ORDER BY created_at DESC";
  try {
    const stmt: Database.Statement = db.prepare(sql);
    const rows: ReadonlyArray<Record<string, unknown>> = toRows(stmt.all(agentName));
    const messageList: Message[] = rows.map(messageFromJson);
    autoMarkRead(db, log, agentName, messageList);
    return success(messageList);
  } catch (e: unknown) {
    return error({ code: ERR_DATABASE, message: String(e) });
  }
};

/** Mark a message as read. */
const markRead: (
  db: Database.Database,
  log: Logger,
  messageId: string,
  agentName: string,
  agentKey: string,
) => Result<void, DbError> = (
  db: Database.Database,
  log: Logger,
  messageId: string,
  agentName: string,
  agentKey: string,
): Result<void, DbError> => {
  log.trace(`Marking message ${messageId} as read for ${agentName}`);
  const authResult: Result<void, DbError> = authAndUpdate(db, agentName, agentKey);
  if (!authResult.ok) {return authResult;}

  try {
    const stmt: Database.Statement = db.prepare(
      "UPDATE messages SET read_at = ? WHERE id = ? AND to_agent = ?",
    );
    const result: Database.RunResult = stmt.run(now(), messageId, agentName);
    return result.changes === 0
      ? error({ code: ERR_NOT_FOUND, message: "Message not found" })
      : success(undefined);
  } catch (e: unknown) {
    return error({ code: ERR_DATABASE, message: String(e) });
  }
};

/** Update an agent's plan. */
const updatePlan: (
  db: Database.Database,
  log: Logger,
  agentName: string,
  agentKey: string,
  goal: string,
  currentTask: string,
  maxLen: number,
) => Result<void, DbError> = (
  db: Database.Database,
  log: Logger,
  agentName: string,
  agentKey: string,
  goal: string,
  currentTask: string,
  maxLen: number,
): Result<void, DbError> => {
  log.debug(`Updating plan for ${agentName}`);
  const authResult: Result<void, DbError> = authAndUpdate(db, agentName, agentKey);
  if (!authResult.ok) {return authResult;}

  if (goal.length > maxLen || currentTask.length > maxLen) {
    return error({
      code: ERR_VALIDATION,
      message: `Fields exceed ${String(maxLen)} chars`,
    });
  }

  try {
    const stmt: Database.Statement = db.prepare(`
      INSERT INTO plans (agent_name, goal, current_task, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(agent_name) DO UPDATE SET
        goal = excluded.goal,
        current_task = excluded.current_task,
        updated_at = excluded.updated_at
    `);
    stmt.run(agentName, goal, currentTask, now());
    return success(undefined);
  } catch (e: unknown) {
    return error({ code: ERR_DATABASE, message: String(e) });
  }
};

/** Get an agent's plan. */
const getPlan: (
  db: Database.Database,
  log: Logger,
  agentName: string,
) => Result<AgentPlan | null, DbError> = (
  db: Database.Database,
  log: Logger,
  agentName: string,
): Result<AgentPlan | null, DbError> => {
  log.trace(`Getting plan for ${agentName}`);
  try {
    const stmt: Database.Statement = db.prepare("SELECT * FROM plans WHERE agent_name = ?");
    const row: Record<string, unknown> | undefined = toRow(stmt.get(agentName));
    return row === undefined ? success(null) : success(agentPlanFromJson(row));
  } catch (e: unknown) {
    return error({ code: ERR_DATABASE, message: String(e) });
  }
};

/** List all plans. */
const listPlans: (
  db: Database.Database,
  log: Logger,
) => Result<readonly AgentPlan[], DbError> = (
  db: Database.Database,
  log: Logger,
): Result<readonly AgentPlan[], DbError> => {
  log.trace("Listing all plans");
  try {
    const stmt: Database.Statement = db.prepare("SELECT * FROM plans");
    const rows: ReadonlyArray<Record<string, unknown>> = toRows(stmt.all());
    return success(rows.map(agentPlanFromJson));
  } catch (e: unknown) {
    return error({ code: ERR_DATABASE, message: String(e) });
  }
};

/** List all messages. */
const listAllMessages: (
  db: Database.Database,
  log: Logger,
) => Result<readonly Message[], DbError> = (
  db: Database.Database,
  log: Logger,
): Result<readonly Message[], DbError> => {
  log.trace("Listing all messages");
  try {
    const stmt: Database.Statement = db.prepare(
      "SELECT * FROM messages ORDER BY created_at DESC",
    );
    const rows: ReadonlyArray<Record<string, unknown>> = toRows(stmt.all());
    return success(rows.map(messageFromJson));
  } catch (e: unknown) {
    return error({ code: ERR_DATABASE, message: String(e) });
  }
};

/** Set agent active/inactive. */
const setActive: (
  db: Database.Database,
  log: Logger,
  agentName: string,
  active: boolean,
) => Result<void, DbError> = (
  db: Database.Database,
  log: Logger,
  agentName: string,
  active: boolean,
): Result<void, DbError> => {
  log.debug(`Setting agent ${agentName} active=${String(active)}`);
  const activeInt: number = active ? ACTIVE_TRUE : ACTIVE_FALSE;
  try {
    const stmt: Database.Statement = db.prepare(
      "UPDATE identity SET active = ? WHERE agent_name = ?",
    );
    const result: Database.RunResult = stmt.run(activeInt, agentName);
    return result.changes === 0
      ? error({ code: ERR_NOT_FOUND, message: "Agent not found" })
      : success(undefined);
  } catch (e: unknown) {
    return error({ code: ERR_DATABASE, message: String(e) });
  }
};

/** Deactivate all agents. */
const deactivateAll: (
  db: Database.Database,
  log: Logger,
) => Result<void, DbError> = (
  db: Database.Database,
  log: Logger,
): Result<void, DbError> => {
  log.debug("Deactivating all agents");
  try {
    db.prepare("UPDATE identity SET active = 0").run();
    return success(undefined);
  } catch (e: unknown) {
    return error({ code: ERR_DATABASE, message: String(e) });
  }
};

/** Admin: delete a lock by file path. */
const adminDeleteLock: (
  db: Database.Database,
  log: Logger,
  filePath: string,
) => Result<void, DbError> = (
  db: Database.Database,
  log: Logger,
  filePath: string,
): Result<void, DbError> => {
  log.warn(`Admin deleting lock on ${filePath}`);
  try {
    const stmt: Database.Statement = db.prepare("DELETE FROM locks WHERE file_path = ?");
    const result: Database.RunResult = stmt.run(filePath);
    return result.changes === 0
      ? error({ code: ERR_NOT_FOUND, message: "Lock not found" })
      : success(undefined);
  } catch (e: unknown) {
    return error({ code: ERR_DATABASE, message: String(e) });
  }
};

/** Admin: delete an agent and all related data. */
const adminDeleteAgent: (
  db: Database.Database,
  log: Logger,
  agentName: string,
) => Result<void, DbError> = (
  db: Database.Database,
  log: Logger,
  agentName: string,
): Result<void, DbError> => {
  log.warn(`Admin deleting agent ${agentName}`);
  try {
    // Delete child rows explicitly (in FK-safe order) before deleting the identity row.
    // Cascade is defined in the schema but must not be relied upon — explicit deletes
    // are more reliable across SQLite versions and PRAGMA states.
    db.prepare("DELETE FROM locks WHERE agent_name = ?").run(agentName);
    db.prepare("DELETE FROM plans WHERE agent_name = ?").run(agentName);
    db.prepare("DELETE FROM messages WHERE from_agent = ?").run(agentName);
    db.prepare("DELETE FROM messages WHERE to_agent = ?").run(agentName);
    const result: Database.RunResult = db
      .prepare("DELETE FROM identity WHERE agent_name = ?")
      .run(agentName);
    return result.changes === 0
      ? error({ code: ERR_NOT_FOUND, message: "Agent not found" })
      : success(undefined);
  } catch (e: unknown) {
    return error({ code: ERR_DATABASE, message: String(e) });
  }
};

/** Admin: reset an agent's key. */
const adminResetKey: (
  db: Database.Database,
  log: Logger,
  agentName: string,
) => Result<AgentRegistration, DbError> = (
  db: Database.Database,
  log: Logger,
  agentName: string,
): Result<AgentRegistration, DbError> => {
  log.warn(`Admin resetting key for agent ${agentName}`);

  try {
    const lockResult: Database.RunResult = db
      .prepare("DELETE FROM locks WHERE agent_name = ?")
      .run(agentName);
    if (lockResult.changes > 0) {
      log.warn(`Released ${String(lockResult.changes)} locks for agent ${agentName}`);
    }
  } catch (e: unknown) {
    log.warn(`Failed to release locks: ${String(e)}`);
  }

  const newKey: string = generateKey();
  const timestamp: number = now();
  try {
    const stmt: Database.Statement = db.prepare(
      "UPDATE identity SET agent_key = ?, last_active = ? WHERE agent_name = ?",
    );
    const result: Database.RunResult = stmt.run(newKey, timestamp, agentName);
    return result.changes === 0
      ? error({ code: ERR_NOT_FOUND, message: "Agent not found" })
      : success({ agentName, agentKey: newKey });
  } catch (e: unknown) {
    return error({ code: ERR_DATABASE, message: String(e) });
  }
};

/** Admin: reset all transient data. */
const adminReset: (
  db: Database.Database,
  log: Logger,
) => Result<void, DbError> = (
  db: Database.Database,
  log: Logger,
): Result<void, DbError> => {
  log.warn("Admin resetting transient data");
  const statements: string[] = [
    "DELETE FROM plans",
    "DELETE FROM messages",
    "DELETE FROM locks",
    "UPDATE identity SET active = 0",
  ];
  try {
    for (const sql of statements) {
      db.exec(sql);
    }
    return success(undefined);
  } catch (e: unknown) {
    return error({ code: ERR_DATABASE, message: String(e) });
  }
};

/** Admin: send a message without auth. */
const adminSendMessage: (
  db: Database.Database,
  log: Logger,
  fromAgent: string,
  toAgent: string,
  content: string,
  maxLen: number,
) => Result<string, DbError> = (
  db: Database.Database,
  log: Logger,
  fromAgent: string,
  toAgent: string,
  content: string,
  maxLen: number,
): Result<string, DbError> => {
  log.warn(`Admin sending message from ${fromAgent} to ${toAgent}`);
  if (content.length > maxLen) {
    return error({
      code: ERR_VALIDATION,
      message: `Content exceeds ${String(maxLen)} chars`,
    });
  }

  const timestamp: number = now();
  try {
    const ensureStmt: Database.Statement = db.prepare(
      "INSERT OR IGNORE INTO identity (agent_name, agent_key, registered_at, last_active) VALUES (?, ?, ?, ?)",
    );
    ensureStmt.run(fromAgent, generateKey(), timestamp, timestamp);
  } catch (e: unknown) {
    return error({ code: ERR_DATABASE, message: String(e) });
  }

  const msgId: string = generateKey().substring(0, MESSAGE_ID_LENGTH);
  try {
    const stmt: Database.Statement = db.prepare(
      "INSERT INTO messages (id, from_agent, to_agent, content, created_at) VALUES (?, ?, ?, ?, ?)",
    );
    stmt.run(msgId, fromAgent, toAgent, content, timestamp);
    return success(msgId);
  } catch (e: unknown) {
    return error({ code: ERR_DATABASE, message: String(e) });
  }
};

/** Build agent identity operations. */
const createAgentOps: (
  db: Database.Database,
  log: Logger,
) => Pick<TooManyCooksDb, "activate" | "authenticate" | "deactivate" | "deactivateAll" | "listAgents" | "lookupByKey" | "register"> = (
  db: Database.Database,
  log: Logger,
): Pick<TooManyCooksDb, "activate" | "authenticate" | "deactivate" | "deactivateAll" | "listAgents" | "lookupByKey" | "register"> => ({
  activate: async (name: string): Promise<Result<void, DbError>> =>
    await Promise.resolve(setActive(db, log, name, true)),
  authenticate: async (name: string, key: string): Promise<Result<AgentIdentity, DbError>> =>
    await Promise.resolve(authenticate(db, log, name, key)),
  deactivate: async (name: string): Promise<Result<void, DbError>> =>
    await Promise.resolve(setActive(db, log, name, false)),
  deactivateAll: async (): Promise<Result<void, DbError>> =>
    await Promise.resolve(deactivateAll(db, log)),
  listAgents: async (): Promise<Result<readonly AgentIdentity[], DbError>> =>
    await Promise.resolve(listAgents(db, log)),
  lookupByKey: async (key: string): Promise<Result<string, DbError>> =>
    await Promise.resolve(lookupByKey(db, log, key)),
  register: async (name: string): Promise<Result<AgentRegistration, DbError>> =>
    await Promise.resolve(register(db, log, name)),
});

/** Build lock operations. */
const createLockOps: (
  db: Database.Database,
  log: Logger,
) => Pick<TooManyCooksDb, "acquireLock" | "forceReleaseLock" | "listLocks" | "queryLock" | "releaseLock" | "renewLock"> = (
  db: Database.Database,
  log: Logger,
): Pick<TooManyCooksDb, "acquireLock" | "forceReleaseLock" | "listLocks" | "queryLock" | "releaseLock" | "renewLock"> => ({
  acquireLock: async (
    filePath: string,
    name: string,
    key: string,
    reason: string | null | undefined,
    timeout: number,
  ): Promise<Result<LockResult, DbError>> =>
    await Promise.resolve(acquireLock(db, log, filePath, name, key, reason, timeout)),
  forceReleaseLock: async (
    filePath: string,
    name: string,
    key: string,
  ): Promise<Result<void, DbError>> =>
    await Promise.resolve(forceReleaseLock(db, log, filePath, name, key)),
  listLocks: async (): Promise<Result<readonly FileLock[], DbError>> =>
    await Promise.resolve(listLocks(db, log)),
  queryLock: async (filePath: string): Promise<Result<FileLock | null, DbError>> =>
    await Promise.resolve(queryLock(db, log, filePath)),
  releaseLock: async (
    filePath: string,
    name: string,
    key: string,
  ): Promise<Result<void, DbError>> =>
    await Promise.resolve(releaseLock(db, log, filePath, name, key)),
  renewLock: async (
    filePath: string,
    name: string,
    key: string,
    timeout: number,
  ): Promise<Result<void, DbError>> =>
    await Promise.resolve(renewLock(db, log, filePath, name, key, timeout)),
});

/** Build message operations. */
const createMessageOps: (
  db: Database.Database,
  log: Logger,
  config: TooManyCooksDataConfig,
) => Pick<TooManyCooksDb, "getMessages" | "listAllMessages" | "markRead" | "sendMessage"> = (
  db: Database.Database,
  log: Logger,
  config: TooManyCooksDataConfig,
): Pick<TooManyCooksDb, "getMessages" | "listAllMessages" | "markRead" | "sendMessage"> => ({
  getMessages: async (
    name: string,
    key: string,
    options?: { unreadOnly?: boolean },
  ): Promise<Result<readonly Message[], DbError>> =>
    await Promise.resolve(getMessages(db, log, name, key, options?.unreadOnly ?? true)),
  listAllMessages: async (): Promise<Result<readonly Message[], DbError>> =>
    await Promise.resolve(listAllMessages(db, log)),
  markRead: async (msgId: string, name: string, key: string): Promise<Result<void, DbError>> =>
    await Promise.resolve(markRead(db, log, msgId, name, key)),
  sendMessage: async (
    from: string,
    key: string,
    to: string,
    content: string,
  ): Promise<Result<string, DbError>> =>
    await Promise.resolve(sendMessage(db, log, from, key, to, content, config.maxMessageLength)),
});

/** Build plan operations. */
const createPlanOps: (
  db: Database.Database,
  log: Logger,
  config: TooManyCooksDataConfig,
) => Pick<TooManyCooksDb, "getPlan" | "listPlans" | "updatePlan"> = (
  db: Database.Database,
  log: Logger,
  config: TooManyCooksDataConfig,
): Pick<TooManyCooksDb, "getPlan" | "listPlans" | "updatePlan"> => ({
  getPlan: async (name: string): Promise<Result<AgentPlan | null, DbError>> =>
    await Promise.resolve(getPlan(db, log, name)),
  listPlans: async (): Promise<Result<readonly AgentPlan[], DbError>> =>
    await Promise.resolve(listPlans(db, log)),
  updatePlan: async (
    name: string,
    key: string,
    goal: string,
    task: string,
  ): Promise<Result<void, DbError>> =>
    await Promise.resolve(updatePlan(db, log, name, key, goal, task, config.maxPlanLength)),
});

/** Build admin operations and close. */
const createAdminOps: (
  db: Database.Database,
  log: Logger,
  config: TooManyCooksDataConfig,
) => Pick<TooManyCooksDb, "adminDeleteAgent" | "adminDeleteLock" | "adminReset" | "adminResetKey" | "adminSendMessage" | "close"> = (
  db: Database.Database,
  log: Logger,
  config: TooManyCooksDataConfig,
): Pick<TooManyCooksDb, "adminDeleteAgent" | "adminDeleteLock" | "adminReset" | "adminResetKey" | "adminSendMessage" | "close"> => ({
  adminDeleteAgent: async (name: string): Promise<Result<void, DbError>> =>
    await Promise.resolve(adminDeleteAgent(db, log, name)),
  adminDeleteLock: async (filePath: string): Promise<Result<void, DbError>> =>
    await Promise.resolve(adminDeleteLock(db, log, filePath)),
  adminReset: async (): Promise<Result<void, DbError>> =>
    await Promise.resolve(adminReset(db, log)),
  adminResetKey: async (name: string): Promise<Result<AgentRegistration, DbError>> =>
    await Promise.resolve(adminResetKey(db, log, name)),
  adminSendMessage: async (
    from: string,
    to: string,
    content: string,
  ): Promise<Result<string, DbError>> =>
    await Promise.resolve(
      adminSendMessage(db, log, from, to, content, config.maxMessageLength),
    ),
  close: async (): Promise<Result<undefined, DbError>> => {
    log.info("Closing database");
    try {
      db.close();
      return await Promise.resolve(success(undefined));
    } catch (e: unknown) {
      return await Promise.resolve(error({ code: ERR_DATABASE, message: String(e) }));
    }
  },
});

/** Wire up all database operations. */
const createDbOps: (
  db: Database.Database,
  config: TooManyCooksDataConfig,
  log: Logger,
) => TooManyCooksDb = (
  db: Database.Database,
  config: TooManyCooksDataConfig,
  log: Logger,
): TooManyCooksDb => ({
  ...createAgentOps(db, log),
  ...createLockOps(db, log),
  ...createMessageOps(db, log, config),
  ...createPlanOps(db, log, config),
  ...createAdminOps(db, log, config),
});
