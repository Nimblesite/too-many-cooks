/// SQLite admin operations: deletes, key resets, transient-data reset and
/// unauthenticated message sending, plus connection close.

import type Database from "better-sqlite3";

import {
  type AgentRegistration,
  type DbError,
  ERR_NOT_FOUND,
  ERR_VALIDATION,
  type Logger,
  type Result,
  type TooManyCooksDataConfig,
  error,
  success,
} from "too-many-cooks-core";

import type { AdminMethodGroup, CloseMethodGroup } from "../db-method-groups.js";
import { SQL_DEACTIVATE_ALL } from "./agents.js";
import { insertMessage } from "./messages.js";
import {
  BROADCAST_RECIPIENT,
  attempt,
  ensureInactiveIdentity,
  generateKey,
  newMessageId,
  now,
  runOrMiss,
  validateContentLength,
} from "./shared.js";

/** Admin: delete a lock by file path. */
const SQL_ADMIN_DELETE_LOCK: string = "DELETE FROM locks WHERE file_path = ?";

/** Admin: delete an agent row (cascades to dependent rows). */
const SQL_ADMIN_DELETE_AGENT: string = "DELETE FROM identity WHERE agent_name = ?";

/** Admin: release every lock an agent holds. */
const SQL_RELEASE_AGENT_LOCKS: string = "DELETE FROM locks WHERE agent_name = ?";

/** Admin: rotate an agent's key. */
const SQL_UPDATE_AGENT_KEY: string = "UPDATE identity SET agent_key = ?, last_active = ? WHERE agent_name = ?";

/** Admin: reset all transient data. */
const RESET_STATEMENTS: readonly string[] = [
  "DELETE FROM plans",
  "DELETE FROM messages",
  "DELETE FROM locks",
  SQL_DEACTIVATE_ALL,
];

/** Admin: delete a lock by file path. */
const adminDeleteLock: (db: Database.Database, log: Logger, filePath: string) => Result<void, DbError> = (
  db: Database.Database,
  log: Logger,
  filePath: string
): Result<void, DbError> => {
  log.warn(`Admin deleting lock on ${filePath}`);
  return attempt((): Result<void, DbError> =>
    runOrMiss(db.prepare(SQL_ADMIN_DELETE_LOCK), [filePath], {
      code: ERR_NOT_FOUND,
      message: "Lock not found",
    })
  );
};

/** Admin: delete an agent and all related data. */
const adminDeleteAgent: (db: Database.Database, log: Logger, agentName: string) => Result<void, DbError> = (
  db: Database.Database,
  log: Logger,
  agentName: string
): Result<void, DbError> => {
  log.warn(`Admin deleting agent ${agentName}`);
  if (agentName === BROADCAST_RECIPIENT) {
    return error({ code: ERR_VALIDATION, message: "Cannot delete broadcast sentinel" });
  }
  // Cascade is enforced by the schema (locks, plans, messages.from_agent,
  // messages.to_agent all ON DELETE CASCADE), so the single DELETE on
  // identity removes every dependent row atomically. No manual fan-out —
  // doing so would mask FK regressions.
  return attempt((): Result<void, DbError> =>
    runOrMiss(db.prepare(SQL_ADMIN_DELETE_AGENT), [agentName], {
      code: ERR_NOT_FOUND,
      message: "Agent not found",
    })
  );
};

/** Admin: release an agent's locks; failures are logged, never fatal. */
const releaseAgentLocks: (db: Database.Database, log: Logger, agentName: string) => void = (
  db: Database.Database,
  log: Logger,
  agentName: string
): void => {
  try {
    const lockResult: Database.RunResult = db.prepare(SQL_RELEASE_AGENT_LOCKS).run(agentName);
    if (lockResult.changes > 0) {
      log.warn(`Released ${String(lockResult.changes)} locks for agent ${agentName}`);
    }
  } catch (e: unknown) {
    log.warn(`Failed to release locks: ${String(e)}`);
  }
};

/** Admin: rotate an agent's key and report the new registration. */
const updateAgentKey: (db: Database.Database, agentName: string) => Result<AgentRegistration, DbError> = (
  db: Database.Database,
  agentName: string
): Result<AgentRegistration, DbError> => {
  const newKey: string = generateKey();
  return attempt((): Result<AgentRegistration, DbError> => {
    const result: Database.RunResult = db.prepare(SQL_UPDATE_AGENT_KEY).run(newKey, now(), agentName);
    return result.changes === 0
      ? error({ code: ERR_NOT_FOUND, message: "Agent not found" })
      : success({ agentName, agentKey: newKey });
  });
};

/** Admin: reset an agent's key. */
const adminResetKey: (db: Database.Database, log: Logger, agentName: string) => Result<AgentRegistration, DbError> = (
  db: Database.Database,
  log: Logger,
  agentName: string
): Result<AgentRegistration, DbError> => {
  log.warn(`Admin resetting key for agent ${agentName}`);
  releaseAgentLocks(db, log, agentName);
  return updateAgentKey(db, agentName);
};

/** Admin: reset all transient data. */
const adminReset: (db: Database.Database, log: Logger) => Result<void, DbError> = (
  db: Database.Database,
  log: Logger
): Result<void, DbError> => {
  log.warn("Admin resetting transient data");
  return attempt((): Result<void, DbError> => {
    for (const sql of RESET_STATEMENTS) {
      db.exec(sql);
    }
    return success(undefined);
  });
};

/** Auto-create sender/recipient identity rows so the to_agent FK is satisfied.
 *  '*' is skipped because the broadcast sentinel is seeded at DB open.
 *  Auto-created peers are inactive so they don't pollute agent listings; if
 *  they later register for real, the upsert in agents.ts reactivates them. */
const ensureParticipants: (
  db: Database.Database,
  fromAgent: string,
  toAgent: string,
  timestamp: number
) => Result<void, DbError> = (
  db: Database.Database,
  fromAgent: string,
  toAgent: string,
  timestamp: number
): Result<void, DbError> => {
  return attempt((): Result<void, DbError> => {
    ensureInactiveIdentity(db, fromAgent, generateKey(), timestamp);
    if (toAgent !== BROADCAST_RECIPIENT) {
      ensureInactiveIdentity(db, toAgent, generateKey(), timestamp);
    }
    return success(undefined);
  });
};

/** Admin: send a message without auth. */
const adminSendMessage: (
  db: Database.Database,
  log: Logger,
  fromAgent: string,
  toAgent: string,
  content: string,
  maxLen: number
) => Result<string, DbError> = (
  db: Database.Database,
  log: Logger,
  fromAgent: string,
  toAgent: string,
  content: string,
  maxLen: number
): Result<string, DbError> => {
  log.warn(`Admin sending message from ${fromAgent} to ${toAgent}`);
  const valid: Result<void, DbError> = validateContentLength(content, maxLen);
  if (!valid.ok) {
    return valid;
  }
  const timestamp: number = now();
  const ensured: Result<void, DbError> = ensureParticipants(db, fromAgent, toAgent, timestamp);
  if (!ensured.ok) {
    return ensured;
  }
  return insertMessage(db, newMessageId(), fromAgent, toAgent, content, timestamp);
};

/** Build admin operations and close. */
export const createAdminOps: (
  db: Database.Database,
  log: Logger,
  config: TooManyCooksDataConfig
) => AdminMethodGroup & CloseMethodGroup = (
  db: Database.Database,
  log: Logger,
  config: TooManyCooksDataConfig
): AdminMethodGroup & CloseMethodGroup => ({
  adminDeleteAgent: async (name: string): Promise<Result<void, DbError>> =>
    await Promise.resolve(adminDeleteAgent(db, log, name)),
  adminDeleteLock: async (filePath: string): Promise<Result<void, DbError>> =>
    await Promise.resolve(adminDeleteLock(db, log, filePath)),
  adminReset: async (): Promise<Result<void, DbError>> => await Promise.resolve(adminReset(db, log)),
  adminResetKey: async (name: string): Promise<Result<AgentRegistration, DbError>> =>
    await Promise.resolve(adminResetKey(db, log, name)),
  adminSendMessage: async (from: string, to: string, content: string): Promise<Result<string, DbError>> =>
    await Promise.resolve(adminSendMessage(db, log, from, to, content, config.maxMessageLength)),
  close: async (): Promise<Result<undefined, DbError>> => {
    log.info("Closing database");
    return await Promise.resolve(
      attempt((): Result<undefined, DbError> => {
        db.close();
        return success(undefined);
      })
    );
  },
});
