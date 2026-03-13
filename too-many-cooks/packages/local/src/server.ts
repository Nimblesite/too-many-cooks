/// Local (SQLite) convenience for creating the Too Many Cooks server.
///
/// Only the SQLite-specific `createTooManyCooksServer` lives here.
/// All shared MCP server logic is in @too-many-cooks/core.

import {
  type Logger,
  type Result,
  type ServerBundle,
  type TooManyCooksDataConfig,
  type TooManyCooksDb,
  createConsoleLogger,
  createMcpServerForDb,
  defaultConfig,
  error,
  success,
} from "@too-many-cooks/core";

import { createDb } from "./db-sqlite.js";

// Re-export shared server pieces from core for backwards compatibility
export { createMcpServerForDb, createConsoleLogger, type ServerBundle } from "@too-many-cooks/core";

/** Create the Too Many Cooks MCP server with a local SQLite DB. */
export const createTooManyCooksServer = (
  config?: TooManyCooksDataConfig,
  logger?: Logger,
): Result<ServerBundle, string> => {
  const cfg = config ?? defaultConfig;
  const log = logger ?? createConsoleLogger();
  log.info("Creating Too Many Cooks server");

  const dbResult = createDb(cfg);
  if (!dbResult.ok) {
    log.error("Failed to create database", { error: dbResult.error });
    return error(dbResult.error);
  }
  const db: TooManyCooksDb = dbResult.value;
  log.debug("Database created successfully");

  const serverResult = createMcpServerForDb(db, cfg, log);
  if (!serverResult.ok) {return error(serverResult.error);}

  return success({ server: serverResult.value, db });
};
