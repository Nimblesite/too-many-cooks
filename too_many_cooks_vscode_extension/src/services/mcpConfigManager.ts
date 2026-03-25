// MCP Config Manager — detect AI agents and write/remove MCP server configs.
//
// Phase 2 of the VSIX connection switcher.
// Spec: tmc-cloud/docs/vsix-connection-switcher-spec.md
// Plan: tmc-cloud/docs/vsix-connection-switcher-plan.md

import type { AgentType, HttpStreamableConfig, StdioConfig } from './connectionTypes';
import { dirname, join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

/** Log function signature. */
type LogFn = (msg: string) => void;

/** MCP server entry name in agent config files. */
const MCP_SERVER_NAME: string = 'too-many-cooks';

/** CLI binary for stdio transport. */
const STDIO_COMMAND: string = 'npx';

/** CLI args for stdio transport. */
const STDIO_ARGS: readonly string[] = ['too-many-cooks', '--stdio'];

/** Environment variable keys for cloud stdio config. */
const ENV_API_KEY: string = 'TMC_API_KEY';
const ENV_WORKSPACE_ID: string = 'TMC_WORKSPACE_ID';
const ENV_WORKSPACE_SECRET: string = 'TMC_WORKSPACE_SECRET';

/** MCP servers JSON key. */
const MCP_SERVERS_KEY: string = 'mcpServers';

/** All supported agent types (alphabetically sorted). */
const ALL_AGENT_TYPES: readonly AgentType[] = ['claude-code', 'cline', 'codex', 'cursor'];

/** Agent config file paths relative to workspace root. */
const AGENT_CONFIG_PATHS: Readonly<Record<AgentType, string>> = {
  'claude-code': '.mcp.json',
  'cline': '.cline/mcp_settings.json',
  'codex': '.codex/mcp.json',
  'cursor': '.cursor/mcp.json',
};

/** Agent detection markers. */
const AGENT_MARKERS: Readonly<Record<AgentType, string>> = {
  'claude-code': '.claude',
  'cline': '.cline',
  'codex': '.codex',
  'cursor': '.cursor',
};

/** HTTP Streamable URL template. */
const HTTP_URL_PREFIX: string = 'http://localhost:';
const HTTP_URL_SUFFIX: string = '/mcp';

/** JSON indentation level. */
const JSON_INDENT: number = 2;

/** Credentials for stdio cloud config. */
export interface StdioCredentials {
  readonly apiKey: string;
  readonly passphrase: string;
  readonly workspaceId: string;
}

/** MCP config manager interface. */
export interface McpConfigManager {
  readonly detectAgents: () => readonly AgentType[];
  readonly getConfigPath: (agent: AgentType) => string;
  readonly removeConfig: (agents: readonly AgentType[]) => void;
  readonly writeHttpStreamableConfig: (agents: readonly AgentType[], port: number) => void;
  readonly writeStdioConfig: (agents: readonly AgentType[], creds: Readonly<StdioCredentials>) => void;
}

/** Build the HTTP Streamable MCP URL. */
function buildHttpUrl(port: number): string {
  return `${HTTP_URL_PREFIX}${String(port)}${HTTP_URL_SUFFIX}`;
}

/** Type guard for plain objects. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Read and parse a JSON config file, returning empty object if missing/invalid. */
function readConfigFile(path: string): Record<string, unknown> {
  try {
    if (!existsSync(path)) { return {}; }
    const raw: string = readFileSync(path, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** Write a JSON config file, creating parent directories as needed. */
function writeConfigFile(path: string, config: Readonly<Record<string, unknown>>): void {
  const dir: string = dirname(path);
  if (!existsSync(dir)) { mkdirSync(dir, { recursive: true }); }
  writeFileSync(path, JSON.stringify(config, null, JSON_INDENT), 'utf-8');
}

/** Extract the mcpServers object from a config, or return empty object. */
function extractServers(config: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const existing: unknown = config[MCP_SERVERS_KEY];
  return isPlainObject(existing) ? { ...existing } : {};
}

/** Set the MCP server entry in a config object. Returns a new object. */
function setMcpServer(
  config: Readonly<Record<string, unknown>>,
  serverConfig: Readonly<HttpStreamableConfig> | Readonly<StdioConfig>,
): Record<string, unknown> {
  const servers: Record<string, unknown> = extractServers(config);
  servers[MCP_SERVER_NAME] = serverConfig;
  return { ...config, [MCP_SERVERS_KEY]: servers };
}

/** Remove the MCP server entry from a config object. Returns a new object. */
function removeMcpServer(config: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const existing: unknown = config[MCP_SERVERS_KEY];
  if (!isPlainObject(existing)) { return { ...config }; }
  const servers: Record<string, unknown> = { ...existing };
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete servers[MCP_SERVER_NAME];
  return { ...config, [MCP_SERVERS_KEY]: servers };
}

/** Build a StdioConfig for cloud mode. */
function buildStdioConfig(creds: Readonly<StdioCredentials>): StdioConfig {
  return {
    args: [...STDIO_ARGS],
    command: STDIO_COMMAND,
    env: {
      [ENV_API_KEY]: creds.apiKey,
      [ENV_WORKSPACE_ID]: creds.workspaceId,
      [ENV_WORKSPACE_SECRET]: creds.passphrase,
    },
  };
}

/** Options for writing config to agents. */
interface WriteConfigOptions {
  readonly agents: readonly AgentType[];
  readonly getPath: (agent: AgentType) => string;
  readonly serverConfig: Readonly<HttpStreamableConfig> | Readonly<StdioConfig>;
}

/** Write a server config to all specified agents. */
function writeConfigToAgents(opts: Readonly<WriteConfigOptions>, log: LogFn): void {
  for (const agent of opts.agents) {
    const configPath: string = opts.getPath(agent);
    const existing: Record<string, unknown> = readConfigFile(configPath);
    const updated: Record<string, unknown> = setMcpServer(existing, opts.serverConfig);
    writeConfigFile(configPath, updated);
    log(`[McpConfigManager] Wrote config for ${agent} at ${configPath}`);
  }
}

/** Create an MCP config manager for a workspace. */
export function createMcpConfigManager(workspaceRoot: string, log: LogFn): McpConfigManager {
  function getConfigPath(agent: AgentType): string {
    return join(workspaceRoot, AGENT_CONFIG_PATHS[agent]);
  }

  function detectAgents(): readonly AgentType[] {
    const agents: AgentType[] = [];
    for (const agentType of ALL_AGENT_TYPES) {
      const markerPath: string = join(workspaceRoot, AGENT_MARKERS[agentType]);
      if (existsSync(markerPath)) {
        log(`[McpConfigManager] Detected agent: ${agentType}`);
        agents.push(agentType);
      }
    }
    return agents;
  }

  function writeHttpStreamableConfig(agents: readonly AgentType[], port: number): void {
    const serverConfig: HttpStreamableConfig = { url: buildHttpUrl(port) };
    writeConfigToAgents({ agents, getPath: getConfigPath, serverConfig }, log);
  }

  function writeStdioConfig(agents: readonly AgentType[], creds: Readonly<StdioCredentials>): void {
    const serverConfig: StdioConfig = buildStdioConfig(creds);
    writeConfigToAgents({ agents, getPath: getConfigPath, serverConfig }, log);
  }

  function removeConfig(agents: readonly AgentType[]): void {
    for (const agent of agents) {
      const configPath: string = getConfigPath(agent);
      if (existsSync(configPath)) {
        const existing: Record<string, unknown> = readConfigFile(configPath);
        const updated: Record<string, unknown> = removeMcpServer(existing);
        writeConfigFile(configPath, updated);
        log(`[McpConfigManager] Removed config for ${agent} at ${configPath}`);
      }
    }
  }

  return {
    detectAgents,
    getConfigPath,
    removeConfig,
    writeHttpStreamableConfig,
    writeStdioConfig,
  };
}
