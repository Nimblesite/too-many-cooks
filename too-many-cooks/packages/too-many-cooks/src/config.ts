/// Configuration for Too Many Cooks MCP server.
///
/// Re-exports core config and adds local-specific constants.

export {
  type TooManyCooksDataConfig,
  createDataConfig,
  createDataConfigFromWorkspace,
  defaultConfig,
  DEFAULT_PORT as defaultPort,
  getServerPort,
  getWorkspaceFolder,
  resolveDbPath,
  pathJoin,
} from "too-many-cooks-core";

import type { TooManyCooksDataConfig } from "too-many-cooks-core";

/** Server configuration type alias for backwards compatibility. */
export type TooManyCooksConfig = TooManyCooksDataConfig;

/** Server entry point relative path. */
export const SERVER_BINARY: string = "bin/server.ts";

/** Node args needed to run the server (tsx loader for TypeScript). */
export const SERVER_NODE_ARGS: readonly string[] = ["--import", "tsx"] as const;
