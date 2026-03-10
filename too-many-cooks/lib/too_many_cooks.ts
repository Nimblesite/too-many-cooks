/// Multi-agent Git coordination MCP server.
///
/// Enables multiple AI agents to safely edit a git repository simultaneously
/// through advisory file locking, identity verification, inter-agent messaging,
/// and plan visibility.

export * from "./src/admin_routes.js";
export * from "./src/config.js";
export { type TooManyCooksDb, createDb } from "./src/data/data.js";
export { type AgentEventHub, createAgentEventHub } from "./src/notifications.js";
export * from "./src/server.js";
export * from "./src/types.js";
