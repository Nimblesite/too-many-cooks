/* eslint-disable max-lines -- Database operations module; splitting would fragment cohesive DB logic */
/// SQLite database implementation for Too Many Cooks.

import Database from "better-sqlite3";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";

import { applyMigrations } from "./migrate.js";

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
  type MessageHeader,
  type MessageOverview,
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
} from "too-many-cooks-core";

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

/** Broadcast recipient marker. Also the reserved agent_name of the sentinel
 *  identity row that lets the messages.to_agent foreign key target broadcasts
 *  without orphaning them. The sentinel is created with active=0 so
 *  listAgents (which filters by active=1) never surfaces it in the UI. */
const BROADCAST_RECIPIENT: string = "*";

/** Insert the reserved '*' identity row required by the messages.to_agent FK
 *  for broadcasts. Idempotent — re-runs on every DB open are safe. The row
 *  is kept active=0 so it never appears in agent listings. */
const seedBroadcastSentinel: (db: Database.Database) => void = (
  db: Database.Database,
): void => {
  const timestamp: number = now();
  db.prepare(
    "INSERT OR IGNORE INTO identity (agent_name, agent_key, active, registered_at, last_active) VALUES (?, ?, 0, ?, ?)",
  ).run(BROADCAST_RECIPIENT, `__broadcast_sentinel_${generateKey()}`, timestamp, timestamp);
};

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

/** Apply Prisma migrations and open the DB. Closes the handle on failure so the file can be unlinked. */
const openAndInit: (
  config: TooManyCooksDataConfig,
  log: Logger,
) => Result<TooManyCooksDb, string> = (
  config: TooManyCooksDataConfig,
  log: Logger,
): Result<TooManyCooksDb, string> => {
  try {
    applyMigrations(config.dbPath);
  } catch (e: unknown) {
    return error(`Prisma migrate deploy failed: ${String(e)}`);
  }
  let db: Database.Database;
  try {
    db = new Database(config.dbPath);
    db.pragma("foreign_keys = ON");
    seedBroadcastSentinel(db);
  } catch (e: unknown) {
    return error(`Failed to open database: ${String(e)}`);
  }
  log.debug("Schema applied via prisma migrate deploy");
  return success(createDbOps(db, config, log));
};

/** Try to create and initialize the database. If migration fails on an existing DB, blow it away and retry once. */
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

  const first: Result<TooManyCooksDb, string> = openAndInit(config, log);
  if (first.ok) { return first; }

  log.warn(`Schema init failed: ${first.error}. Deleting DB file and starting fresh.`);
  try {
    if (existsSync(config.dbPath)) { unlinkSync(config.dbPath); }
  } catch (e: unknown) {
    return error(`Failed to delete corrupt DB at ${config.dbPath}: ${String(e)}`);
  }
  return openAndInit(config, log);
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
  if (name === BROADCAST_RECIPIENT) {
    log.warn("Registration failed: reserved broadcast name");
    return error({ code: ERR_VALIDATION, message: "Name '*' is reserved for broadcasts" });
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

/** Auto-mark fetched messages as read. Direct messages update read_at; broadcasts insert into message_reads. */
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
  const unread: readonly Message[] = messages.filter(
    (msg: Message): boolean => msg.readAt === undefined,
  );
  if (unread.length === 0) {return;}

  const timestamp: number = now();
  try {
    const directStmt: Database.Statement = db.prepare(
      "UPDATE messages SET read_at = ? WHERE id = ? AND to_agent = ? AND read_at IS NULL",
    );
    const broadcastStmt: Database.Statement = db.prepare(
      "INSERT OR IGNORE INTO message_reads (message_id, agent_name, read_at) VALUES (?, ?, ?)",
    );
    for (const msg of unread) {
      try {
        if (msg.toAgent === BROADCAST_RECIPIENT) {
          broadcastStmt.run(msg.id, agentName, timestamp);
        } else {
          directStmt.run(timestamp, msg.id, agentName);
        }
      } catch (innerErr: unknown) {
        log.warn(`Failed to mark message ${msg.id} as read: ${String(innerErr)}`);
      }
    }
    log.debug(`Auto-marked ${String(unread.length)} messages as read for ${agentName}`);
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
    ? `SELECT m.* FROM messages m
       WHERE (m.to_agent = ? AND m.read_at IS NULL)
          OR (m.to_agent = '*'
              AND NOT EXISTS (SELECT 1 FROM message_reads mr WHERE mr.message_id = m.id AND mr.agent_name = ?))
       ORDER BY m.created_at DESC`
    : "SELECT * FROM messages WHERE (to_agent = ? OR to_agent = '*') ORDER BY created_at DESC";
  try {
    const stmt: Database.Statement = db.prepare(sql);
    const params: string[] = unreadOnly
      ? [agentName, agentName]
      : [agentName];
    const rows: ReadonlyArray<Record<string, unknown>> = toRows(stmt.all(...params));
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
    const msg: Record<string, unknown> | undefined = toRow(
      db.prepare("SELECT to_agent FROM messages WHERE id = ?").get(messageId),
    );
    if (msg === undefined) {
      return error({ code: ERR_NOT_FOUND, message: "Message not found" });
    }
    const toAgent: unknown = msg.to_agent;
    if (typeof toAgent !== "string") {
      return error({ code: ERR_DATABASE, message: "Invalid to_agent in message" });
    }
    const timestamp: number = now();
    if (toAgent === BROADCAST_RECIPIENT) {
      db.prepare(
        "INSERT OR IGNORE INTO message_reads (message_id, agent_name, read_at) VALUES (?, ?, ?)",
      ).run(messageId, agentName, timestamp);
    } else {
      const result: Database.RunResult = db.prepare(
        "UPDATE messages SET read_at = ? WHERE id = ? AND to_agent = ?",
      ).run(timestamp, messageId, agentName);
      if (result.changes === 0) {
        return error({ code: ERR_NOT_FOUND, message: "Message not found" });
      }
    }
    return success(undefined);
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

/// [STATUS-BOUNDED] Issues #41/#42: columns for a message header — never `content`.
const MESSAGE_HEADER_COLUMNS: string = "id, from_agent, to_agent, created_at, read_at";

/// [STATUS-BOUNDED] Predicate: every message visible to a named caller (own
/// inbox, own sent, and broadcasts). Params: [agentName, agentName, '*'].
const VISIBLE_TO_AGENT_WHERE: string = "to_agent = ? OR from_agent = ? OR to_agent = ?";

/// [STATUS-BOUNDED] Predicate: a named caller's UNREAD inbox — mirrors the
/// getMessages unreadOnly query. Params: [agentName, '*', agentName].
const UNREAD_FOR_AGENT_WHERE: string =
  "(to_agent = ? AND read_at IS NULL) OR (to_agent = ? AND NOT EXISTS " +
  "(SELECT 1 FROM message_reads mr WHERE mr.message_id = messages.id AND mr.agent_name = ?))";

/** Run a COUNT(*) query returning column `c` and narrow it to a number. */
const countRows: (
  db: Database.Database,
  sql: string,
  params: ReadonlyArray<number | string>,
) => number = (
  db: Database.Database,
  sql: string,
  params: ReadonlyArray<number | string>,
): number => {
  const row: Record<string, unknown> | undefined = toRow(db.prepare(sql).get(...params));
  return typeof row?.c === "number" ? row.c : 0;
};

/** Map a SQLite row to a MessageHeader (no body). */
const messageHeaderFromRow: (row: Record<string, unknown>) => MessageHeader = (
  row: Record<string, unknown>,
): MessageHeader => ({
  id: typeof row.id === "string" ? row.id : "",
  fromAgent: typeof row.from_agent === "string" ? row.from_agent : "",
  toAgent: typeof row.to_agent === "string" ? row.to_agent : "",
  createdAt: typeof row.created_at === "number" ? row.created_at : 0,
  readAt: typeof row.read_at === "number" ? row.read_at : undefined,
});

/// [STATUS-BOUNDED] Overview for a named caller: total visible, unread inbox
/// count, and a bounded slice of recent unread inbox headers.
const agentMessageOverview: (
  db: Database.Database,
  agentName: string,
  limit: number,
) => MessageOverview = (
  db: Database.Database,
  agentName: string,
  limit: number,
): MessageOverview => {
  const total: number = countRows(db, `SELECT COUNT(*) AS c FROM messages WHERE ${VISIBLE_TO_AGENT_WHERE}`, [agentName, agentName, BROADCAST_RECIPIENT]);
  const unread: number = countRows(db, `SELECT COUNT(*) AS c FROM messages WHERE ${UNREAD_FOR_AGENT_WHERE}`, [agentName, BROADCAST_RECIPIENT, agentName]);
  const rows: ReadonlyArray<Record<string, unknown>> = toRows(
    db.prepare(`SELECT ${MESSAGE_HEADER_COLUMNS} FROM messages WHERE ${UNREAD_FOR_AGENT_WHERE} ORDER BY created_at DESC LIMIT ?`).all(agentName, BROADCAST_RECIPIENT, agentName, limit),
  );
  return { total, unread, recent: rows.map(messageHeaderFromRow) };
};

/// [STATUS-BOUNDED] Overview for an unresolved caller: broadcasts only. Reads
/// cannot be tracked without an identity, so every broadcast counts as unread.
const broadcastMessageOverview: (
  db: Database.Database,
  limit: number,
) => MessageOverview = (
  db: Database.Database,
  limit: number,
): MessageOverview => {
  const total: number = countRows(db, "SELECT COUNT(*) AS c FROM messages WHERE to_agent = ?", [BROADCAST_RECIPIENT]);
  const rows: ReadonlyArray<Record<string, unknown>> = toRows(
    db.prepare(`SELECT ${MESSAGE_HEADER_COLUMNS} FROM messages WHERE to_agent = ? ORDER BY created_at DESC LIMIT ?`).all(BROADCAST_RECIPIENT, limit),
  );
  return { total, unread: total, recent: rows.map(messageHeaderFromRow) };
};

/// [STATUS-BOUNDED] Issues #41/#42: bounded, SQL-filtered inbox overview. No
/// auto-mark-read side effect — `status` is a read-only overview.
const getMessageOverview: (
  db: Database.Database,
  log: Logger,
  agentName: string | null,
  limit: number,
) => Result<MessageOverview, DbError> = (
  db: Database.Database,
  log: Logger,
  agentName: string | null,
  limit: number,
): Result<MessageOverview, DbError> => {
  log.trace(`Building message overview (caller: ${agentName ?? "anonymous"})`);
  try {
    return success(
      agentName === null
        ? broadcastMessageOverview(db, limit)
        : agentMessageOverview(db, agentName, limit),
    );
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
  if (agentName === BROADCAST_RECIPIENT) {
    return error({ code: ERR_VALIDATION, message: "Cannot delete broadcast sentinel" });
  }
  try {
    // Cascade is enforced by the schema (locks, plans, messages.from_agent,
    // messages.to_agent all ON DELETE CASCADE), so the single DELETE on
    // identity removes every dependent row atomically. No manual fan-out —
    // doing so would mask FK regressions.
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
      "INSERT OR IGNORE INTO identity (agent_name, agent_key, active, registered_at, last_active) VALUES (?, ?, 0, ?, ?)",
    );
    // Auto-create sender (existing behaviour) AND recipient so the to_agent
    // FK is satisfied. '*' is skipped because the broadcast sentinel is
    // seeded at DB open. Auto-created peers are inactive so they don't
    // pollute agent listings; if they later register for real, the upsert
    // in register() reactivates them.
    ensureStmt.run(fromAgent, generateKey(), timestamp, timestamp);
    if (toAgent !== BROADCAST_RECIPIENT) {
      ensureStmt.run(toAgent, generateKey(), timestamp, timestamp);
    }
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
) => Pick<TooManyCooksDb, "getMessageOverview" | "getMessages" | "listAllMessages" | "markRead" | "sendMessage"> = (
  db: Database.Database,
  log: Logger,
  config: TooManyCooksDataConfig,
): Pick<TooManyCooksDb, "getMessageOverview" | "getMessages" | "listAllMessages" | "markRead" | "sendMessage"> => ({
  getMessages: async (
    name: string,
    key: string,
    options?: { unreadOnly?: boolean },
  ): Promise<Result<readonly Message[], DbError>> =>
    await Promise.resolve(getMessages(db, log, name, key, options?.unreadOnly ?? true)),
  getMessageOverview: async (
    name: string | null,
    limit: number,
  ): Promise<Result<MessageOverview, DbError>> =>
    await Promise.resolve(getMessageOverview(db, log, name, limit)),
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
