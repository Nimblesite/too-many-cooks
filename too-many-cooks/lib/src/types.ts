/// MCP-specific types for Too Many Cooks server.

// Re-export all types from shared package.
export {
  type AgentIdentity,
  type AgentPlan,
  type AgentRegistration,
  type DbError,
  type FileLock,
  type LockResult,
  type Message,
  ERR_DATABASE,
  ERR_LOCK_EXPIRED,
  ERR_LOCK_HELD,
  ERR_NOT_FOUND,
  ERR_UNAUTHORIZED,
  ERR_VALIDATION,
} from "./data/data.js";

/** Text content item for MCP tool responses. */
export type TextContent = {
  readonly type: "text";
  readonly text: string;
};

/** Create text content for MCP tool responses. */
export const textContent = (text: string): TextContent => ({
  type: "text",
  text,
});

/** Session identity stored after registration. */
export type SessionIdentity = {
  readonly agentName: string;
  readonly agentKey: string;
};

/** Gets the current session identity (null if not registered). */
export type SessionGetter = () => SessionIdentity | null;

/** Sets the session identity after registration. */
export type SessionSetter = (agentName: string, agentKey: string) => void;

/** MCP tool call result. */
export type CallToolResult = {
  readonly content: TextContent[];
  readonly isError: boolean;
};

/** MCP tool callback. */
export type ToolCallback = (
  args: Record<string, unknown>,
  meta: unknown,
) => Promise<CallToolResult>;
