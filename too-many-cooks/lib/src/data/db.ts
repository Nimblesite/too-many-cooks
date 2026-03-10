/* eslint-disable max-lines -- Database operations module; splitting would fragment cohesive DB logic */
/// Database operations for Too Many Cooks.

import Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { createLoggerWithContext, createLoggingContext, type Logger } from "../logger.js";
import {
  type Result,
  error,
  success,
  type RetryPolicy,
  defaultRetryPolicy,
  withRetry,
} from "../result.js";
import type { TooManyCooksDataConfig } from "./config.js";
import { CREATE_TABLES_SQL } from "./schema.js";
import {
  type AgentIdentity,
  type AgentPlan,
  type AgentRegistration,
  type DbError,
  type FileLock,
  type LockResult,
  type Message,
  agentIdentityFromJson,
  agentPlanFromJson,
  fileLockFromJson,
  messageFromJson,
  ERR_DATABASE,
  ERR_LOCK_HELD,
  ERR_NOT_FOUND,
  ERR_UNAUTHORIZED,
  ERR_VALIDATION,
} from "./types.js";

/** Key length in bytes for generating hex keys. */
const KEY_BYTE_LENGTH = 32;

/** Length of message ID substring. */
const MESSAGE_ID_LENGTH = 16;

/** Minimum agent name length. */
const MIN_AGENT_NAME_LENGTH = 1;

/** Maximum agent name length. */
const MAX_AGENT_NAME_LENGTH = 50;

/** Active flag value. */
const ACTIVE_TRUE = 1;

/** Inactive flag value. */
const ACTIVE_FALSE = 0;

/** Data access layer type. */
export type TooManyCooksDb = {
  readonly register: (agentName: string) => Result<AgentRegistration, DbError>;
  readonly authenticate: (
    agentName: string,
    agentKey: string,
  ) => Result<AgentIdentity, DbError>;
  readonly lookupByKey: (agentKey: string) => Result<string, DbError>;
  readonly listAgents: () => Result<readonly AgentIdentity[], DbError>;
  readonly acquireLock: (
    filePath: string,
    agentName: string,
    agentKey: string,
    reason: string | null | undefined,
    timeoutMs: number,
  ) => Result<LockResult, DbError>;
  readonly releaseLock: (
    filePath: string,
    agentName: string,
    agentKey: string,
  ) => Result<void, DbError>;
  readonly forceReleaseLock: (
    filePath: string,
    agentName: string,
    agentKey: string,
  ) => Result<void, DbError>;
  readonly queryLock: (
    filePath: string,
  ) => Result<FileLock | null, DbError>;
  readonly listLocks: () => Result<readonly FileLock[], DbError>;
  readonly renewLock: (
    filePath: string,
    agentName: string,
    agentKey: string,
    timeoutMs: number,
  ) => Result<void, DbError>;
  readonly sendMessage: (
    fromAgent: string,
    fromKey: string,
    toAgent: string,
    content: string,
  ) => Result<string, DbError>;
  readonly getMessages: (
    agentName: string,
    agentKey: string,
    options?: { readonly unreadOnly?: boolean },
  ) => Result<readonly Message[], DbError>;
  readonly markRead: (
    messageId: string,
    agentName: string,
    agentKey: string,
  ) => Result<void, DbError>;
  readonly updatePlan: (
    agentName: string,
    agentKey: string,
    goal: string,
    currentTask: string,
  ) => Result<void, DbError>;
  readonly getPlan: (
    agentName: string,
  ) => Result<AgentPlan | null, DbError>;
  readonly listPlans: () => Result<readonly AgentPlan[], DbError>;
  readonly listAllMessages: () => Result<readonly Message[], DbError>;
  readonly activate: (agentName: string) => Result<void, DbError>;
  readonly deactivate: (agentName: string) => Result<void, DbError>;
  readonly deactivateAll: () => Result<void, DbError>;
  readonly close: () => Result<void, DbError>;
  readonly adminDeleteLock: (filePath: string) => Result<void, DbError>;
  readonly adminDeleteAgent: (agentName: string) => Result<void, DbError>;
  readonly adminResetKey: (
    agentName: string,
  ) => Result<AgentRegistration, DbError>;
  readonly adminSendMessage: (
    fromAgent: string,
    toAgent: string,
    content: string,
  ) => Result<string, DbError>;
  readonly adminReset: () => Result<void, DbError>;
};

/** SQLite-specific retryable errors. */
const isSqliteRetryable = (err: string): boolean =>
  err.includes("disk I/O error") ||
  err.includes("database is locked") ||
  err.includes("SQLITE_BUSY");

/** Create a no-op logger. */
const noOpLogger = (): Logger =>
  createLoggerWithContext(createLoggingContext());

/** Generate a hex key from random bytes. */
const generateKey = (): string =>
  randomBytes(KEY_BYTE_LENGTH).toString("hex");

/** Current time in milliseconds. */
const now = (): number => Date.now();

/** Create database instance with retry policy. */
export const createDb = (
  config: TooManyCooksDataConfig,
  logger?: Logger,
  retryPolicy: RetryPolicy = defaultRetryPolicy,
): Result<TooManyCooksDb, string> => {
  const log = logger?.child({ component: "db" }) ?? noOpLogger();
  log.info(`Opening database at ${config.dbPath}`);

  return withRetry(
    retryPolicy,
    isSqliteRetryable,
    () => tryCreateDb(config, log),
    (attempt, err, delayMs) =>
      { log.warn(
        `Attempt ${String(attempt)} failed (retryable): ${err}. Retrying in ${String(delayMs)}ms...`,
      ); },
  );
};

/** Try to create and initialize the database. */
const tryCreateDb = (
  config: TooManyCooksDataConfig,
  log: Logger,
): Result<TooManyCooksDb, string> => {
  const dbDir = dirname(config.dbPath);
  if (!existsSync(dbDir)) {
    log.info(`Creating database directory: ${dbDir}`);
    try {
      mkdirSync(dbDir, { recursive: true });
    } catch (e: unknown) {
      return error(`Failed to create database directory: ${String(e)}`);
    }
  }

  try {
    const db = new Database(config.dbPath);
    return initSchema(db, log, config);
  } catch (e: unknown) {
    return error(`Failed to open database: ${String(e)}`);
  }
};

/** Initialize database schema. */
const initSchema = (
  db: Database.Database,
  log: Logger,
  config: TooManyCooksDataConfig,
): Result<TooManyCooksDb, string> => {
  log.debug("Initializing database schema");
  try {
    db.exec(CREATE_TABLES_SQL);
    log.debug("Schema initialized successfully");
    return success(createDbOps(db, config, log));
  } catch (e: unknown) {
    const msg = String(e);
    log.error(`Schema initialization failed: ${msg}`);
    return error(msg);
  }
};

/** Authenticate agent and update last_active timestamp. */
const authAndUpdate = (
  db: Database.Database,
  agentName: string,
  agentKey: string,
): Result<void, DbError> => {
  try {
    const stmt = db.prepare(
      "UPDATE identity SET last_active = ? WHERE agent_name = ? AND agent_key = ?",
    );
    const result = stmt.run(now(), agentName, agentKey);
    return result.changes === 0
      ? error({ code: ERR_UNAUTHORIZED, message: "Invalid credentials" })
      : success(undefined);
  } catch (e: unknown) {
    return error({ code: ERR_DATABASE, message: String(e) });
  }
};

/** Register a new agent. */
const register = (
  db: Database.Database,
  log: Logger,
  name: string,
): Result<AgentRegistration, DbError> => {
  log.debug(`Registering agent: ${name}`);
  if (name.length < MIN_AGENT_NAME_LENGTH || name.length > MAX_AGENT_NAME_LENGTH) {
    log.warn("Registration failed: invalid name length");
    return error({ code: ERR_VALIDATION, message: "Name must be 1-50 chars" });
  }
  const key = generateKey();
  const timestamp = now();
  try {
    const stmt = db.prepare(`
      INSERT INTO identity (agent_name, agent_key, active, registered_at, last_active)
      VALUES (?, ?, 1, ?, ?)
      ON CONFLICT(agent_name) DO UPDATE SET
        agent_key = excluded.agent_key,
        active = 1,
        registered_at = excluded.registered_at,
        last_active = excluded.last_active
      WHERE active = 0
    `);
    const result = stmt.run(name, key, timestamp, timestamp);
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
const getAgent = (
  db: Database.Database,
  name: string,
): Result<AgentIdentity, DbError> => {
  try {
    const stmt = db.prepare(
      "SELECT agent_name, registered_at, last_active FROM identity WHERE agent_name = ?",
    );
    const row = stmt.get(name) as Record<string, unknown> | undefined;
    return row === undefined
      ? error({ code: ERR_NOT_FOUND, message: "Agent not found" })
      : success(agentIdentityFromJson(row));
  } catch (e: unknown) {
    return error({ code: ERR_DATABASE, message: String(e) });
  }
};

/** Authenticate agent and return identity. */
const authenticate = (
  db: Database.Database,
  log: Logger,
  name: string,
  key: string,
): Result<AgentIdentity, DbError> => {
  log.debug(`Authenticating agent: ${name}`);
  const authResult = authAndUpdate(db, name, key);
  if (!authResult.ok) {
    log.warn(`Authentication failed for ${name}`);
    return authResult;
  }
  return getAgent(db, name);
};

/** Look up agent name by key. */
const lookupByKey = (
  db: Database.Database,
  log: Logger,
  key: string,
): Result<string, DbError> => {
  log.debug("Looking up agent by key");
  try {
    const stmt = db.prepare(
      "SELECT agent_name FROM identity WHERE agent_key = ?",
    );
    const row = stmt.get(key) as Record<string, unknown> | undefined;
    if (row === undefined) {
      return error({ code: ERR_UNAUTHORIZED, message: "Invalid key" });
    }
    const agentName = row.agent_name;
    return typeof agentName === "string"
      ? success(agentName)
      : error({ code: ERR_DATABASE, message: "Missing agent_name" });
  } catch (e: unknown) {
    return error({ code: ERR_DATABASE, message: String(e) });
  }
};

/** List all active agents. */
const listAgents = (
  db: Database.Database,
  log: Logger,
): Result<readonly AgentIdentity[], DbError> => {
  log.debug("Listing all agents");
  try {
    const stmt = db.prepare(
      "SELECT agent_name, registered_at, last_active FROM identity WHERE active = 1",
    );
    const rows = stmt.all() as ReadonlyArray<Record<string, unknown>>;
    return success(rows.map(agentIdentityFromJson));
  } catch (e: unknown) {
    return error({ code: ERR_DATABASE, message: String(e) });
  }
};

/** Query lock for a file path. */
const queryLock = (
  db: Database.Database,
  log: Logger,
  filePath: string,
): Result<FileLock | null, DbError> => {
  log.trace(`Querying lock for ${filePath}`);
  try {
    const stmt = db.prepare("SELECT * FROM locks WHERE file_path = ?");
    const row = stmt.get(filePath) as Record<string, unknown> | undefined;
    return row === undefined ? success(null) : success(fileLockFromJson(row));
  } catch (e: unknown) {
    return error({ code: ERR_DATABASE, message: String(e) });
  }
};

/** Delete a lock by file path. */
const deleteExpiredLock = (
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
const acquireLock = (
  db: Database.Database,
  log: Logger,
  filePath: string,
  agentName: string,
  agentKey: string,
  reason: string | null | undefined,
  timeoutMs: number,
): Result<LockResult, DbError> => {
  log.debug(`Acquiring lock on ${filePath} for ${agentName}`);
  const authResult = authAndUpdate(db, agentName, agentKey);
  if (!authResult.ok) {return authResult;}

  const timestamp = now();
  const expiresAt = timestamp + timeoutMs;

  const existing = queryLock(db, log, filePath);
  if (!existing.ok) {return existing;}
  if (existing.value !== null) {
    if (existing.value.expiresAt > timestamp) {
      return success({
        acquired: false,
        lock: undefined,
        error: `Held by ${existing.value.agentName} until ${String(existing.value.expiresAt)}`,
      });
    }
    const delResult = deleteExpiredLock(db, filePath);
    if (!delResult.ok) {return delResult;}
  }

  return insertLock(db, filePath, agentName, timestamp, expiresAt, reason);
};

/** Insert a new lock row. */
const insertLock = (
  db: Database.Database,
  filePath: string,
  agentName: string,
  timestamp: number,
  expiresAt: number,
  reason: string | null | undefined,
): Result<LockResult, DbError> => {
  try {
    const stmt = db.prepare(
      "INSERT INTO locks (file_path, agent_name, acquired_at, expires_at, reason) VALUES (?, ?, ?, ?, ?)",
    );
    stmt.run(filePath, agentName, timestamp, expiresAt, reason ?? null);
    return success({
      acquired: true,
      lock: { filePath, agentName, acquiredAt: timestamp, expiresAt, reason: reason ?? null, version: 1 },
      error: undefined,
    });
  } catch (e: unknown) {
    const msg = String(e);
    return msg.includes("UNIQUE")
      ? success({ acquired: false, lock: undefined, error: "Lock race condition" })
      : error({ code: ERR_DATABASE, message: msg });
  }
};

/** Release a file lock. */
const releaseLock = (
  db: Database.Database,
  log: Logger,
  filePath: string,
  agentName: string,
  agentKey: string,
): Result<void, DbError> => {
  log.debug(`Releasing lock on ${filePath} for ${agentName}`);
  const authResult = authAndUpdate(db, agentName, agentKey);
  if (!authResult.ok) {return authResult;}

  try {
    const stmt = db.prepare(
      "DELETE FROM locks WHERE file_path = ? AND agent_name = ?",
    );
    const result = stmt.run(filePath, agentName);
    return result.changes === 0
      ? error({ code: ERR_NOT_FOUND, message: "Lock not held by you" })
      : success(undefined);
  } catch (e: unknown) {
    return error({ code: ERR_DATABASE, message: String(e) });
  }
};

/** Force release an expired lock. */
const forceReleaseLock = (
  db: Database.Database,
  log: Logger,
  filePath: string,
  agentName: string,
  agentKey: string,
): Result<void, DbError> => {
  log.debug(`Force releasing lock on ${filePath} for ${agentName}`);
  const authResult = authAndUpdate(db, agentName, agentKey);
  if (!authResult.ok) {return authResult;}

  const existing = queryLock(db, log, filePath);
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
const listLocks = (
  db: Database.Database,
  log: Logger,
): Result<readonly FileLock[], DbError> => {
  log.trace("Listing all locks");
  try {
    const stmt = db.prepare("SELECT * FROM locks");
    const rows = stmt.all() as ReadonlyArray<Record<string, unknown>>;
    return success(rows.map(fileLockFromJson));
  } catch (e: unknown) {
    return error({ code: ERR_DATABASE, message: String(e) });
  }
};

/** Renew a file lock. */
const renewLock = (
  db: Database.Database,
  log: Logger,
  filePath: string,
  agentName: string,
  agentKey: string,
  timeoutMs: number,
): Result<void, DbError> => {
  log.debug(`Renewing lock on ${filePath} for ${agentName}`);
  const authResult = authAndUpdate(db, agentName, agentKey);
  if (!authResult.ok) {return authResult;}

  const newExpiry = now() + timeoutMs;
  try {
    const stmt = db.prepare(
      "UPDATE locks SET expires_at = ?, version = version + 1 WHERE file_path = ? AND agent_name = ?",
    );
    const result = stmt.run(newExpiry, filePath, agentName);
    return result.changes === 0
      ? error({ code: ERR_NOT_FOUND, message: "Lock not held by you" })
      : success(undefined);
  } catch (e: unknown) {
    return error({ code: ERR_DATABASE, message: String(e) });
  }
};

/** Send a message between agents. */
const sendMessage = (
  db: Database.Database,
  log: Logger,
  fromAgent: string,
  fromKey: string,
  toAgent: string,
  content: string,
  maxLen: number,
): Result<string, DbError> => {
  log.debug(`Sending message from ${fromAgent} to ${toAgent}`);
  const authResult = authAndUpdate(db, fromAgent, fromKey);
  if (!authResult.ok) {return authResult;}

  if (content.length > maxLen) {
    return error({
      code: ERR_VALIDATION,
      message: `Content exceeds ${String(maxLen)} chars`,
    });
  }

  const id = generateKey().substring(0, MESSAGE_ID_LENGTH);
  const timestamp = now();
  try {
    const stmt = db.prepare(
      "INSERT INTO messages (id, from_agent, to_agent, content, created_at) VALUES (?, ?, ?, ?, ?)",
    );
    stmt.run(id, fromAgent, toAgent, content, timestamp);
    return success(id);
  } catch (e: unknown) {
    return error({ code: ERR_DATABASE, message: String(e) });
  }
};

/** Auto-mark fetched messages as read. */
const autoMarkRead = (
  db: Database.Database,
  log: Logger,
  agentName: string,
  messages: readonly Message[],
): void => {
  const unreadIds = messages
    .filter((m) => m.readAt === undefined)
    .map((m) => m.id);
  if (unreadIds.length === 0) {return;}

  const timestamp = now();
  try {
    const stmt = db.prepare(
      "UPDATE messages SET read_at = ? WHERE id = ? AND to_agent = ? AND read_at IS NULL",
    );
    for (const id of unreadIds) {
      try {
        stmt.run(timestamp, id, agentName);
      } catch (innerErr: unknown) {
        log.warn(`Failed to mark message ${id} as read: ${String(innerErr)}`);
      }
    }
    log.debug(`Auto-marked ${String(unreadIds.length)} messages as read for ${agentName}`);
  } catch (e: unknown) {
    log.warn(`Failed to auto-mark messages read: ${String(e)}`);
  }
};

/** Get messages for an agent. */
const getMessages = (
  db: Database.Database,
  log: Logger,
  agentName: string,
  agentKey: string,
  unreadOnly: boolean,
): Result<readonly Message[], DbError> => {
  log.trace(`Getting messages for ${agentName} (unreadOnly: ${String(unreadOnly)})`);
  const authResult = authAndUpdate(db, agentName, agentKey);
  if (!authResult.ok) {return authResult;}

  const sql = unreadOnly
    ? "SELECT * FROM messages WHERE (to_agent = ? OR to_agent = '*') AND read_at IS NULL ORDER BY created_at DESC"
    : "SELECT * FROM messages WHERE (to_agent = ? OR to_agent = '*') ORDER BY created_at DESC";
  try {
    const stmt = db.prepare(sql);
    const rows = stmt.all(agentName) as ReadonlyArray<Record<string, unknown>>;
    const messageList = rows.map(messageFromJson);
    autoMarkRead(db, log, agentName, messageList);
    return success(messageList);
  } catch (e: unknown) {
    return error({ code: ERR_DATABASE, message: String(e) });
  }
};

/** Mark a message as read. */
const markRead = (
  db: Database.Database,
  log: Logger,
  messageId: string,
  agentName: string,
  agentKey: string,
): Result<void, DbError> => {
  log.trace(`Marking message ${messageId} as read for ${agentName}`);
  const authResult = authAndUpdate(db, agentName, agentKey);
  if (!authResult.ok) {return authResult;}

  try {
    const stmt = db.prepare(
      "UPDATE messages SET read_at = ? WHERE id = ? AND to_agent = ?",
    );
    const result = stmt.run(now(), messageId, agentName);
    return result.changes === 0
      ? error({ code: ERR_NOT_FOUND, message: "Message not found" })
      : success(undefined);
  } catch (e: unknown) {
    return error({ code: ERR_DATABASE, message: String(e) });
  }
};

/** Update an agent's plan. */
const updatePlan = (
  db: Database.Database,
  log: Logger,
  agentName: string,
  agentKey: string,
  goal: string,
  currentTask: string,
  maxLen: number,
): Result<void, DbError> => {
  log.debug(`Updating plan for ${agentName}`);
  const authResult = authAndUpdate(db, agentName, agentKey);
  if (!authResult.ok) {return authResult;}

  if (goal.length > maxLen || currentTask.length > maxLen) {
    return error({
      code: ERR_VALIDATION,
      message: `Fields exceed ${String(maxLen)} chars`,
    });
  }

  try {
    const stmt = db.prepare(`
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
const getPlan = (
  db: Database.Database,
  log: Logger,
  agentName: string,
): Result<AgentPlan | null, DbError> => {
  log.trace(`Getting plan for ${agentName}`);
  try {
    const stmt = db.prepare("SELECT * FROM plans WHERE agent_name = ?");
    const row = stmt.get(agentName) as Record<string, unknown> | undefined;
    return row === undefined ? success(null) : success(agentPlanFromJson(row));
  } catch (e: unknown) {
    return error({ code: ERR_DATABASE, message: String(e) });
  }
};

/** List all plans. */
const listPlans = (
  db: Database.Database,
  log: Logger,
): Result<readonly AgentPlan[], DbError> => {
  log.trace("Listing all plans");
  try {
    const stmt = db.prepare("SELECT * FROM plans");
    const rows = stmt.all() as ReadonlyArray<Record<string, unknown>>;
    return success(rows.map(agentPlanFromJson));
  } catch (e: unknown) {
    return error({ code: ERR_DATABASE, message: String(e) });
  }
};

/** List all messages. */
const listAllMessages = (
  db: Database.Database,
  log: Logger,
): Result<readonly Message[], DbError> => {
  log.trace("Listing all messages");
  try {
    const stmt = db.prepare(
      "SELECT * FROM messages ORDER BY created_at DESC",
    );
    const rows = stmt.all() as ReadonlyArray<Record<string, unknown>>;
    return success(rows.map(messageFromJson));
  } catch (e: unknown) {
    return error({ code: ERR_DATABASE, message: String(e) });
  }
};

/** Set agent active/inactive. */
const setActive = (
  db: Database.Database,
  log: Logger,
  agentName: string,
  active: boolean,
): Result<void, DbError> => {
  log.debug(`Setting agent ${agentName} active=${String(active)}`);
  const activeInt = active ? ACTIVE_TRUE : ACTIVE_FALSE;
  try {
    const stmt = db.prepare(
      "UPDATE identity SET active = ? WHERE agent_name = ?",
    );
    const result = stmt.run(activeInt, agentName);
    return result.changes === 0
      ? error({ code: ERR_NOT_FOUND, message: "Agent not found" })
      : success(undefined);
  } catch (e: unknown) {
    return error({ code: ERR_DATABASE, message: String(e) });
  }
};

/** Deactivate all agents. */
const deactivateAll = (
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
const adminDeleteLock = (
  db: Database.Database,
  log: Logger,
  filePath: string,
): Result<void, DbError> => {
  log.warn(`Admin deleting lock on ${filePath}`);
  try {
    const stmt = db.prepare("DELETE FROM locks WHERE file_path = ?");
    const result = stmt.run(filePath);
    return result.changes === 0
      ? error({ code: ERR_NOT_FOUND, message: "Lock not found" })
      : success(undefined);
  } catch (e: unknown) {
    return error({ code: ERR_DATABASE, message: String(e) });
  }
};

/** Admin: delete an agent and all related data. */
const adminDeleteAgent = (
  db: Database.Database,
  log: Logger,
  agentName: string,
): Result<void, DbError> => {
  log.warn(`Admin deleting agent ${agentName}`);
  try {
    db.prepare("DELETE FROM locks WHERE agent_name = ?").run(agentName);
    db.prepare(
      "DELETE FROM messages WHERE from_agent = ? OR to_agent = ?",
    ).run(agentName, agentName);
    db.prepare("DELETE FROM plans WHERE agent_name = ?").run(agentName);
    const result = db
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
const adminResetKey = (
  db: Database.Database,
  log: Logger,
  agentName: string,
): Result<AgentRegistration, DbError> => {
  log.warn(`Admin resetting key for agent ${agentName}`);

  // Release all locks held by this agent
  try {
    const lockResult = db
      .prepare("DELETE FROM locks WHERE agent_name = ?")
      .run(agentName);
    if (lockResult.changes > 0) {
      log.warn(`Released ${String(lockResult.changes)} locks for agent ${agentName}`);
    }
  } catch (e: unknown) {
    log.warn(`Failed to release locks: ${String(e)}`);
  }

  const newKey = generateKey();
  const timestamp = now();
  try {
    const stmt = db.prepare(
      "UPDATE identity SET agent_key = ?, last_active = ? WHERE agent_name = ?",
    );
    const result = stmt.run(newKey, timestamp, agentName);
    return result.changes === 0
      ? error({ code: ERR_NOT_FOUND, message: "Agent not found" })
      : success({ agentName, agentKey: newKey });
  } catch (e: unknown) {
    return error({ code: ERR_DATABASE, message: String(e) });
  }
};

/** Admin: reset all transient data. */
const adminReset = (
  db: Database.Database,
  log: Logger,
): Result<void, DbError> => {
  log.warn("Admin resetting transient data");
  const statements = [
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
const adminSendMessage = (
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

  const timestamp = now();
  // Ensure sender exists in identity table (FK constraint)
  try {
    const ensureStmt = db.prepare(
      "INSERT OR IGNORE INTO identity (agent_name, agent_key, registered_at, last_active) VALUES (?, ?, ?, ?)",
    );
    ensureStmt.run(fromAgent, generateKey(), timestamp, timestamp);
  } catch (e: unknown) {
    return error({ code: ERR_DATABASE, message: String(e) });
  }

  const id = generateKey().substring(0, MESSAGE_ID_LENGTH);
  try {
    const stmt = db.prepare(
      "INSERT INTO messages (id, from_agent, to_agent, content, created_at) VALUES (?, ?, ?, ?, ?)",
    );
    stmt.run(id, fromAgent, toAgent, content, timestamp);
    return success(id);
  } catch (e: unknown) {
    return error({ code: ERR_DATABASE, message: String(e) });
  }
};

/** Wire up all database operations. */
const createDbOps = (
  db: Database.Database,
  config: TooManyCooksDataConfig,
  log: Logger,
): TooManyCooksDb => ({
  register: (name) => register(db, log, name),
  authenticate: (name, key) => authenticate(db, log, name, key),
  lookupByKey: (key) => lookupByKey(db, log, key),
  listAgents: () => listAgents(db, log),
  acquireLock: (path, name, key, reason, timeout) =>
    acquireLock(db, log, path, name, key, reason, timeout),
  releaseLock: (path, name, key) => releaseLock(db, log, path, name, key),
  forceReleaseLock: (path, name, key) =>
    forceReleaseLock(db, log, path, name, key),
  queryLock: (path) => queryLock(db, log, path),
  listLocks: () => listLocks(db, log),
  renewLock: (path, name, key, timeout) =>
    renewLock(db, log, path, name, key, timeout),
  sendMessage: (from, key, to, content) =>
    sendMessage(db, log, from, key, to, content, config.maxMessageLength),
  getMessages: (name, key, options) =>
    getMessages(db, log, name, key, options?.unreadOnly ?? true),
  markRead: (id, name, key) => markRead(db, log, id, name, key),
  updatePlan: (name, key, goal, task) =>
    updatePlan(db, log, name, key, goal, task, config.maxPlanLength),
  getPlan: (name) => getPlan(db, log, name),
  listPlans: () => listPlans(db, log),
  listAllMessages: () => listAllMessages(db, log),
  activate: (name) => setActive(db, log, name, true),
  deactivate: (name) => setActive(db, log, name, false),
  deactivateAll: () => deactivateAll(db, log),
  close: (): Result<undefined, DbError> => {
    log.info("Closing database");
    try {
      db.close();
      return success(undefined);
    } catch (e: unknown) {
      return error({ code: ERR_DATABASE, message: String(e) });
    }
  },
  adminDeleteLock: (path) => adminDeleteLock(db, log, path),
  adminDeleteAgent: (name) => adminDeleteAgent(db, log, name),
  adminResetKey: (name) => adminResetKey(db, log, name),
  adminSendMessage: (from, to, content) =>
    adminSendMessage(db, log, from, to, content, config.maxMessageLength),
  adminReset: () => adminReset(db, log),
});
