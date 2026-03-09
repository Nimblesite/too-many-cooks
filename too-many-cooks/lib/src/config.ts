/// Configuration for Too Many Cooks MCP server.
///
/// Database path resolution
/// lives in the data package to guarantee a single source of truth.

export {
  type TooManyCooksDataConfig,
  createDataConfig,
  createDataConfigFromWorkspace,
  defaultConfig,
  DEFAULT_PORT as defaultPort,
  getServerPort,
  getWorkspaceFolder,
  resolveDbPath,
} from "./data/data.js";

import type { TooManyCooksDataConfig } from "./data/data.js";

/** Server configuration type alias for backwards compatibility. */
export type TooManyCooksConfig = TooManyCooksDataConfig;

/** Server entry point relative path. */
export const SERVER_BINARY = "bin/server.ts";

/** Node args needed to run the server (tsx loader for TypeScript). */
export const SERVER_NODE_ARGS = ["--import", "tsx"] as const;
