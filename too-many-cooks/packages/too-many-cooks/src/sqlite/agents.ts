/// SQLite agent identity + lifecycle operations.

import type Database from "better-sqlite3";

import {
  type AgentIdentity,
  type AgentRegistration,
  type DbError,
  ERR_DATABASE,
  ERR_NOT_FOUND,
  ERR_UNAUTHORIZED,
  ERR_VALIDATION,
  type Logger,
  type Result,
  agentIdentityFromJson,
  error,
  success,
} from "too-many-cooks-core";

import type { AgentMethodGroup } from "../db-method-groups.js";
import {
  type SqliteParams,
  ACTIVE_FALSE,
  ACTIVE_TRUE,
  BROADCAST_RECIPIENT,
  asyncDbOp,
  attempt,
  authAndUpdate,
  generateKey,
  isNameLengthValid,
  now,
  runOrMiss,
  selectMappedRows,
  toRow,
} from "./shared.js";

/** Fetch an agent's public identity columns. */
const SQL_GET_AGENT: string = "SELECT agent_name, registered_at, last_active FROM identity WHERE agent_name = ?";

/** List active agents. */
const SQL_LIST_AGENTS: string = "SELECT agent_name, registered_at, last_active FROM identity WHERE active = 1";

/** Resolve an agent name from a key. */
const SQL_LOOKUP_BY_KEY: string = "SELECT agent_name FROM identity WHERE agent_key = ?";

/** Register a new agent or reactivate an inactive one. */
const SQL_REGISTER_UPSERT: string = `
      INSERT INTO identity (agent_name, agent_key, active, registered_at, last_active)
      VALUES (?, ?, 1, ?, ?)
      ON CONFLICT(agent_name) DO UPDATE SET
        agent_key = excluded.agent_key,
        active = 1,
        registered_at = excluded.registered_at,
        last_active = excluded.last_active
      WHERE active = 0
    `;

/** Flip an agent's active flag. */
const SQL_SET_ACTIVE: string = "UPDATE identity SET active = ? WHERE agent_name = ?";

/** Deactivate every agent. */
export const SQL_DEACTIVATE_ALL: string = "UPDATE identity SET active = 0";

/** Register a new agent. */
const register = (db: Database.Database, log: Logger, name: string): Result<AgentRegistration, DbError> => {
  log.debug(`Registering agent: ${name}`);
  if (!isNameLengthValid(name)) {
    log.warn("Registration failed: invalid name length");
    return error({ code: ERR_VALIDATION, message: "Name must be 1-50 chars" });
  }
  if (name === BROADCAST_RECIPIENT) {
    log.warn("Registration failed: reserved broadcast name");
    return error({ code: ERR_VALIDATION, message: "Name '*' is reserved for broadcasts" });
  }
  return insertRegistration(db, log, name);
};

/** Insert the registration row and report the outcome. */
const insertRegistration = (db: Database.Database, log: Logger, name: string): Result<AgentRegistration, DbError> => {
  const key: string = generateKey();
  const timestamp: number = now();
  try {
    const result: Database.RunResult = db.prepare(SQL_REGISTER_UPSERT).run(name, key, timestamp, timestamp);
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
const getAgent = (db: Database.Database, name: string): Result<AgentIdentity, DbError> => {
  return attempt((): Result<AgentIdentity, DbError> => {
    const row: Record<string, unknown> | undefined = toRow(db.prepare(SQL_GET_AGENT).get(name));
    return row === undefined
      ? error({ code: ERR_NOT_FOUND, message: "Agent not found" })
      : success(agentIdentityFromJson(row));
  });
};

/** Authenticate agent and return identity. */
const authenticate = (
  db: Database.Database,
  log: Logger,
  name: string,
  key: string
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
const lookupByKey = (db: Database.Database, log: Logger, key: string): Result<string, DbError> => {
  log.debug("Looking up agent by key");
  return attempt((): Result<string, DbError> => {
    const row: Record<string, unknown> | undefined = toRow(db.prepare(SQL_LOOKUP_BY_KEY).get(key));
    if (row === undefined) {
      return error({ code: ERR_UNAUTHORIZED, message: "Invalid key" });
    }
    const agentName: unknown = row.agent_name;
    return typeof agentName === "string"
      ? success(agentName)
      : error({ code: ERR_DATABASE, message: "Missing agent_name" });
  });
};

/** List all active agents. */
const listAgents = (db: Database.Database, log: Logger): Result<readonly AgentIdentity[], DbError> => {
  log.debug("Listing all agents");
  return selectMappedRows(db, SQL_LIST_AGENTS, agentIdentityFromJson);
};

/** Set agent active/inactive. */
const setActive = (
  db: Database.Database,
  log: Logger,
  agentName: string,
  active: boolean
): Result<void, DbError> => {
  log.debug(`Setting agent ${agentName} active=${String(active)}`);
  const params: SqliteParams = [active ? ACTIVE_TRUE : ACTIVE_FALSE, agentName];
  return attempt((): Result<void, DbError> =>
    runOrMiss(db.prepare(SQL_SET_ACTIVE), params, {
      code: ERR_NOT_FOUND,
      message: "Agent not found",
    })
  );
};

/** Deactivate all agents. */
const deactivateAll = (db: Database.Database, log: Logger): Result<void, DbError> => {
  log.debug("Deactivating all agents");
  return attempt((): Result<void, DbError> => {
    db.prepare(SQL_DEACTIVATE_ALL).run();
    return success(undefined);
  });
};

/** Build agent identity operations. */
export const createAgentOps = (db: Database.Database, log: Logger): AgentMethodGroup => ({
  activate: async (name: string): Promise<Result<void, DbError>> =>
    await Promise.resolve(setActive(db, log, name, true)),
  authenticate: asyncDbOp(authenticate, db, log),
  deactivate: async (name: string): Promise<Result<void, DbError>> =>
    await Promise.resolve(setActive(db, log, name, false)),
  deactivateAll: asyncDbOp(deactivateAll, db, log),
  listAgents: asyncDbOp(listAgents, db, log),
  lookupByKey: asyncDbOp(lookupByKey, db, log),
  register: asyncDbOp(register, db, log),
});
