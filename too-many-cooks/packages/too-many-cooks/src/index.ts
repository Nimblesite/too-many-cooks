/// @too-many-cooks/local barrel export.
///
/// Re-exports core for convenience, plus local-specific exports.
/// Backend abstraction: env vars determine SQLite (local) or encrypted cloud.

export * from "too-many-cooks-core";
export { createDb } from "./db-sqlite.js";
export { createTooManyCooksServer } from "./server.js";
export { type TooManyCooksConfig, SERVER_BINARY, SERVER_NODE_ARGS } from "./config.js";

// Backend abstraction
export { createBackend, isCloudMode } from "./backend.js";

// Cloud client + encryption (used by VSIX cloud adapter, dashboard, etc.)
export { createCloudDb } from "./db-cloud.js";
export { withEncryption } from "./encryption-middleware.js";
export { deriveWorkspaceKey, encrypt, decrypt } from "./crypto.js";
export type { WorkspaceKey, Keychain } from "./crypto.js";
export { parseConfig } from "./cloud-config.js";
export type { CloudProxyConfig } from "./cloud-config.js";
