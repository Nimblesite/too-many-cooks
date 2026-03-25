// Connection picker — Quick Pick UI for choosing local or cloud mode.
//
// Phase 4 of the VSIX connection switcher.
// Spec: tmc-cloud/docs/vsix-connection-switcher-spec.md
// Plan: tmc-cloud/docs/vsix-connection-switcher-plan.md

import * as vscode from 'vscode';
import type { AgentType, CloudTarget, ConnectionTarget, Transport } from '../services/connectionTypes';
import type { ConnectionManager } from '../services/connectionManager';
import type { McpConfigManager } from '../services/mcpConfigManager';
import type { StoreManager } from '../services/storeManager';

/** Log function signature. */
type LogFn = (msg: string) => void;

/** Quick Pick option labels. */
const LABEL_CLOUD: string = 'Connect to TMC Cloud';
const LABEL_DISCONNECT: string = 'Disconnect';
const LABEL_LOCAL: string = 'Start Local Server';

/** Quick Pick descriptions. */
const DESC_CLOUD: string = 'Each agent spawns its own process with cloud env vars (stdio)';
const DESC_DISCONNECT: string = 'Stop server and remove agent MCP configs';
const DESC_LOCAL: string = 'Spin up a local SQLite-backed server';

/** Quick Pick placeholder. */
const PICKER_PLACEHOLDER: string = 'Choose connection mode...';

/** Input box prompts. */
const PROMPT_API_KEY: string = 'API Key (stored in OS keychain)';
const PROMPT_API_URL: string = 'TMC Cloud API URL';
const PROMPT_PASSPHRASE: string = 'Workspace passphrase (stored in OS keychain)';
const PROMPT_TENANT_ID: string = 'Tenant ID';
const PROMPT_WORKSPACE_ID: string = 'Workspace ID';

/** Input box placeholder. */
const PLACEHOLDER_API_URL: string = 'https://your-project.supabase.co/functions/v1/tmc-api';

/** GlobalState keys for persisting last connection. */
const STATE_KEY_TARGET: string = 'tmc.lastConnectionTarget';

/** Default local port. */
const DEFAULT_PORT: number = 4040;

/** Sentinel value for clearing global state (avoids referencing undefined). */
const CLEARED: null = null;

/** VS Code configuration section. */
const CONFIG_SECTION: string = 'tooManyCooks';

/** VS Code configuration key for port. */
const CONFIG_KEY_PORT: string = 'port';

/** Connection picker dependencies. */
export interface ConnectionPickerDeps {
  readonly connectionManager: ConnectionManager;
  readonly globalState: vscode.Memento;
  readonly log: LogFn;
  readonly mcpConfigManager: McpConfigManager;
  readonly storeManager: StoreManager;
}

/** Prompt for a single input box value. Returns null if cancelled or empty. */
async function promptInput(
  prompt: string,
  password: boolean,
): Promise<string | null> {
  const value: string | typeof CLEARED = await vscode.window.showInputBox({
    password,
    prompt,
  }) ?? CLEARED;
  if (value === CLEARED || value.length === 0) { return null; }
  return value;
}

/** Prompt for API URL with a placeholder. Returns null if cancelled or empty. */
async function promptApiUrl(): Promise<string | null> {
  const value: string | typeof CLEARED = await vscode.window.showInputBox({
    placeHolder: PLACEHOLDER_API_URL,
    prompt: PROMPT_API_URL,
  }) ?? CLEARED;
  if (value === CLEARED || value.length === 0) { return null; }
  return value;
}

/** Prompt the user for cloud credentials. Returns null if cancelled. */
async function promptCloudCredentials(
  transport: Transport,
): Promise<CloudTarget | null> {
  const apiUrl: string | null = await promptApiUrl();
  if (apiUrl === null) { return null; }

  const apiKey: string | null = await promptInput(PROMPT_API_KEY, true);
  if (apiKey === null) { return null; }

  const tenantId: string | null = await promptInput(PROMPT_TENANT_ID, false);
  if (tenantId === null) { return null; }

  const workspaceId: string | null = await promptInput(PROMPT_WORKSPACE_ID, false);
  if (workspaceId === null) { return null; }

  const passphrase: string | null = await promptInput(PROMPT_PASSPHRASE, true);
  if (passphrase === null) { return null; }

  return { apiKey, apiUrl, mode: 'cloud', passphrase, tenantId, transport, workspaceId };
}

/** Handle "Start Local Server" selection. */
async function handleLocalServer(deps: ConnectionPickerDeps): Promise<void> {
  const config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const port: number = config.get<number>(CONFIG_KEY_PORT) ?? DEFAULT_PORT;

  deps.log('[ConnectionPicker] Starting local server...');
  await deps.connectionManager.startLocal(port);

  const agents: readonly AgentType[] = deps.mcpConfigManager.detectAgents();
  deps.mcpConfigManager.writeHttpStreamableConfig(agents, port);

  const target: ConnectionTarget = { mode: 'local', port, transport: 'http-streamable' };
  deps.storeManager.setTarget(target);
  await deps.storeManager.connect();

  await deps.globalState.update(STATE_KEY_TARGET, target);
  deps.log('[ConnectionPicker] Local server started and connected');
}

/** Write agent configs based on transport type. */
function writeAgentConfig(
  deps: ConnectionPickerDeps,
  cloudTarget: CloudTarget,
): void {
  const agents: readonly AgentType[] = deps.mcpConfigManager.detectAgents();

  if (cloudTarget.transport === 'stdio') {
    deps.mcpConfigManager.writeStdioConfig(agents, {
      apiKey: cloudTarget.apiKey,
      passphrase: cloudTarget.passphrase,
      workspaceId: cloudTarget.workspaceId,
    });
    return;
  }

  const config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const port: number = config.get<number>(CONFIG_KEY_PORT) ?? DEFAULT_PORT;
  deps.mcpConfigManager.writeHttpStreamableConfig(agents, port);
}

/** Handle cloud connection (stdio or HTTP). */
async function handleCloudConnection(
  deps: ConnectionPickerDeps,
  transport: Transport,
): Promise<void> {
  const cloudTarget: CloudTarget | null = await promptCloudCredentials(transport);
  if (cloudTarget === null) { return; }

  deps.log(`[ConnectionPicker] Connecting to cloud (${transport})...`);
  await deps.connectionManager.connectCloud(cloudTarget);

  writeAgentConfig(deps, cloudTarget);

  deps.storeManager.setTarget(cloudTarget);
  await deps.storeManager.connect();

  await deps.globalState.update(STATE_KEY_TARGET, cloudTarget);
  deps.log(`[ConnectionPicker] Cloud connected (${transport})`);
}

/** Handle disconnect. */
async function handleDisconnect(deps: ConnectionPickerDeps): Promise<void> {
  deps.log('[ConnectionPicker] Disconnecting...');
  deps.storeManager.disconnect();
  deps.connectionManager.disconnect();

  const agents: readonly AgentType[] = deps.mcpConfigManager.detectAgents();
  deps.mcpConfigManager.removeConfig(agents);

  await deps.globalState.update(STATE_KEY_TARGET, CLEARED);
  deps.log('[ConnectionPicker] Disconnected and agent configs removed');
}

/** Show the connection picker Quick Pick. */
export async function showConnectionPicker(deps: ConnectionPickerDeps): Promise<void> {
  const items: readonly vscode.QuickPickItem[] = [
    { description: DESC_LOCAL, label: LABEL_LOCAL },
    { description: DESC_CLOUD, label: LABEL_CLOUD },
    { description: DESC_DISCONNECT, label: LABEL_DISCONNECT },
  ];

  const picked: vscode.QuickPickItem | typeof CLEARED = await vscode.window.showQuickPick(
    [...items],
    { placeHolder: PICKER_PLACEHOLDER },
  ) ?? CLEARED;
  if (picked === CLEARED) { return; }

  try {
    switch (picked.label) {
      case LABEL_LOCAL:
        await handleLocalServer(deps);
        break;
      case LABEL_CLOUD:
        await handleCloudConnection(deps, 'stdio');
        break;
      case LABEL_DISCONNECT:
        await handleDisconnect(deps);
        break;
      default:
        break;
    }
  } catch (err: unknown) {
    deps.log(`[ConnectionPicker] Error: ${String(err)}`);
    await vscode.window.showErrorMessage(`Connection failed: ${String(err)}`);
  }
}

/** Restore the last saved connection on activation. */
export async function restoreLastConnection(deps: ConnectionPickerDeps): Promise<void> {
  const saved: ConnectionTarget | typeof CLEARED = deps.globalState.get<ConnectionTarget>(STATE_KEY_TARGET) ?? CLEARED;
  if (saved === CLEARED) { return; }

  deps.log(`[ConnectionPicker] Restoring last connection: ${saved.mode}/${saved.transport}`);
  try {
    if (saved.mode === 'local') {
      await handleLocalServer(deps);
    } else {
      await handleCloudConnection(deps, 'stdio');
    }
  } catch (err: unknown) {
    deps.log(`[ConnectionPicker] Restore failed: ${String(err)}`);
  }
}
