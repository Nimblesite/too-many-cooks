/// @too-many-cooks/local barrel export.
///
/// Re-exports core for convenience, plus local-specific exports.
/// Local = SQLite backend. The ONLY local-specific code is createDb + createTooManyCooksServer.

export * from "@too-many-cooks/core";
export { createDb } from "./db-sqlite.js";
export { createTooManyCooksServer } from "./server.js";
export { type TooManyCooksConfig, SERVER_BINARY, SERVER_NODE_ARGS } from "./config.js";
