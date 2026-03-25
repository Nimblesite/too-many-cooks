// Delete agent commands — extracted from extension.ts to keep file under 300 LOC.

import * as vscode from 'vscode';
import type { DialogService } from '../services/dialogService';
import type { StoreManager } from '../services/storeManager';
import { getAgentNameFromItem } from './tree/treeItemUtils';
import { getDialogService } from '../services/dialogService';

type LogFn = (msg: string) => void;

export function registerDeleteAgentCommand(
  storeManager: Readonly<StoreManager>,
  logFn: LogFn,
): vscode.Disposable {
  return vscode.commands.registerCommand(
    'tooManyCooks.deleteAgent',
    // eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types
    async (item?: vscode.TreeItem): Promise<void> => {
      const dialogs: DialogService = getDialogService();
      const agentName: string | null = getAgentNameFromItem(item);
      if (agentName === null) {
        await dialogs.showErrorMessage('No agent selected');
        return;
      }
      const confirm: string | undefined = await dialogs.showWarningMessage(
        `Remove agent "${agentName}"? This will release all their locks.`,
        { modal: true },
        'Remove',
      );
      if (confirm !== 'Remove') { return; }
      try {
        await storeManager.deleteAgent(agentName);
        logFn(`Removed agent: ${agentName}`);
        await dialogs.showInformationMessage(`Agent removed: ${agentName}`);
      } catch (err: unknown) {
        logFn(`Failed to remove agent: ${String(err)}`);
        await dialogs.showErrorMessage(`Failed to remove agent: ${String(err)}`);
      }
    },
  );
}

export function registerDeleteAllAgentsCommand(
  storeManager: Readonly<StoreManager>,
  logFn: LogFn,
): vscode.Disposable {
  return vscode.commands.registerCommand(
    'tooManyCooks.deleteAllAgents',
    async (): Promise<void> => {
      const dialogs: DialogService = getDialogService();
      const count: number = storeManager.state.agents.length;
      if (count === 0) {
        await dialogs.showInformationMessage('No agents to remove');
        return;
      }
      const confirm: string | undefined = await dialogs.showWarningMessage(
        `Remove all ${String(count)} agents? This will release all locks.`,
        { modal: true },
        'Remove All',
      );
      if (confirm !== 'Remove All') { return; }
      try {
        await storeManager.deleteAllAgents();
        logFn(`Removed all ${String(count)} agents`);
        await dialogs.showInformationMessage(`All ${String(count)} agents removed`);
      } catch (err: unknown) {
        logFn(`Failed to remove all agents: ${String(err)}`);
        await dialogs.showErrorMessage(`Failed to remove all agents: ${String(err)}`);
      }
    },
  );
}
