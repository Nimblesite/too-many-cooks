/// Configuration for Too Many Cooks data layer.
///
/// SINGLE SOURCE OF TRUTH for database path resolution.
/// Only the MCP server uses the database. The VSCode extension
/// communicates exclusively via HTTP to the MCP server.
/// The database is ALWAYS at `${workspaceFolder}/.too_many_cooks/data.db`.

import path from "node:path";

/** Data layer configuration. */
export type TooManyCooksDataConfig = {
  readonly dbPath: string;
  readonly lockTimeoutMs: number;
  readonly maxMessageLength: number;
  readonly maxPlanLength: number;
};

/** Resolve database path for a workspace folder. */
export const resolveDbPath: (workspaceFolder: string) => string = (workspaceFolder: string): string =>
  {return `${workspaceFolder}/.too_many_cooks/data.db`};

/** Default lock timeout in milliseconds (10 minutes). */
export const DEFAULT_LOCK_TIMEOUT_MS: number = 600000;

/** Default maximum message length in characters. */
export const DEFAULT_MAX_MESSAGE_LENGTH: number = 200;

/** Default maximum plan field length in characters. */
export const DEFAULT_MAX_PLAN_LENGTH: number = 100;

/** Create config with explicit dbPath. */
export const createDataConfig: (params: {
  readonly dbPath: string;
  readonly lockTimeoutMs?: number;
  readonly maxMessageLength?: number;
  readonly maxPlanLength?: number;
}) => TooManyCooksDataConfig = (params: {
  readonly dbPath: string;
  readonly lockTimeoutMs?: number;
  readonly maxMessageLength?: number;
  readonly maxPlanLength?: number;
}): TooManyCooksDataConfig => {return {
  dbPath: params.dbPath,
  lockTimeoutMs: params.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS,
  maxMessageLength: params.maxMessageLength ?? DEFAULT_MAX_MESSAGE_LENGTH,
  maxPlanLength: params.maxPlanLength ?? DEFAULT_MAX_PLAN_LENGTH,
}};

/** Create config from workspace folder. */
export const createDataConfigFromWorkspace: (
  workspaceFolder: string,
) => TooManyCooksDataConfig = (
  workspaceFolder: string,
): TooManyCooksDataConfig => {return createDataConfig({ dbPath: resolveDbPath(workspaceFolder) })};

/** Get workspace folder from TMC_WORKSPACE env var or process.cwd(). */
export const getWorkspaceFolder: () => string = (): string =>
  {return process.env.TMC_WORKSPACE ?? process.cwd()};

/** Default server port. */
export const DEFAULT_PORT: number = 4040;

/** Get server port from TMC_PORT env var or default (4040). */
export const getServerPort: () => number = (): number => {
  const raw: string | undefined = process.env.TMC_PORT;
  if (raw === undefined) {return DEFAULT_PORT;}
  const parsed: number = parseInt(raw, 10);
  return isNaN(parsed) ? DEFAULT_PORT : parsed;
};

/** Default configuration using the resolved workspace folder. */
export const defaultConfig: TooManyCooksDataConfig =
  createDataConfigFromWorkspace(getWorkspaceFolder());

/** Join path segments. */
export const pathJoin: (segments: readonly string[]) => string = (segments: readonly string[]): string =>
  {return path.join(...segments)};
