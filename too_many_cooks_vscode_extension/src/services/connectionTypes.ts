// Connection target types for the VSIX connection switcher.
//
// Spec: tmc-cloud/docs/vsix-connection-switcher-spec.md
// Plan: tmc-cloud/docs/vsix-connection-switcher-plan.md

/** MCP transport protocol. */
export type Transport = 'http-streamable' | 'stdio';

/** Local server connection target. Always HTTP Streamable. */
export interface LocalTarget {
  readonly mode: 'local';
  readonly port: number;
  readonly transport: 'http-streamable';
}

/** TMC Cloud connection target. */
export interface CloudTarget {
  readonly apiKey: string;
  readonly apiUrl: string;
  readonly mode: 'cloud';
  readonly passphrase: string;
  readonly tenantId: string;
  readonly transport: Transport;
  readonly workspaceId: string;
}

/** Discriminated union of connection targets. */
export type ConnectionTarget = CloudTarget | LocalTarget;

/** Current connection mode. */
export type ConnectionMode = 'cloud' | 'disconnected' | 'local';

/** Supported AI agent types for MCP config writing. */
export type AgentType = 'claude-code' | 'cline' | 'codex' | 'cursor';

/** MCP server config for HTTP Streamable transport. */
export interface HttpStreamableConfig {
  readonly url: string;
}

/** MCP server config for stdio transport. */
export interface StdioConfig {
  readonly args: readonly string[];
  readonly command: string;
  readonly env: Readonly<Record<string, string>>;
}

/** MCP server configuration written to agent config files. */
export type AgentMcpConfig = HttpStreamableConfig | StdioConfig;
