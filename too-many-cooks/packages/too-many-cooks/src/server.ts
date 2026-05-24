/// Convenience wrapper for creating the Too Many Cooks server.
///
/// Uses the backend abstraction — env vars determine SQLite or cloud.
/// All shared MCP server logic is in too-many-cooks-core.

import {
  type Logger,
  type Result,
  type ServerBundle,
  type TooManyCooksDataConfig,
  type TooManyCooksDb,
  createLoggerWithContext,
  createLoggingContext,
  createMcpServerForDb,
  defaultConfig,
  error,
  success,
} from "too-many-cooks-core";

import { createBackend } from "./backend.js";

// Re-export shared server pieces from core for backwards compatibility
export { createMcpServerForDb, createConsoleLogger, type ServerBundle } from "too-many-cooks-core";

/** Type alias for the return of createMcpServerForDb. */
type McpServerResult = ReturnType<typeof createMcpServerForDb>;

/** Silent default logger.
 *  `createTooManyCooksServer` is a library function — its failures travel
 *  back to the caller through the `Result<ServerBundle, string>` return type.
 *  Spraying diagnostics at stdio behind the caller's back hides errors in
 *  CI test output and pollutes structured log pipelines. Callers that want
 *  output pass their own logger (the bin does). */
const silentLogger: Logger = createLoggerWithContext(createLoggingContext());

/** Create the Too Many Cooks MCP server (backend chosen by env vars). */
export const createTooManyCooksServer: (
  config?: TooManyCooksDataConfig,
  logger?: Logger,
) => Result<ServerBundle, string> = (
  config?: TooManyCooksDataConfig,
  logger?: Logger,
): Result<ServerBundle, string> => {
  const cfg: TooManyCooksDataConfig = config ?? defaultConfig;
  const log: Logger = logger ?? silentLogger;
  log.info("Creating Too Many Cooks server");

  const dbResult: Result<TooManyCooksDb, string> = createBackend(cfg, log);
  if (!dbResult.ok) {
    log.error("Failed to create database", { error: dbResult.error });
    return error(dbResult.error);
  }
  const db: TooManyCooksDb = dbResult.value;
  log.debug("Database created successfully");

  const serverResult: McpServerResult = createMcpServerForDb(db, cfg, log);
  if (!serverResult.ok) {return error(serverResult.error);}

  return success({ server: serverResult.value, db });
};
