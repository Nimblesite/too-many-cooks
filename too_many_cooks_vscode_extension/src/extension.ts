// Too Many Cooks VSCode Extension - TypeScript.
// Visualizes the Too Many Cooks multi-agent coordination system.
//
// Spec: tmc-cloud/docs/vsix-connection-switcher-spec.md
// Plan: tmc-cloud/docs/vsix-connection-switcher-plan.md

import * as vscode from 'vscode';

// Register module-alias AFTER vscode import to avoid breaking
// VSCode's built-in 'vscode' module resolution in Electron.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('module-alias/register');
import { getFilePathFromItem } from './ui/tree/treeItemUtils';
import { restoreLastConnection, showConnectionPicker } from './ui/connectionPicker';
import { AgentsTreeProvider } from './ui/tree/agentsTreeProvider';
import type { ConnectionPickerDeps } from './ui/connectionPicker';
import { DashboardPanel } from './ui/webview/dashboardPanel';
import type { DialogService } from './services/dialogService';
import { LocksTreeProvider } from './ui/tree/locksTreeProvider';
import { MessagesTreeProvider } from './ui/tree/messagesTreeProvider';
import { StatusBarManager } from './ui/statusBar';
import { StoreManager } from './services/storeManager';
import type { TestAPI } from './testApi';
import { createConnectionManager } from './services/connectionManager';
import { createMcpConfigManager } from './services/mcpConfigManager';
import { createTestAPI } from './testApi';
import { getDialogService } from './services/dialogService';
import { registerDeleteAgentCommand, registerDeleteAllAgentsCommand } from './ui/deleteAgentCommands';
import {
  registerCopyAgentNameCommand,
  registerCopyMessageAsQuoteCommand,
  registerCopyMessageContentCommand,
  registerCopyMessageIdCommand,
  registerCopyMessageRecipientCommand,
  registerCopyMessageSenderCommand,
  registerCopyMessagesCommand,
} from './ui/messageCommands';
import { registerSendMessageCommand } from './ui/sendMessageCommand';

 
const DEFAULT_PORT: number = 4040;

const logMessages: string[] = [];
let outputChannel: vscode.OutputChannel | null = null;

function log(message: string): void {
  const timestamp: string = new Date().toISOString();
  const fullMessage: string = `[${timestamp}] ${message}`;
  outputChannel?.appendLine(fullMessage);
  logMessages.push(fullMessage);
  process.stdout.write(`[EXT] ${fullMessage}\n`);
}

function resolvePort(): number {
  const envPort: string | undefined = process.env.TMC_PORT;
  if (typeof envPort === 'string' && envPort.length > 0) { return parseInt(envPort, 10); }
  const config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration('tooManyCooks');
  return config.get<number>('port') ?? DEFAULT_PORT;
}

 
export function activate(context: vscode.ExtensionContext): TestAPI {
  outputChannel = vscode.window.createOutputChannel('Too Many Cooks');
  outputChannel.show(true);
  log('Extension activating...');

  const config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration('tooManyCooks');
  const autoConnect: boolean = config.get<boolean>('autoConnect') ?? true;
  const workspaceFolder: string = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '.';
  log(`Using workspace folder: ${workspaceFolder}`);

  const storeManager: StoreManager = new StoreManager(workspaceFolder, log, resolvePort());
  const connectionManager: ReturnType<typeof createConnectionManager> = createConnectionManager(workspaceFolder, log);
  const mcpConfigManager: ReturnType<typeof createMcpConfigManager> = createMcpConfigManager(workspaceFolder, log);

  const pickerDeps: ConnectionPickerDeps = {
    connectionManager,
    globalState: context.globalState,
    log,
    mcpConfigManager,
    storeManager,
  };

  const providers: Providers = createProviders(storeManager);
  const statusBar: StatusBarManager = new StatusBarManager(storeManager);
  registerAllCommands(context, storeManager, pickerDeps);
  log('Extension activated');

  // eslint-disable-next-line no-void
  if (autoConnect) { void autoConnectOnActivation(pickerDeps, storeManager); }

  context.subscriptions.push({
    dispose: (): void => {
      connectionManager.disconnect();
      storeManager.disconnect();
      statusBar.dispose();
      providers.agentsProvider.dispose();
      providers.locksProvider.dispose();
      providers.messagesProvider.dispose();
    },
  });

  return createTestAPI({
    agentsProvider: providers.agentsProvider,
    locksProvider: providers.locksProvider,
    logMessages,
    messagesProvider: providers.messagesProvider,
    storeManager,
  });
}

export function deactivate(): void {
  log('Extension deactivating');
}

interface Providers {
  readonly agentsProvider: AgentsTreeProvider;
  readonly agentsTreeView: vscode.TreeView<unknown>;
  readonly locksProvider: LocksTreeProvider;
  readonly messagesProvider: MessagesTreeProvider;
  readonly messagesTreeView: vscode.TreeView<unknown>;
}

function createProviders(storeManager: StoreManager): Providers {
  const agentsProvider: AgentsTreeProvider = new AgentsTreeProvider(storeManager);
  const locksProvider: LocksTreeProvider = new LocksTreeProvider(storeManager);
  const messagesProvider: MessagesTreeProvider = new MessagesTreeProvider(storeManager);
  const agentsTreeView: vscode.TreeView<unknown> = vscode.window.createTreeView(
    'tooManyCooksAgents',
    {
      canSelectMany: true,
      showCollapseAll: true,
      treeDataProvider: agentsProvider,
    },
  );
  vscode.window.createTreeView('tooManyCooksLocks', { treeDataProvider: locksProvider });
  const messagesTreeView: vscode.TreeView<unknown> = vscode.window.createTreeView(
    'tooManyCooksMessages',
    {
      canSelectMany: true,
      treeDataProvider: messagesProvider,
    },
  );
  return { agentsProvider, agentsTreeView, locksProvider, messagesProvider, messagesTreeView };
}

async function autoConnectOnActivation(
  pickerDeps: ConnectionPickerDeps,
  storeManager: Readonly<StoreManager>,
): Promise<void> {
  try {
    await restoreLastConnection(pickerDeps);
    log('Auto-connect: restore attempted');
  } catch (err: unknown) {
    log(`Auto-connect restore FAILED: ${String(err)}`);
  }
  if (!storeManager.isConnected) {
    try {
      await storeManager.connect();
      log('Auto-connect: SUCCESS');
    } catch (err: unknown) {
      log(`Auto-connect FAILED: ${String(err)}`);
    }
  }
}

 
function registerAllCommands(
  context: vscode.ExtensionContext,
  sm: Readonly<StoreManager>,
  pickerDeps: ConnectionPickerDeps,
): void {
  context.subscriptions.push(registerChooseConnectionCommand(pickerDeps));
  context.subscriptions.push(registerConnectCommand(sm));
  context.subscriptions.push(registerDisconnectCommand(sm));
  context.subscriptions.push(registerRefreshCommand(sm));
  context.subscriptions.push(registerDashboardCommand(sm));
  context.subscriptions.push(registerDeleteLockCommand(sm));
  context.subscriptions.push(registerDeleteAgentCommand(sm, log));
  context.subscriptions.push(registerDeleteAllAgentsCommand(sm, log));
  context.subscriptions.push(registerSendMessageCommand(sm, log));
  context.subscriptions.push(registerCopyMessageContentCommand());
  context.subscriptions.push(registerCopyMessageAsQuoteCommand());
  context.subscriptions.push(registerCopyMessageIdCommand());
  context.subscriptions.push(registerCopyMessageSenderCommand());
  context.subscriptions.push(registerCopyMessageRecipientCommand());
  context.subscriptions.push(registerCopyMessagesCommand());
  context.subscriptions.push(registerCopyAgentNameCommand());
}

function registerChooseConnectionCommand(deps: ConnectionPickerDeps): vscode.Disposable {
  return vscode.commands.registerCommand('tooManyCooks.chooseConnection', async (): Promise<void> => {
    await showConnectionPicker(deps);
  });
}

function registerConnectCommand(storeManager: Readonly<StoreManager>): vscode.Disposable {
  return vscode.commands.registerCommand('tooManyCooks.connect', async (): Promise<void> => {
    const dialogs: DialogService = getDialogService();
    try {
      await storeManager.connect();
      log('Connected successfully');
      await dialogs.showInformationMessage('Connected to Too Many Cooks server');
    } catch (err: unknown) {
      log(`Connection failed: ${String(err)}`);
      await dialogs.showErrorMessage(`Failed to connect: ${String(err)}`);
    }
  });
}

function registerDisconnectCommand(storeManager: Readonly<StoreManager>): vscode.Disposable {
  return vscode.commands.registerCommand('tooManyCooks.disconnect', async (): Promise<void> => {
    const dialogs: DialogService = getDialogService();
    storeManager.disconnect();
    await dialogs.showInformationMessage('Disconnected from Too Many Cooks server');
  });
}

function registerRefreshCommand(storeManager: Readonly<StoreManager>): vscode.Disposable {
  return vscode.commands.registerCommand('tooManyCooks.refresh', async (): Promise<void> => {
    const dialogs: DialogService = getDialogService();
    try {
      await storeManager.refreshStatus();
    } catch (err: unknown) {
      await dialogs.showErrorMessage(`Failed to refresh: ${String(err)}`);
    }
  });
}

function registerDashboardCommand(storeManager: Readonly<StoreManager>): vscode.Disposable {
  return vscode.commands.registerCommand('tooManyCooks.showDashboard', (): void => {
    DashboardPanel.createOrShow(storeManager);
  });
}

function registerDeleteLockCommand(storeManager: Readonly<StoreManager>): vscode.Disposable {
  return vscode.commands.registerCommand(
    'tooManyCooks.deleteLock',
     
    async (item?: vscode.TreeItem): Promise<void> => {
      const dialogs: DialogService = getDialogService();
      const filePath: string | null = getFilePathFromItem(item);
      if (filePath === null) {
        await dialogs.showErrorMessage('No lock selected');
        return;
      }
      const confirm: string | undefined = await dialogs.showWarningMessage(
        `Force release lock on ${filePath}?`,
        { modal: true },
        'Release',
      );
      if (confirm !== 'Release') { return; }
      try {
        await storeManager.forceReleaseLock(filePath);
        log(`Force released lock: ${filePath}`);
        await dialogs.showInformationMessage(`Lock released: ${filePath}`);
      } catch (err: unknown) {
        log(`Failed to release lock: ${String(err)}`);
        await dialogs.showErrorMessage(`Failed to release lock: ${String(err)}`);
      }
    },
  );
}


